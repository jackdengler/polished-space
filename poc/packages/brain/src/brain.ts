/**
 * Wires the brain together: stores, guarded connectors, the Claude wrapper,
 * intake, the approve path, the state builder, the HTTP server and modules.
 */
import { join } from 'node:path';
import type { Server } from 'node:http';
import {
  DATA_LAYOUT,
  FILE_VIEW_MAX_CHARS,
  HoldBody,
  InputBody,
  PATHS,
  addDaysIso,
  zonedTime,
  type CalEvent,
  type FileView,
  type PmClient,
  type PmTask,
  type SidebarState,
  type Suggestion,
} from '@poc/contracts';
import { Approver } from './approve';
import { Claude, ClaudeError, ClaudeRefusalError, ClaudeUnavailableError, SpendCapError, type AnthropicLike } from './claude';
import type { BrainConfig } from './config';
import { guardConnectors, readOnly, type Connectors, type ReadConnectors } from './guard';
import { HttpProblem } from './httpProblem';
import { IntakeService } from './intake/service';
import { Registry } from './modules/registry';
import type { ApplyResult, BrainModule, ModuleContext, TasksChangedEvent } from './modules/types';
import { ProfileFiles } from './profileFiles';
import { pdfText } from './files/pdfText';
import { createBrainServer, SseHub, sendJson } from './server';
import { buildState } from './state';
import { CursorStore } from './store/cursors';
import { NudgeStore } from './store/nudges';
import { SuggestionConflictError, SuggestionStore } from './store/suggestions';
import { TaskMetaStore } from './store/taskMeta';
import { UsageLog } from './usage';

export interface BrainDeps {
  config: BrainConfig;
  /** Raw connectors; the brain wraps them so writes only work inside an approval. */
  connectors: Connectors;
  /** The Anthropic client (real SDK or FakeClaude), or null when not configured. */
  anthropic: AnthropicLike | null;
  modules?: BrainModule[];
  log?: (msg: string) => void;
}

const CLIENTS_TTL_MS = 5_000;

/** Module objects already bound to a brain: one object serves one brain (see modules/index.ts). */
const boundModules = new WeakSet<BrainModule>();

export class Brain {
  readonly config: BrainConfig;
  readonly registry: Registry;
  readonly claude: Claude;
  readonly usage: UsageLog;
  readonly suggestions: SuggestionStore;
  readonly taskMeta: TaskMetaStore;
  readonly cursors: CursorStore;
  readonly nudges: NudgeStore;
  readonly profiles: ProfileFiles;
  readonly read: ReadConnectors;
  readonly intake: IntakeService;
  readonly approver: Approver;
  readonly server: Server;
  readonly sse = new SseHub();
  private writes: Connectors;
  private log: (msg: string) => void;
  private clientsCache: { at: number; clients: PmClient[] } | null = null;
  private tasksHash: string | null = null;
  private calendarHash: string | null = null;
  private statePush: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private lastTickError = new Map<string, string>();
  private modules: BrainModule[];

  constructor(deps: BrainDeps) {
    this.config = deps.config;
    this.log = deps.log ?? ((m) => console.log(`[brain] ${m}`));
    this.modules = deps.modules ?? [];
    const dir = deps.config.dataDir;
    this.registry = new Registry(this.log);
    this.usage = new UsageLog(join(dir, DATA_LAYOUT.usageLog), deps.config.clock);
    this.claude = new Claude(deps.anthropic, this.usage, { maxUsdPerDay: deps.config.maxUsdPerDay, fallbacks: deps.config.claudeFallbacks, clock: deps.config.clock });
    this.suggestions = new SuggestionStore(join(dir, DATA_LAYOUT.brainSuggestions), deps.config.clock);
    this.taskMeta = new TaskMetaStore(join(dir, DATA_LAYOUT.brainTaskMeta));
    this.cursors = new CursorStore(join(dir, DATA_LAYOUT.brainCursors));
    this.nudges = new NudgeStore(deps.config.clock);
    this.profiles = new ProfileFiles(join(dir, DATA_LAYOUT.profiles));
    this.writes = guardConnectors(deps.connectors);
    this.read = readOnly(this.writes);

    this.suggestions.onChange(() => this.stateChanged());
    this.suggestions.onAdded((made) => this.registry.emit('onSuggestionsAdded', { suggestions: made }));
    this.taskMeta.onChange(() => this.stateChanged());
    this.nudges.onNudge((n) => {
      this.sse.broadcast('nudge', n);
      this.stateChanged();
    });

    this.intake = new IntakeService({
      config: this.config,
      claude: this.claude,
      read: this.read,
      cursors: this.cursors,
      suggestions: this.suggestions,
      nudges: this.nudges,
      registry: this.registry,
      profiles: this.profiles,
      clients: () => this.clients(),
      myTasks: () => this.myTasks(),
      log: this.log,
    });
    const ctx = this.moduleContext('core');
    this.approver = new Approver({
      config: this.config,
      store: this.suggestions,
      writes: this.writes,
      registry: this.registry,
      nudges: this.nudges,
      clients: () => this.clients(),
      taskMeta: ctx.taskMeta,
      suggestions: ctx.suggestions,
      afterApply: (r) => this.afterApply(r),
      log: this.log,
    });
    this.server = createBrainServer(this.registry, this.log);
    this.registerCoreRoutes();
  }

  // ---- lifecycle -------------------------------------------------------------

  /** Load state and initialise modules. Call once before start() or tick(). */
  async init(): Promise<void> {
    await Promise.all([this.suggestions.load(), this.taskMeta.load(), this.cursors.load(), this.usage.load()]);
    for (const m of this.modules) {
      if (boundModules.has(m)) throw new Error(`module "${m.name}" is already bound to another brain; use createModules() for fresh instances`);
      boundModules.add(m);
      this.registry.modules.push(m);
      await m.init?.(this.moduleContext(m.name));
    }
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(this.config.port, this.config.host, () => resolve());
    });
    const loop = async () => {
      await this.tick();
      this.timer = setTimeout(loop, this.config.pollMs);
    };
    this.timer = setTimeout(loop, 0);
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const m of this.modules) await m.stop?.();
    this.sse.close();
    this.server.closeAllConnections?.();
    await new Promise<void>((r) => this.server.close(() => r()));
    await this.idle();
  }

  /** Wait for background work (module hooks, state pushes). For tests. */
  idle(): Promise<void> {
    return this.registry.idle();
  }

  /**
   * One poll: new mail and chat, then Planr and calendar changes, then each
   * module's onTick. Errors are logged (once per distinct message), never fatal.
   */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.step('intake', () => this.intake.poll());
      await this.step('pm', () => this.checkTasks());
      await this.step('calendar', () => this.checkCalendar());
      this.registry.emit('onTick', this.config.clock.now());
    } finally {
      this.ticking = false;
    }
  }

  private async step(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      const msg = (err as Error).message;
      if (msg !== this.lastTickError.get(name)) this.log(`poll ${name}: ${msg}`);
      this.lastTickError.set(name, msg);
      return;
    }
    if (this.lastTickError.has(name)) this.log(`poll ${name}: recovered`);
    this.lastTickError.delete(name);
  }

  // ---- reads -----------------------------------------------------------------

  async clients(): Promise<PmClient[]> {
    if (this.clientsCache && Date.now() - this.clientsCache.at < CLIENTS_TTL_MS) return this.clientsCache.clients;
    const { clients } = await this.read.pm.listClients();
    this.clientsCache = { at: Date.now(), clients };
    return clients;
  }

  async myTasks(): Promise<PmTask[]> {
    return (await this.read.pm.listTasks({ assigneeId: this.config.me.id })).tasks;
  }

  private dayWindow(days: number): { start: string; end: string } {
    const today = this.config.clock.today();
    return { start: zonedTime(today, 0, this.config.clock.tz).toISOString(), end: zonedTime(addDaysIso(today, days), 0, this.config.clock.tz).toISOString() };
  }

  async calendarToday(): Promise<CalEvent[]> {
    const w = this.dayWindow(1);
    return this.read.calendar.view(w.start, w.end);
  }

  async buildState(): Promise<SidebarState> {
    // A calendar outage should not hide the task list; Planr being down is a real error.
    const calendar = this.calendarToday().catch((err) => {
      this.log(`state: calendar unavailable (${(err as Error).message})`);
      return [] as CalEvent[];
    });
    const [clients, tasks, calendarToday] = await Promise.all([this.clients(), this.myTasks(), calendar]);
    return buildState({
      now: this.config.clock.now(),
      today: this.config.clock.today(),
      me: { id: this.config.me.id, name: this.config.me.name },
      internalClientId: this.config.internalClientId,
      clients,
      tasks,
      meta: this.taskMeta.all(),
      suggestions: this.suggestions.list(),
      nudges: this.nudges.list(),
      calendarToday,
      usageToday: this.usage.today(),
    });
  }

  // ---- change detection ------------------------------------------------------

  private hashTasks(tasks: PmTask[]): string {
    return JSON.stringify(tasks.map((t) => [t.id, t.title, t.dueDate, t.done, t.clientId, t.updatedAt]).sort());
  }

  private async checkTasks(force?: TasksChangedEvent['reason']): Promise<void> {
    const tasks = await this.myTasks();
    const hash = this.hashTasks(tasks);
    const first = this.tasksHash === null;
    if (!force && hash === this.tasksHash) return;
    this.tasksHash = hash;
    this.registry.emit('onTasksChanged', { tasks, reason: force ?? (first ? 'startup' : 'pm_changed') });
    this.stateChanged();
  }

  private async checkCalendar(force = false): Promise<void> {
    const w = this.dayWindow(14);
    const events = await this.read.calendar.view(w.start, w.end);
    const hash = JSON.stringify(events.map((e) => [e.id, e.subject, e.start.dateTime, e.end.dateTime, e.showAs]));
    if (!force && hash === this.calendarHash) return;
    this.calendarHash = hash;
    this.registry.emit('onCalendarChanged', { events });
    this.stateChanged();
  }

  private afterApply(r: ApplyResult): void {
    if (r.tasksChanged) this.registry.track(this.step('pm', () => this.checkTasks('approved')));
    if (r.calendarChanged) this.registry.track(this.step('calendar', () => this.checkCalendar(true)));
    this.stateChanged();
  }

  /** Debounced push of a full state snapshot to every SSE client. */
  stateChanged(): void {
    if (this.statePush) return;
    this.statePush = new Promise<void>((r) => setTimeout(r, 50))
      .then(async () => {
        this.statePush = null;
        if (this.sse.size === 0) return;
        this.sse.broadcast('state', await this.buildState());
      })
      .catch((err) => {
        this.statePush = null;
        this.log(`state push failed: ${(err as Error).message}`);
      });
    this.registry.track(this.statePush);
  }

  // ---- module context --------------------------------------------------------

  moduleContext(owner: string): ModuleContext {
    return {
      config: this.config,
      clock: this.config.clock,
      log: (msg, extra) => this.log(`[${owner}] ${msg}${extra === undefined ? '' : ` ${JSON.stringify(extra)}`}`),
      claude: this.claude,
      read: this.read,
      clients: () => this.clients(),
      profiles: this.profiles,
      suggestions: {
        add: (input) => this.suggestions.add(input),
        get: (id) => this.suggestions.get(id),
        list: () => this.suggestions.list(),
        revise: (id, fn) =>
          this.suggestions.update(id, (cur) => {
            if (cur.status !== 'pending') throw new Error(`suggestion ${id} is ${cur.status}, not pending`);
            const next = fn(structuredClone(cur));
            if (next.id !== cur.id || next.kind !== cur.kind || next.status !== cur.status) throw new Error('revise cannot change id, kind or status');
            return next;
          }),
        retire: async (id, reason = 'Replaced by a newer version.') => {
          try {
            this.suggestions.claim(id, ['pending', 'failed'], 'denied');
          } catch (err) {
            if (err instanceof SuggestionConflictError) return null;
            throw err;
          }
          return this.suggestions.update(id, (s) => ({ ...s, status: 'denied', error: reason, decidedAt: this.config.clock.now().toISOString() }));
        },
      },
      taskMeta: {
        get: (id) => this.taskMeta.get(id),
        all: () => this.taskMeta.all(),
        upsert: (id, patch) => this.taskMeta.upsert(id, patch),
        upsertMany: (entries) => this.taskMeta.upsertMany(entries),
      },
      nudges: { add: (n) => this.nudges.add(n) },
      intake: { submitText: (text, connector) => this.intake.submitText(text, connector) },
      state: { build: () => this.buildState(), changed: () => this.stateChanged() },
      myTasks: () => this.myTasks(),
      routes: { add: (method, pattern, handler) => this.registry.addRoute(owner, method, pattern, handler) },
      upgrades: { add: (path, handler) => this.registry.addUpgrade(owner, path, handler) },
      executors: { override: (kind, executor) => this.registry.overrideExecutor(owner, kind, executor) },
    };
  }

  // ---- core routes -----------------------------------------------------------

  async approve(id: string, body: unknown = {}): Promise<Suggestion> {
    return this.approver.approve(id, body);
  }

  async deny(id: string): Promise<Suggestion> {
    return this.approver.deny(id);
  }

  async setHold(taskId: string, onHold: boolean) {
    const { tasks } = await this.read.pm.listTasks({});
    if (!tasks.some((t) => t.id === taskId)) throw new HttpProblem(404, `no open task ${taskId}`);
    const meta = await this.taskMeta.upsert(taskId, { onHold });
    this.registry.track(this.step('pm', () => this.checkTasks('hold')));
    return meta;
  }

  private registerCoreRoutes(): void {
    const add = (method: 'GET' | 'POST', pattern: string, h: Parameters<Registry['addRoute']>[3]) => this.registry.addRoute('core', method, pattern, h);
    add('GET', PATHS.brain.health, ({ res }) => sendJson(res, 200, { ok: true, service: 'brain', now: this.config.clock.now().toISOString() }));
    add('GET', PATHS.brain.state, async ({ res }) => sendJson(res, 200, await this.buildState()));
    add('GET', PATHS.brain.events, async ({ res }) => {
      this.sse.open(res);
      try {
        this.sse.send(res, 'state', await this.buildState());
      } catch (err) {
        this.log(`initial state for SSE failed: ${(err as Error).message}`);
      }
    });
    add('POST', '/api/suggestions/:id/approve', async ({ res, params, body }) => sendJson(res, 200, { suggestion: await this.approve(params.id!, await body()) }));
    add('POST', '/api/suggestions/:id/deny', async ({ res, params }) => sendJson(res, 200, { suggestion: await this.deny(params.id!) }));
    add('POST', PATHS.brain.input, async ({ res, body }) => {
      const parsed = InputBody.safeParse(await body());
      if (!parsed.success) throw new HttpProblem(400, 'expected { text }');
      try {
        sendJson(res, 200, { suggestions: await this.intake.submitText(parsed.data.text, 'manual') });
      } catch (err) {
        throw claudeProblem(err);
      }
    });
    add('POST', '/api/tasks/:id/hold', async ({ res, params, body }) => {
      const parsed = HoldBody.safeParse(await body());
      if (!parsed.success) throw new HttpProblem(400, 'expected { onHold: boolean }');
      sendJson(res, 200, await this.setHold(params.id!, parsed.data.onHold));
    });
    add('GET', PATHS.brain.usage, ({ res }) => sendJson(res, 200, this.usage.response()));
    add('GET', PATHS.brain.files, async ({ res, url }) => sendJson(res, 200, await this.fileView(url.searchParams.get('path'))));
    add('GET', PATHS.brain.filesRaw, async ({ res, url }) => {
      const file = await this.readClientFile(url.searchParams.get('path'));
      const body = Buffer.from(file.content, file.encoding);
      const name = encodeURIComponent(file.name);
      res.writeHead(200, { 'content-type': file.mimeType === 'application/pdf' ? 'application/pdf' : `${file.mimeType}; charset=utf-8`, 'content-length': body.length, 'content-disposition': `inline; filename*=UTF-8''${name}`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(body);
    });
  }

  /** Read one file from the fake file server (read-only connector; paths outside its root are refused). */
  private async readClientFile(path: string | null) {
    if (!path) throw new HttpProblem(400, 'expected ?path=<client folder>/<file>');
    try {
      return await this.read.files.read(path);
    } catch (err) {
      const msg = (err as Error).message;
      if (/outside files root|unsupported file type/.test(msg)) throw new HttpProblem(400, msg);
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' || /no file|not found/i.test(msg)) throw new HttpProblem(404, `no file ${path}`);
      throw err;
    }
  }

  /** `GET /api/files?path=`: the file next to its review (FileView). */
  async fileView(path: string | null): Promise<FileView> {
    const file = await this.readClientFile(path);
    const { content, encoding, ...info } = file;
    const full = encoding === 'base64' ? pdfText(Buffer.from(content, 'base64')) : content;
    const truncated = full.length > FILE_VIEW_MAX_CHARS;
    return { ...info, text: truncated ? full.slice(0, FILE_VIEW_MAX_CHARS) : full, textSource: encoding === 'base64' ? 'pdf_text' : 'file', truncated, rawUrl: PATHS.brain.fileRaw(info.path) };
  }
}

/** Map a Claude failure on a user request to an HTTP status. */
export function claudeProblem(err: unknown): Error {
  if (err instanceof HttpProblem) return err;
  if (err instanceof SpendCapError) return new HttpProblem(429, err.message);
  if (err instanceof ClaudeUnavailableError) return new HttpProblem(503, err.message);
  if (err instanceof ClaudeRefusalError) return new HttpProblem(422, err.message);
  if (err instanceof ClaudeError) return new HttpProblem(502, err.message);
  return new HttpProblem(502, (err as Error).message || 'upstream call failed');
}

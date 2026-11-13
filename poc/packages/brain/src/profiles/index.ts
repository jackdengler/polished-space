/**
 * Phase 2C: client profiles. See src/MODULES.md ("2C") and plan sections 3.5, 4, 5.
 *
 * - After triage: apply the message's `profileEdits` (code, not a model,
 *   writes the file) and log each change under "## Change log".
 * - After approvals: deterministic edits from the suggestion (an approved task
 *   becomes a commitment bullet; reschedule, focus time and completion update
 *   that same bullet). One small `profile` Claude call only after a reply is
 *   sent, to catch what the email itself promised or decided.
 * - Shorthand learning: an approved `confirm_client` records its alias under
 *   "Also known as", which the core pre-match reads on the next message.
 * - `GET /api/profiles`, `GET /api/profiles/:clientId`.
 *
 * Profiles are the assistant's own notes, so they change without approval;
 * nothing here can reach an outside system (only ctx.read and the profile files).
 */
import { join } from 'node:path';
import { localMinutes, PATHS, profileSlug, type Direction, type EditableProfileSection, type PmClient, type ProfileDoc, type ProfileListResponse, type ProfileSummary, type Suggestion } from '@poc/contracts';
import { ClaudeError } from '../claude';
import { HttpProblem } from '../httpProblem';
import type { BrainModule, ModuleContext, SuggestionAppliedEvent } from '../modules/types';
import { sendJson } from '../server';
import { JsonFile } from '../store/jsonFile';
import { cleanText } from './edit';
import { runProfileUpdate } from './followup';
import { mtimeIso, ProfileWriter } from './writer';

/** One approved task's bullet in a profile, so later approvals update that same line. */
export interface TaskEntry {
  clientId: string;
  section: EditableProfileSection;
  title: string;
  dueDate: string | null;
  focus: string | null;
  done: string | null;
  /** The bullet as last written. */
  bullet: string;
}

export function commitmentSection(direction: Direction | undefined): EditableProfileSection {
  return direction === 'owed_to_me' ? 'Commitments: they owe' : 'Commitments: we owe';
}

export function taskBullet(e: Pick<TaskEntry, 'title' | 'dueDate' | 'focus' | 'done'>): string {
  const notes: string[] = [];
  if (e.done) notes.push(`done ${e.done}`);
  else {
    if (e.dueDate) notes.push(`due ${e.dueDate}`);
    if (e.focus) notes.push(`focus time booked ${e.focus}`);
  }
  return cleanText(notes.length ? `${e.title} (${notes.join('; ')})` : e.title);
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export class ProfilesFeature {
  readonly writer: ProfileWriter;
  private tasks: JsonFile<Record<string, TaskEntry>>;
  private index: Record<string, TaskEntry> = {};
  private serial: Promise<unknown> = Promise.resolve();

  constructor(private ctx: ModuleContext) {
    this.writer = new ProfileWriter(ctx.profiles, ctx.clock);
    this.tasks = new JsonFile(join(ctx.config.dataDir, 'brain', 'profile-tasks.json'));
  }

  async init(): Promise<void> {
    this.index = await this.tasks.load({});
    this.ctx.routes.add('GET', PATHS.brain.profiles, async ({ res }) => sendJson(res, 200, await this.list()));
    this.ctx.routes.add('GET', '/api/profiles/:clientId', async ({ res, params }) => sendJson(res, 200, await this.doc(params.clientId!)));
  }

  /** Hooks run one at a time, so a task's create and its completion never race. */
  private queue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.serial.then(fn, fn);
    this.serial = next.catch(() => {});
    return next;
  }

  private async client(id: string | null | undefined): Promise<PmClient | null> {
    if (!id || id === this.ctx.config.internalClientId) return null;
    return (await this.ctx.clients()).find((c) => c.id === id && !c.archived) ?? null;
  }

  private async apply(client: PmClient, edits: unknown[], label: string) {
    const out = await this.writer.apply(client.name, edits, label);
    for (const r of out.rejected) this.ctx.log(`profile edit for ${client.id} rejected: ${r.reason}`, r.edit);
    if (out.applied.length) this.ctx.log(`profile ${client.id}: ${out.applied.length} change(s) from ${label}`);
    return out;
  }

  // ---- routes --------------------------------------------------------------

  private async summary(c: PmClient): Promise<ProfileSummary | null> {
    const updatedAt = await mtimeIso(this.ctx.profiles.pathFor(c.name));
    if (!updatedAt) return null;
    return { clientId: c.id, clientName: c.name, slug: profileSlug(c.name), updatedAt };
  }

  async list(): Promise<ProfileListResponse> {
    const clients = (await this.ctx.clients()).filter((c) => !c.archived && c.id !== this.ctx.config.internalClientId);
    const profiles: ProfileSummary[] = [];
    for (const c of [...clients].sort((a, b) => a.name.localeCompare(b.name))) {
      const s = await this.summary(c);
      if (s) profiles.push(s);
    }
    return { profiles };
  }

  async doc(clientId: string): Promise<ProfileDoc> {
    const c = await this.client(clientId);
    if (!c) throw new HttpProblem(404, `no client profile for ${clientId}`);
    const markdown = await this.ctx.profiles.read(c.name);
    const s = await this.summary(c);
    if (markdown === null || !s) throw new HttpProblem(404, `${c.name} has no profile yet`);
    return { ...s, markdown };
  }

  // ---- after triage ----------------------------------------------------------

  onTriaged(clientId: string | null, confidence: 'high' | 'low', edits: unknown[], label: string): Promise<void> {
    return this.queue(async () => {
      if (!edits.length || confidence !== 'high') return;
      const c = await this.client(clientId);
      if (c) await this.apply(c, edits, label);
    });
  }

  // ---- after approvals -------------------------------------------------------

  onApplied(e: SuggestionAppliedEvent): Promise<void> {
    const s = e.suggestion;
    const done = this.queue(async () => {
      switch (s.kind) {
        case 'confirm_client':
          return this.learnAlias(s);
        case 'create_task':
          return this.taskCreated(s, e.result.taskIds?.[0]);
        case 'reschedule_task':
          return this.updateTask(s.payload.taskId, (t) => ({ ...t, dueDate: s.payload.dueDate }), `Rescheduled: ${s.title}`);
        case 'complete_task':
          return this.updateTask(s.payload.taskId, (t) => ({ ...t, done: this.ctx.clock.today() }), `Completed: ${s.title}`);
        case 'calendar_block': {
          if (s.payload.purpose !== 'focus' || !s.payload.taskId) return;
          const start = new Date(s.payload.start);
          const end = new Date(s.payload.end);
          const tz = this.ctx.clock.tz;
          const focus = `${this.ctx.clock.dayOf(s.payload.start)} ${hhmm(localMinutes(start, tz))}-${hhmm(localMinutes(end, tz))}`;
          return this.updateTask(s.payload.taskId, (t) => ({ ...t, focus }), `Calendar block: ${s.payload.subject}`);
        }
        case 'send_reply':
          if (s.payload.taskId) await this.updateTask(s.payload.taskId, (t) => ({ ...t, done: this.ctx.clock.today() }), `Reply sent: ${s.payload.draft.subject}`);
          return;
      }
    });
    // The Claude call runs outside the queue (its edits are queued when they arrive), so a slow reply never holds up other updates.
    return s.kind === 'send_reply' ? Promise.all([done, this.replySent(s)]).then(() => {}) : done;
  }

  private async learnAlias(s: Extract<Suggestion, { kind: 'confirm_client' }>): Promise<void> {
    const alias = s.payload.alias ? cleanText(s.payload.alias).replace(/^["“]|["”]$/g, '') : '';
    if (!alias) return;
    const c = await this.client(s.clientId);
    if (!c) return;
    if (c.name.toLowerCase() === alias.toLowerCase()) return;
    await this.apply(c, [{ section: 'Also known as', op: 'add', text: alias }], `You confirmed "${alias}" means ${c.name}${s.source ? ` (${s.source.label})` : ''}`);
  }

  private async taskCreated(s: Extract<Suggestion, { kind: 'create_task' }>, taskId: string | undefined): Promise<void> {
    const c = await this.client(s.clientId);
    if (!c || !taskId) return;
    const entry: Omit<TaskEntry, 'bullet'> = { clientId: c.id, section: commitmentSection(s.direction), title: s.payload.title, dueDate: s.payload.dueDate, focus: null, done: null };
    const bullet = taskBullet(entry);
    await this.apply(c, [{ section: entry.section, op: 'add', text: bullet }], `Task approved: ${s.payload.title}`);
    this.index[taskId] = { ...entry, bullet };
    await this.tasks.save(this.index);
  }

  private async updateTask(taskId: string, change: (t: TaskEntry) => TaskEntry, label: string): Promise<void> {
    const cur = this.index[taskId];
    if (!cur) return;
    const c = await this.client(cur.clientId);
    if (!c) return;
    const next = change(cur);
    const bullet = taskBullet(next);
    if (bullet === cur.bullet) return;
    const out = await this.apply(c, [{ section: cur.section, op: 'replace', text: bullet, match: cur.bullet }], label);
    // Only follow the line if it was really changed; a person's hand edit wins.
    if (out.applied.length) {
      this.index[taskId] = { ...next, bullet };
      await this.tasks.save(this.index);
    }
  }

  private async replySent(s: Extract<Suggestion, { kind: 'send_reply' }>): Promise<void> {
    const c = await this.client(s.clientId ?? (s.payload.taskId ? this.index[s.payload.taskId]?.clientId : null));
    if (!c) return;
    const markdown = (await this.ctx.profiles.read(c.name)) ?? '';
    let edits: unknown[];
    try {
      edits = await runProfileUpdate(this.ctx.claude, s.id, markdown, s.payload.draft, this.ctx.clock.now());
    } catch (err) {
      if (err instanceof ClaudeError) {
        this.ctx.log(`profile update after reply ${s.id} skipped: ${err.message}`);
        return;
      }
      throw err;
    }
    if (edits.length) await this.queue(() => this.apply(c, edits, `Reply sent: ${s.payload.draft.subject}`));
  }

  /** Wait for queued profile work (tests). */
  idle(): Promise<unknown> {
    return this.serial;
  }
}

/**
 * Hooks receive no context, so one module object serves one brain: `init`
 * binds it. The brain process has one brain; a test that runs several brains
 * at once gives each its own `createProfilesModule()`.
 */
export function createProfilesModule(): BrainModule & { feature(): ProfilesFeature | null } {
  let feature: ProfilesFeature | null = null;
  return {
    name: 'profiles',
    feature: () => feature,
    async init(ctx) {
      feature = new ProfilesFeature(ctx);
      await feature.init();
    },
    onMessageTriaged(e) {
      return feature?.onTriaged(e.triage.clientId, e.triage.confidence, e.triage.profileEdits, e.source.label);
    },
    onSuggestionApplied(e) {
      return feature?.onApplied(e);
    },
  };
}

export const profilesModule = createProfilesModule();

/**
 * In-memory fakes for every connector interface. No network, no files.
 * Each records what was called so tests can assert on it, e.g. "deny calls
 * nothing" is `expect(pm.writeCalls).toEqual([])`.
 */
import { eventSpanMs, toGraphDateTime, type CalEvent, type NewCalEvent } from '../calendar';
import type { ChatMessage } from '../chat';
import type {
  CalendarConnector,
  ChatConnector,
  FilesConnector,
  MailConnector,
  PmConnector,
  SpeechToText,
  SttStream,
  TextToSpeech,
} from '../connectors';
import { mimeTypeFor, type FileContent, type FileInfo } from '../files';
import { makeBodyPreview, type MailDraft, type MailMessage } from '../mail';
import {
  ADHOC_BOARD_ID,
  DEFAULT_DELIVERABLE_TITLE,
  MCP_WRITE_TOOLS,
  type CreateTaskInput,
  type ListTasksInput,
  type McpToolName,
  type PmClient,
  type PmTask,
} from '../pm';
import type { SttEvent } from '../voice';

const FAKE_ME = { name: 'Alex Rivera', address: 'alex.rivera@brightline-advisory.example' };

/** Items strictly after `cursor` by timestamp, oldest first, and the next cursor. */
function since<T>(items: T[], cursor: string, ts: (t: T) => string): { items: T[]; cursor: string } {
  const after = cursor ? Date.parse(cursor) : -Infinity;
  const picked = items.filter((i) => Date.parse(ts(i)) > after).sort((a, b) => Date.parse(ts(a)) - Date.parse(ts(b)));
  return { items: picked, cursor: picked.length ? ts(picked[picked.length - 1]!) : cursor };
}

/** A strictly increasing clock for dropped items, starting at `start`. */
function ticker(start: string): () => string {
  let t = Date.parse(start);
  return () => new Date((t += 1000)).toISOString();
}

// ---- mail ----------------------------------------------------------------

export class FakeMailConnector implements MailConnector {
  readonly messages: MailMessage[];
  readonly sent: { id: string; draft: MailDraft; at: string }[] = [];
  private seq = 0;
  private tick: () => string;

  constructor(initial: MailMessage[] = [], clockStart = '2026-11-13T09:00:00.000Z') {
    this.messages = [...initial];
    this.tick = ticker(clockStart);
  }

  /** Add a new incoming message (like `/_control/mail`). Returns it. */
  deliver(m: { from: { name: string; address: string }; subject: string; body: string; conversationId?: string; receivedDateTime?: string }): MailMessage {
    const id = `fake-mail-${++this.seq}`;
    const msg: MailMessage = {
      id,
      conversationId: m.conversationId ?? `fake-conv-${this.seq}`,
      subject: m.subject,
      from: { emailAddress: m.from },
      toRecipients: [{ emailAddress: FAKE_ME }],
      ccRecipients: [],
      receivedDateTime: m.receivedDateTime ?? this.tick(),
      body: { contentType: 'text', content: m.body },
      bodyPreview: makeBodyPreview(m.body),
      isRead: false,
    };
    this.messages.push(msg);
    return msg;
  }

  async listSince(cursor: string) {
    return since(this.messages, cursor, (m) => m.receivedDateTime);
  }

  async get(id: string): Promise<MailMessage> {
    const m = this.messages.find((x) => x.id === id);
    if (!m) throw new Error(`no message ${id}`);
    return m;
  }

  async send(draft: MailDraft): Promise<{ id: string }> {
    const id = `fake-sent-${++this.seq}`;
    this.sent.push({ id, draft, at: this.tick() });
    return { id };
  }

  /** Put an already-sent message in the Sent folder (test setup; no approval involved). */
  seedSent(draft: MailDraft, at: string): void {
    this.sent.push({ id: `fake-sent-${++this.seq}`, draft, at });
  }

  async listSent(): Promise<MailMessage[]> {
    return [...this.sent]
      .sort((a, b) => a.at.localeCompare(b.at))
      .map(({ id, draft, at }) => ({
        id,
        conversationId: `fake-conv-${id}`,
        subject: draft.subject,
        from: { emailAddress: FAKE_ME },
        toRecipients: draft.to.map((p) => ({ emailAddress: p })),
        ccRecipients: draft.cc.map((p) => ({ emailAddress: p })),
        receivedDateTime: at,
        sentDateTime: at,
        body: { contentType: 'text' as const, content: draft.body },
        bodyPreview: makeBodyPreview(draft.body),
        isRead: true,
      }));
  }
}

// ---- calendar ------------------------------------------------------------

export class FakeCalendarConnector implements CalendarConnector {
  readonly events: CalEvent[];
  readonly created: CalEvent[] = [];
  private seq = 0;

  constructor(initial: CalEvent[] = []) {
    this.events = [...initial];
  }

  /** Convenience: an event from ISO start/end. */
  static event(id: string, subject: string, startIso: string, endIso: string): CalEvent {
    return { id, subject, start: toGraphDateTime(startIso), end: toGraphDateTime(endIso), attendees: [], showAs: 'busy', isAllDay: false, categories: [], bodyPreview: '' };
  }

  async view(startIso: string, endIso: string): Promise<CalEvent[]> {
    const s = Date.parse(startIso);
    const e = Date.parse(endIso);
    return this.events
      .filter((ev) => {
        const span = eventSpanMs(ev);
        return span.start < e && span.end > s;
      })
      .sort((a, b) => eventSpanMs(a).start - eventSpanMs(b).start);
  }

  async createEvent(n: NewCalEvent): Promise<CalEvent> {
    const ev: CalEvent = {
      id: `fake-event-${++this.seq}`,
      subject: n.subject,
      start: n.start,
      end: n.end,
      attendees: n.attendees ?? [],
      showAs: n.showAs ?? 'busy',
      isAllDay: false,
      categories: n.categories ?? [],
      bodyPreview: n.body ? makeBodyPreview(n.body.content) : '',
    };
    this.events.push(ev);
    this.created.push(ev);
    return ev;
  }
}

// ---- chat ----------------------------------------------------------------

export class FakeChatConnector implements ChatConnector {
  readonly messages: ChatMessage[];
  private seq = 0;
  private tick: () => string;

  constructor(initial: ChatMessage[] = [], clockStart = '2026-11-13T09:00:00.000Z') {
    this.messages = [...initial];
    this.tick = ticker(clockStart);
  }

  /** Add a message (like `/_control/chat`): a personal chat with the sender unless `to_channel` is given. */
  deliver(m: { sender: string; sender_display_name: string; message: string; to_channel?: string; date_time?: string }): ChatMessage {
    const date_time = m.date_time ?? this.tick();
    const msg: ChatMessage = {
      id: `fake-chat-${++this.seq}`,
      message: m.message,
      sender: m.sender,
      sender_display_name: m.sender_display_name,
      date_time,
      timestamp: Date.parse(date_time),
      ...(m.to_channel ? { to_channel: m.to_channel } : { to_contact: m.sender }),
    };
    this.messages.push(msg);
    return msg;
  }

  async listSince(cursor: string) {
    return since(this.messages, cursor, (m) => m.date_time);
  }
}

// ---- files ---------------------------------------------------------------

export class FakeFilesConnector implements FilesConnector {
  /** path -> text (utf8) or bytes (base64 when read). */
  constructor(private files: Record<string, string | Uint8Array> = {}, private modified = '2026-11-01T12:00:00.000Z') {}

  private info(path: string): FileInfo {
    const data = this.files[path]!;
    const name = path.split('/').pop()!;
    const mimeType = mimeTypeFor(name);
    if (!mimeType) throw new Error(`unsupported file type: ${path}`);
    const size = typeof data === 'string' ? new TextEncoder().encode(data).length : data.length;
    return { path, name, folder: path.split('/')[0]!, size, modified: this.modified, mimeType };
  }

  async list(folder: string): Promise<FileInfo[]> {
    return Object.keys(this.files)
      .filter((p) => p.startsWith(`${folder}/`))
      .sort()
      .map((p) => this.info(p));
  }

  async read(path: string): Promise<FileContent> {
    if (path.startsWith('/') || path.split('/').includes('..')) throw new Error(`path outside files root: ${path}`);
    const data = this.files[path];
    if (data === undefined) throw new Error(`no file ${path}`);
    const info = this.info(path);
    return typeof data === 'string'
      ? { ...info, encoding: 'utf8', content: data }
      : { ...info, encoding: 'base64', content: Buffer.from(data).toString('base64') };
  }
}

// ---- PM (MCP) ------------------------------------------------------------

export interface PmCall {
  tool: McpToolName;
  args: unknown;
}

/**
 * Implements the five MCP tools over in-memory clients and tasks, with the
 * same defaults as pm-server (Ad-hoc / "General", assigneeIds []).
 */
export class FakePmConnector implements PmConnector {
  readonly calls: PmCall[] = [];
  readonly clients: PmClient[];
  readonly tasks: PmTask[];
  private seq = 0;

  constructor(init: { clients?: PmClient[]; tasks?: PmTask[] } = {}, private now: () => string = () => new Date().toISOString()) {
    this.clients = [...(init.clients ?? [])];
    this.tasks = [...(init.tasks ?? [])];
  }

  /** Calls to create_task, complete_task and reschedule_task, in order. */
  get writeCalls(): PmCall[] {
    return this.calls.filter((c) => (MCP_WRITE_TOOLS as readonly string[]).includes(c.tool));
  }

  async listClients() {
    this.calls.push({ tool: 'list_clients', args: {} });
    return { clients: structuredClone(this.clients) };
  }

  async listTasks(q: ListTasksInput = {}) {
    this.calls.push({ tool: 'list_tasks', args: q });
    const ranged = q.dueFrom !== undefined || q.dueTo !== undefined;
    const tasks = this.tasks.filter(
      (t) =>
        (q.includeDone || !t.done) &&
        (!q.clientId || t.clientId === q.clientId) &&
        (!q.assigneeId || t.assigneeIds.includes(q.assigneeId)) &&
        (!ranged || (t.dueDate !== null && (!q.dueFrom || t.dueDate >= q.dueFrom) && (!q.dueTo || t.dueDate <= q.dueTo))),
    );
    return { tasks: structuredClone(tasks) };
  }

  async createTask(i: CreateTaskInput) {
    this.calls.push({ tool: 'create_task', args: i });
    const client = this.clients.find((c) => c.id === i.clientId);
    if (!client) throw new Error(`no client ${i.clientId}`);
    const task: PmTask = {
      id: `fake-task-${++this.seq}`,
      title: i.title,
      done: false,
      dueDate: i.dueDate ?? null,
      assigneeIds: i.assigneeIds ?? [],
      clientId: client.id,
      clientName: client.name,
      boardId: ADHOC_BOARD_ID,
      boardLabel: 'Ad-hoc',
      deliverableId: i.deliverableId ?? `fake-deliv-general-${client.id}`,
      deliverableTitle: DEFAULT_DELIVERABLE_TITLE,
      updatedAt: this.now(),
    };
    this.tasks.push(task);
    return { task: structuredClone(task) };
  }

  async completeTask(taskId: string) {
    this.calls.push({ tool: 'complete_task', args: { taskId } });
    const t = this.find(taskId);
    t.done = true;
    t.updatedAt = this.now();
    return { task: structuredClone(t) };
  }

  async rescheduleTask(taskId: string, dueDate: string | null) {
    this.calls.push({ tool: 'reschedule_task', args: { taskId, dueDate } });
    const t = this.find(taskId);
    t.dueDate = dueDate;
    t.updatedAt = this.now();
    return { task: structuredClone(t) };
  }

  private find(taskId: string): PmTask {
    const t = this.tasks.find((x) => x.id === taskId);
    if (!t) throw new Error(`no task ${taskId}`);
    return t;
  }
}

// ---- speech --------------------------------------------------------------

/** A recognition stream the test drives with `emit()`. */
export class FakeSttStream implements SttStream {
  bytesWritten = 0;
  closed = false;
  private queue: SttEvent[] = [];
  private wake: (() => void) | null = null;

  write(pcm: Uint8Array): void {
    if (!this.closed) this.bytesWritten += pcm.length;
  }

  /** Make the "speech service" report an event. */
  emit(e: SttEvent): void {
    this.queue.push(e);
    this.wake?.();
  }

  close(): void {
    this.closed = true;
    this.wake?.();
  }

  readonly events: AsyncIterable<SttEvent> = {
    [Symbol.asyncIterator]: async function* (this: FakeSttStream) {
      while (true) {
        if (this.queue.length) {
          yield this.queue.shift()!;
          continue;
        }
        if (this.closed) return;
        await new Promise<void>((r) => (this.wake = r));
        this.wake = null;
      }
    }.bind(this),
  };
}

export class FakeSpeechToText implements SpeechToText {
  readonly streams: FakeSttStream[] = [];
  open(): FakeSttStream {
    const s = new FakeSttStream();
    this.streams.push(s);
    return s;
  }
}

/**
 * Yields `chunksPerText` chunks of silence per `speak` call, `chunkDelayMs`
 * apart, and stops as soon as the signal aborts.
 */
export class FakeTextToSpeech implements TextToSpeech {
  readonly sampleRate = 16000;
  readonly spoken: { text: string; chunks: number; aborted: boolean }[] = [];

  constructor(private opts: { chunksPerText?: number; chunkDelayMs?: number; chunkBytes?: number } = {}) {}

  async *speak(text: string, signal: AbortSignal): AsyncIterable<Uint8Array> {
    const rec = { text, chunks: 0, aborted: false };
    this.spoken.push(rec);
    const n = this.opts.chunksPerText ?? 3;
    for (let i = 0; i < n; i++) {
      if (this.opts.chunkDelayMs) await new Promise((r) => setTimeout(r, this.opts.chunkDelayMs));
      if (signal.aborted) {
        rec.aborted = true;
        return;
      }
      rec.chunks++;
      yield new Uint8Array(this.opts.chunkBytes ?? 640);
    }
  }
}

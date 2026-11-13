/**
 * The fixture brain: an in-memory stand-in that answers the contract's
 * `/api` endpoints from fixture data, so the sidebar can be built and tested
 * before the real brain exists. Behaviour follows the contract README
 * (approve/deny semantics, prepared-suggestion flow, next step, section
 * rules). Nothing in the app may depend on anything this file does beyond
 * the contract.
 */
import {
  ApproveBody,
  PAYLOAD_SCHEMAS,
  SidebarState,
  Suggestion,
  addDaysIso,
  sectionKeyFor,
  sectionKeys,
  sectionLabel,
  toGraphDateTime,
  type CalEvent,
  type MailDraft,
  type PreparedResponse,
  type PreparedWork,
  type SidebarSection,
  type TaskMeta,
} from '@poc/contracts';
import { CLIENTS, INTERNAL_ID, ME, PEOPLE, buildWorld, clientName, droppedEmail, fridayOf, type FixtureWorld, type TaskRec } from './data';

export type Emit = (event: string, data: unknown) => void;

export interface LogEntry {
  at: string;
  action: string;
  id?: string;
  body?: unknown;
}

const PREPARE_MS = 1200;

export class FixtureBrain {
  world!: FixtureWorld;
  log: LogEntry[] = [];
  sent: MailDraft[] = [];
  private listeners = new Set<Emit>();
  private seq = 0;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(
    private readonly clock: () => Date,
    private readonly tz = 'UTC',
  ) {
    this.reset();
  }

  reset(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.world = buildWorld(this.clock(), this.tz);
    this.log = [];
    this.sent = [];
    this.broadcast();
  }

  get today(): string {
    return this.clock().toISOString().slice(0, 10);
  }

  subscribe(fn: Emit): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  broadcast(): void {
    const s = this.state();
    for (const fn of this.listeners) fn('state', s);
  }

  private later(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  private id(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${(this.seq++).toString(36)}`;
  }

  // ---- state --------------------------------------------------------------

  state(): SidebarState {
    const today = this.today;
    const keys = sectionKeys(today);
    const buckets = new Map<string, TaskRec[]>(keys.map((k) => [k, []]));
    for (const t of this.world.tasks) {
      if (t.done) continue;
      const key = sectionKeyFor(t, today, INTERNAL_ID);
      buckets.get(key)?.push(t);
    }
    const sections: SidebarSection[] = keys.map((key) => {
      const items = buckets.get(key)!;
      if (key === 'today') items.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
      else items.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
      return {
        key,
        label: sectionLabel(key),
        items: items.map(({ prepared: _p, readyAt: _r, ...task }) => ({ ...task, order: key === 'today' ? task.order : null })),
      };
    });
    const state: SidebarState = {
      now: this.clock().toISOString(),
      today,
      me: { id: ME.id, name: ME.name },
      clients: CLIENTS,
      sections,
      suggestions: this.world.suggestions.filter((s) => s.status === 'pending' || s.status === 'failed').sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      nudges: [...this.world.nudges].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20),
      calendarToday: this.world.calendar.slice().sort((a, b) => a.start.dateTime.localeCompare(b.start.dateTime)),
      usageToday: this.world.usage,
    };
    return SidebarState.parse(state);
  }

  private task(id: string): TaskRec | undefined {
    return this.world.tasks.find((t) => t.taskId === id);
  }

  private reorderToday(): void {
    const today = this.today;
    const list = this.world.tasks.filter((t) => !t.done && sectionKeyFor(t, today, INTERNAL_ID) === 'today').sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
    list.forEach((t, i) => (t.order = i));
    for (const t of this.world.tasks) if (!list.includes(t)) t.order = null;
  }

  // ---- prepared work ------------------------------------------------------

  private makePrepared(t: TaskRec, regenerated: boolean): PreparedWork {
    const who = Object.values(PEOPLE).find((p) => t.title.includes(p.name.split(' ')[0]!)) ?? PEOPLE.michael;
    const tag = regenerated ? ' (another take)' : '';
    switch (t.taskType) {
      case 'reply_email':
        return { type: 'reply_email', draft: { to: [who], cc: [], subject: `Re: ${t.title}`, body: `Hi ${who.name.split(' ')[0]},\n\nQuick update${tag}: the work is on track and I will send the full summary by end of day.\n\nBest,\nAlex`, replyToMessageId: t.source?.id ?? null } };
      case 'schedule_meeting': {
        const d = addDaysIso(this.today, 1);
        return {
          type: 'schedule_meeting',
          slots: [
            { start: `${d}T10:00:00.000Z`, end: `${d}T10:30:00.000Z` },
            { start: `${d}T15:30:00.000Z`, end: `${d}T16:00:00.000Z` },
          ],
          draft: { to: [who], cc: [], subject: `Re: ${t.title}`, body: `Hi ${who.name.split(' ')[0]},\n\nHappy to meet${tag}. Would either of these work?\n\n- Tomorrow 10:00–10:30\n- Tomorrow 15:30–16:00\n\nBest,\nAlex`, replyToMessageId: null },
        };
      }
      case 'review_file':
        return { type: 'review_file', path: 'Acme Tooling/Market Pricing Summary - Draft v2.md', summary: `The file covers the market pricing for 18 benchmark roles${tag}.`, keyPoints: ['Engineering midpoints moved up about 3%.', 'Two roles have thin survey matches.', 'Sales roles still need a variable pay view.'] };
      case 'follow_up':
        return { type: 'follow_up', draft: { to: [who], cc: [], subject: 'Following up', body: `Hi ${who.name.split(' ')[0]},\n\nJust following up on this${tag}. Could you send it over when you get a moment?\n\nThanks,\nAlex`, replyToMessageId: null } };
      default:
        return { type: 'other', context: [{ label: 'Where this came from', text: t.source?.label ?? 'You added it by hand.', source: t.source }] };
    }
  }

  private startPreparing(t: TaskRec, regenerated: boolean): void {
    if (t.preparedSuggestionId) {
      const old = this.world.suggestions.find((s) => s.id === t.preparedSuggestionId);
      if (old && old.status === 'pending') old.status = 'denied';
    }
    t.preparedStatus = 'preparing';
    t.preparedSuggestionId = null;
    t.prepared = null;
    this.broadcast();
    this.later(PREPARE_MS, () => {
      if (t.done) return;
      const p = this.makePrepared(t, regenerated);
      t.prepared = p;
      t.preparedStatus = 'ready';
      const common = {
        status: 'pending' as const,
        nudge: '',
        clientId: t.clientId,
        clientConfidence: 'high' as const,
        source: t.source,
        taskType: t.taskType ?? undefined,
        createdAt: this.clock().toISOString(),
        decidedAt: null,
        error: null,
      };
      const s: Suggestion =
        p.type === 'reply_email' || p.type === 'follow_up' || p.type === 'schedule_meeting'
          ? { ...common, id: this.id('sg-prep'), kind: 'send_reply', title: `Send: ${p.draft.subject}`, payload: { draft: p.draft, taskId: t.taskId } }
          : { ...common, id: this.id('sg-prep'), kind: 'complete_task', title: `Mark “${t.title}” done`, payload: { taskId: t.taskId } };
      this.world.suggestions.push(s);
      t.preparedSuggestionId = s.id;
      this.broadcast();
    });
  }

  prepared(taskId: string): PreparedResponse | null {
    const t = this.task(taskId);
    if (!t) return null;
    const s = t.preparedSuggestionId ? (this.world.suggestions.find((x) => x.id === t.preparedSuggestionId) ?? null) : null;
    return { taskId, status: t.preparedStatus, prepared: t.prepared, suggestion: s };
  }

  prepare(taskId: string): boolean {
    const t = this.task(taskId);
    if (!t) return false;
    this.log.push({ at: new Date().toISOString(), action: 'prepare', id: taskId });
    this.startPreparing(t, true);
    return true;
  }

  hold(taskId: string, onHold: boolean): TaskMeta | null {
    const t = this.task(taskId);
    if (!t) return null;
    t.onHold = onHold;
    this.log.push({ at: new Date().toISOString(), action: 'hold', id: taskId, body: { onHold } });
    this.reorderToday();
    this.broadcast();
    return {
      taskId,
      source: t.source,
      direction: t.direction ?? 'i_owe',
      taskType: t.taskType ?? 'other',
      onHold: t.onHold,
      order: t.order,
      quickWin: t.quickWin,
      reason: t.reason ?? '',
      prepared: t.prepared,
      preparedStatus: t.preparedStatus,
      preparedSuggestionId: t.preparedSuggestionId,
    };
  }

  // ---- decisions ----------------------------------------------------------

  /** Returns [status, body]. Mirrors the contract: 400 on invalid edits, 404 unknown, 409 already decided. */
  approve(id: string, rawBody: unknown): [number, unknown] {
    const body = ApproveBody.safeParse(rawBody ?? {});
    if (!body.success) return [400, { error: 'Invalid approve body.' }];
    const s = this.world.suggestions.find((x) => x.id === id);
    if (!s) return [404, { error: 'No such suggestion.' }];
    if (s.status !== 'pending' && s.status !== 'failed') return [409, { error: `Already ${s.status}.` }];
    this.log.push({ at: new Date().toISOString(), action: 'approve', id, body: rawBody ?? {} });

    const edits = body.data.edits ?? {};
    const merged = { ...s.payload, ...(edits.payload ?? {}) };
    const p = PAYLOAD_SCHEMAS[s.kind].safeParse(merged);
    if (!p.success) return [400, { error: `Edits are not valid: ${p.error.issues[0]?.message ?? 'invalid'}` }];
    const next = { ...s, payload: p.data, title: edits.title ?? s.title, clientId: edits.clientId ?? s.clientId } as Suggestion;

    const fail = (error: string): [number, unknown] => {
      Object.assign(s, { status: 'failed', error, decidedAt: this.clock().toISOString() });
      this.broadcast();
      return [200, { suggestion: s }];
    };

    switch (next.kind) {
      case 'create_task': {
        if (!next.clientId) return [400, { error: 'Pick a client before approving.' }];
        const due = next.payload.dueDate;
        const t: TaskRec = {
          taskId: this.id('t'),
          title: next.payload.title,
          clientId: next.clientId,
          clientName: clientName(next.clientId),
          dueDate: due,
          done: false,
          assigneeIds: [ME.id],
          taskType: next.taskType ?? 'other',
          direction: next.direction ?? 'i_owe',
          onHold: false,
          // New work lands second in Today ("the list reorders").
          order: due === this.today ? 0.5 : null,
          quickWin: false,
          reason: due === this.today ? 'Just arrived and the client is waiting on it.' : null,
          source: next.source,
          preparedStatus: 'none',
          preparedSuggestionId: null,
          prepared: null,
        };
        this.world.tasks.push(t);
        this.reorderToday();
        this.startPreparing(t, false);
        break;
      }
      case 'complete_task': {
        const t = this.task(next.payload.taskId);
        if (!t) return fail('That task no longer exists in the PM app.');
        t.done = true;
        this.reorderToday();
        // Next step after a file review (contract: source.connector = 'next_step').
        if (t.taskType === 'review_file' && t.preparedSuggestionId === s.id) this.addNextStep(t);
        break;
      }
      case 'reschedule_task': {
        const t = this.task(next.payload.taskId);
        if (!t) return fail('That task no longer exists in the PM app.');
        t.dueDate = next.payload.dueDate;
        this.reorderToday();
        break;
      }
      case 'calendar_block': {
        const e: CalEvent = {
          id: this.id('ev'),
          subject: next.payload.subject,
          start: toGraphDateTime(next.payload.start),
          end: toGraphDateTime(next.payload.end),
          attendees: [],
          showAs: 'busy',
          isAllDay: false,
          categories: [],
          bodyPreview: '',
        };
        this.world.calendar.push(e);
        break;
      }
      case 'send_reply': {
        this.sent.push(next.payload.draft);
        if (next.payload.taskId) {
          const t = this.task(next.payload.taskId);
          if (t) t.done = true;
          this.reorderToday();
        }
        break;
      }
      case 'confirm_client': {
        const cid = edits.clientId ?? (next.payload.candidateClientIds.length === 1 ? next.payload.candidateClientIds[0] : undefined);
        if (!cid) return [400, { error: 'Pick the client first.' }];
        for (const rid of next.payload.relatedSuggestionIds) {
          const r = this.world.suggestions.find((x) => x.id === rid);
          if (r) Object.assign(r, { clientId: cid, clientConfidence: 'high' });
        }
        next.clientId = cid;
        break;
      }
    }
    Object.assign(s, next, { status: 'applied', decidedAt: this.clock().toISOString(), error: null });
    this.world.usage = { ...this.world.usage, calls: this.world.usage.calls + 1, estUsd: this.world.usage.estUsd + 0.0042 };
    this.broadcast();
    return [200, { suggestion: s }];
  }

  deny(id: string): [number, unknown] {
    const s = this.world.suggestions.find((x) => x.id === id);
    if (!s) return [404, { error: 'No such suggestion.' }];
    if (s.status !== 'pending' && s.status !== 'failed') return [409, { error: `Already ${s.status}.` }];
    this.log.push({ at: new Date().toISOString(), action: 'deny', id });
    Object.assign(s, { status: 'denied', decidedAt: this.clock().toISOString() });
    this.broadcast();
    return [200, { suggestion: s }];
  }

  private addNextStep(t: TaskRec): void {
    const contact = PEOPLE.renata;
    const s: Suggestion = {
      id: this.id('sg-next'),
      kind: 'create_task',
      status: 'pending',
      title: `Email ${contact.name.split(' ')[0]} the review notes`,
      nudge: 'Review done. Next: send Renata the three points, so she can fix the levels before Friday.',
      clientId: t.clientId,
      clientConfidence: 'high',
      source: { connector: 'next_step', id: t.taskId, label: `After: ${t.title}` },
      direction: 'i_owe',
      taskType: 'reply_email',
      duplicateOf: null,
      createdAt: this.clock().toISOString(),
      decidedAt: null,
      error: null,
      payload: { title: `Email ${contact.name.split(' ')[0]} the review notes`, dueDate: this.today, assigneeIds: [ME.id] },
    };
    this.world.suggestions.push(s);
  }

  // ---- input and chat -----------------------------------------------------

  /** A typed or spoken task: one create_task suggestion, tagged by a crude nickname match. */
  intake(text: string, connector: 'manual' | 'voice'): Extract<Suggestion, { kind: 'create_task' }> {
    const lower = text.toLowerCase();
    const clientId =
      /michael|lena|acme/.test(lower) ? 'poc-client-acme' : /dmitri|priscilla|harbor/.test(lower) ? 'poc-client-harborlight' : /renata|quill/.test(lower) ? 'poc-client-quillon' : /gareth|tess/.test(lower) ? 'poc-client-tessera' : null;
    const friday = /friday/.test(lower) ? fridayOf(this.today) : null;
    const title = text
      .replace(/^(please\s+)?(can you\s+)?add (a )?task (to )?/i, '')
      .replace(/\s+on friday\.?$|\s+friday\.?$/i, '')
      .replace(/\.$/, '');
    const s: Extract<Suggestion, { kind: 'create_task' }> = {
      id: this.id('sg-in'),
      kind: 'create_task',
      status: 'pending',
      title: title.charAt(0).toUpperCase() + title.slice(1),
      nudge: '',
      clientId,
      clientConfidence: clientId ? 'high' : 'low',
      source: { connector, id: this.id(connector), label: connector === 'voice' ? 'You said it' : 'You typed it' },
      direction: /chase|follow/.test(lower) ? 'owed_to_me' : 'i_owe',
      taskType: /chase|follow/.test(lower) ? 'follow_up' : 'other',
      duplicateOf: null,
      createdAt: this.clock().toISOString(),
      decidedAt: null,
      error: null,
      payload: { title: title.charAt(0).toUpperCase() + title.slice(1), dueDate: friday, assigneeIds: [ME.id] },
    };
    this.world.suggestions.push(s);
    this.broadcast();
    return s;
  }

  /** Scripted assistant reply for a chat turn. */
  reply(text: string): { words: string[]; suggestion: Suggestion | null } {
    const lower = text.toLowerCase();
    if (/add (a )?task|chase|remind me/.test(lower)) {
      const s = this.intake(text, 'manual');
      const when = s.payload.dueDate ? ' for Friday' : '';
      const who = s.clientId ? ` and tagged it ${clientName(s.clientId).replace(/\.$/, '')}` : '';
      return { words: `Done. I’ve drafted that task${when}${who}. Approve it below and it goes into Planr.`.split(/(?<= )/), suggestion: s };
    }
    if (/tell me more/.test(lower)) {
      return { words: 'Michael wants two things: a short status update on the pricing study, and 45 minutes next week to go through the numbers. I’ve suggested a task for each. Tuesday and Wednesday mornings are both free.'.split(/(?<= )/), suggestion: null };
    }
    return {
      words: 'Your most urgent item is the revised pricing summary for Michael: he has asked twice, and the draft is ready to send. After that, the Quillon job levels review fits nicely in the free hour before your 11:30.'.split(/(?<= )/),
      suggestion: null,
    };
  }

  dropEmail(): void {
    const n = this.world.nudges.length;
    const d = droppedEmail(this.clock(), n);
    this.world.suggestions.push(...d.suggestions);
    this.world.nudges.unshift(d.nudge);
    for (const fn of this.listeners) fn('nudge', d.nudge);
    this.broadcast();
  }
}

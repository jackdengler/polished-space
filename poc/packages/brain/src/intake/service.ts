/**
 * Intake: poll mail and chat from the stored cursors, skip processed items,
 * pre-match candidate clients, run ONE triage call per item, store the
 * suggestions, nudge, and tell the modules. Message content can only ever
 * produce suggestions; nothing here can write to an outside system (it only
 * holds read-only connectors).
 */
import { randomUUID } from 'node:crypto';
import { addDaysIso, zonedTime, type ChatMessage, type MailMessage, type PmClient, type PmTask, type SourceRef, type Suggestion, type TimeSlot } from '@poc/contracts';
import { findMeetingSlots, meetingMinutes, preferredSlots } from '../prepare/slots';
import { ClaudeMaxTokensError, ClaudeOutputError, ClaudeRefusalError, SpendCapError, type Claude } from '../claude';
import type { BrainConfig } from '../config';
import type { ReadConnectors } from '../guard';
import type { Registry } from '../modules/registry';
import type { ProfileFiles } from '../profileFiles';
import type { CursorStore, IntakeSource } from '../store/cursors';
import type { NudgeStore } from '../store/nudges';
import type { NewSuggestion, SuggestionStore } from '../store/suggestions';
import { fingerprint, prematch, type Candidate } from './prematch';
import { runTriage, type TriageItem, type TriageOutput } from './triage';

export interface IntakeDeps {
  config: BrainConfig;
  claude: Claude;
  read: ReadConnectors;
  cursors: CursorStore;
  suggestions: SuggestionStore;
  nudges: NudgeStore;
  registry: Registry;
  profiles: ProfileFiles;
  clients(): Promise<PmClient[]>;
  myTasks(): Promise<PmTask[]>;
  log(msg: string): void;
}

/** Outcome of one item: `done` (mark processed) or `retry` (stop this batch, leave the cursor). */
type Outcome = { kind: 'done'; suggestions: Suggestion[] } | { kind: 'retry'; error: Error };

const MAX_PROFILES = 3;
const MAX_CONTEXT_ITEMS = 40;
const RETRY_BACKOFF_MS = 30_000;

function snippet(s: string, n = 60): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Words of a title, for the repeat check: lower case, no punctuation, no filler words. */
const FILLER = new Set(['a', 'an', 'the', 'to', 'on', 'for', 'with', 'about', 'please', 'task', 'add']);
function titleWords(title: string): Set<string> {
  return new Set(title.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((w) => w && !FILLER.has(w)));
}

/**
 * Code-side duplicate guard: a new task whose title matches (nearly word for
 * word) a pending create_task suggestion or an open task for the same client
 * (and the same due date, when both have one) is flagged as a possible duplicate.
 */
export function repeatOf(title: string, clientId: string | null, dueDate: string | null, pending: Suggestion[], tasks: PmTask[]): { kind: 'task' | 'suggestion'; id: string } | null {
  const w = titleWords(title);
  if (!w.size) return null;
  const close = (other: string) => {
    const o = titleWords(other);
    const inter = [...w].filter((x) => o.has(x)).length;
    return inter / new Set([...w, ...o]).size >= 0.8;
  };
  const sameDay = (d: string | null) => !dueDate || !d || d === dueDate;
  const sameClient = (c: string | null) => !clientId || !c || c === clientId;
  const s = pending.find((x) => x.kind === 'create_task' && sameClient(x.clientId) && sameDay(x.payload.dueDate) && close(x.payload.title));
  if (s) return { kind: 'suggestion', id: s.id };
  const t = tasks.find((x) => !x.done && sameClient(x.clientId) && sameDay(x.dueDate) && close(x.title));
  return t ? { kind: 'task', id: t.id } : null;
}

/** The FYI line for a client message that gave nothing to act on. Code-made, so message text cannot steer it. */
function fyiText(item: TriageItem, source: SourceRef): string {
  const who = /^(?:Email|Chat message) from ([^<]+?) </.exec(item.header)?.[1]?.trim() ?? 'Someone';
  const what = item.subject ? `"${snippet(item.subject, 70)}"` : `"${snippet(item.body, 70)}"`;
  return `FYI: ${who} ${source.connector === 'chat' ? 'messaged you' : 'emailed you'} ${what}. I found nothing for you to act on, so I haven't suggested anything. Open it to check.`;
}

export class IntakeService {
  private busy = false;
  private backoffUntil = 0;
  private filesCache: { at: number; byClient: Record<string, string[]> } | null = null;
  private capNudgedDay: string | null = null;

  constructor(private d: IntakeDeps) {}

  /** One poll of mail then chat. Never runs twice at once. */
  async poll(): Promise<void> {
    if (this.busy || Date.now() < this.backoffUntil) return;
    this.busy = true;
    try {
      await this.pollSource('mail');
      await this.pollSource('chat');
    } finally {
      this.busy = false;
    }
  }

  private async pollSource(source: IntakeSource): Promise<void> {
    const start = this.d.cursors.cursor(source) ?? this.d.config.intakeCursor;
    const { items } = source === 'mail' ? await this.d.read.mail.listSince(start) : await this.d.read.chat.listSince(start);
    for (const item of items) {
      const id = item.id;
      const ts = source === 'mail' ? (item as MailMessage).receivedDateTime : (item as ChatMessage).date_time;
      if (this.d.cursors.isProcessed(source, id)) {
        await this.d.cursors.setCursor(source, ts);
        continue;
      }
      const outcome = source === 'mail' ? await this.handleMail(item as MailMessage) : await this.handleChat(item as ChatMessage);
      if (outcome.kind === 'retry') {
        this.backoffUntil = Date.now() + RETRY_BACKOFF_MS;
        return;
      }
    }
  }

  private async finish(source: IntakeSource, id: string, fp: string | null, ts: string, suggestions: Suggestion[]): Promise<Outcome> {
    await this.d.cursors.markProcessed(source, id, fp, ts);
    return { kind: 'done', suggestions };
  }

  async handleMail(m: MailMessage): Promise<Outcome> {
    const me = this.d.config.me.email.toLowerCase();
    const from = m.from.emailAddress;
    const fp = fingerprint('mail', from.address, m.subject, m.body.content);
    if (from.address.toLowerCase() === me) return this.finish('mail', m.id, null, m.receivedDateTime, []);
    if (this.d.cursors.hasFingerprint(fp)) {
      this.d.log(`mail ${m.id} repeats an already processed message; skipped`);
      return this.finish('mail', m.id, null, m.receivedDateTime, []);
    }
    const source: SourceRef = { connector: 'mail', id: m.id, label: `Email from ${from.name}: ${m.subject}`, threadId: m.conversationId };
    const item: TriageItem = {
      kind: 'mail',
      header: `Email from ${from.name} <${from.address}> to ${m.toRecipients.map((r) => r.emailAddress.address).join(', ')}${m.ccRecipients.length ? `, cc ${m.ccRecipients.map((r) => r.emailAddress.address).join(', ')}` : ''}, received ${m.receivedDateTime}`,
      subject: m.subject,
      body: m.body.content,
    };
    const participants = [...m.toRecipients, ...m.ccRecipients].map((r) => r.emailAddress.address).filter((a) => a.toLowerCase() !== me);
    const out = await this.triage(source, item, { sender: from.address, participants, text: `${m.subject}\n${m.body.content}` }, { mail: m });
    if (out.kind === 'retry') return out;
    return this.finish('mail', m.id, fp, m.receivedDateTime, out.suggestions);
  }

  async handleChat(c: ChatMessage): Promise<Outcome> {
    const fp = fingerprint('chat', c.sender, c.to_channel ?? '', c.message);
    if (c.sender.toLowerCase() === this.d.config.me.email.toLowerCase()) return this.finish('chat', c.id, null, c.date_time, []);
    if (this.d.cursors.hasFingerprint(fp)) return this.finish('chat', c.id, null, c.date_time, []);
    const where = c.to_channel ? ` in #${c.channel_name ?? c.to_channel}` : '';
    const source: SourceRef = { connector: 'chat', id: c.id, label: `Chat from ${c.sender_display_name}${where}: ${snippet(c.message)}`, threadId: c.to_channel ?? c.to_contact };
    const item: TriageItem = {
      kind: 'chat',
      header: `Chat message from ${c.sender_display_name} <${c.sender}>${c.to_channel ? ` in channel #${c.channel_name ?? c.to_channel}` : ' (personal chat)'}, sent ${c.date_time}`,
      body: c.message,
    };
    const out = await this.triage(source, item, { sender: c.sender, text: c.message }, { chat: c });
    if (out.kind === 'retry') return out;
    return this.finish('chat', c.id, fp, c.date_time, out.suggestions);
  }

  /** Typed (or spoken) input: the same triage, source `manual` / `voice`. Errors propagate to the caller. */
  async submitText(text: string, connector: 'manual' | 'voice'): Promise<Suggestion[]> {
    const id = `${connector}-${randomUUID()}`;
    const source: SourceRef = { connector, id, label: `${connector === 'voice' ? 'Said' : 'Typed'}: "${snippet(text)}"` };
    const item: TriageItem = { kind: connector, header: `${connector === 'voice' ? 'Said' : 'Typed'} by the user to their assistant (a task to add, not a message from someone else)`, body: text };
    const out = await this.triage(source, item, { text }, {}, { rethrow: true });
    if (out.kind === 'retry') throw out.error;
    return out.suggestions;
  }

  // ---- shared triage ---------------------------------------------------------

  private async filesByClient(clients: PmClient[]): Promise<Record<string, string[]>> {
    if (this.filesCache && Date.now() - this.filesCache.at < 30_000) return this.filesCache.byClient;
    const byClient: Record<string, string[]> = {};
    for (const c of clients) {
      if (!c.fileFolder) continue;
      try {
        byClient[c.id] = (await this.d.read.files.list(c.fileFolder)).map((f) => f.name);
      } catch {
        byClient[c.id] = [];
      }
    }
    this.filesCache = { at: Date.now(), byClient };
    return byClient;
  }

  private async triage(
    source: SourceRef,
    item: TriageItem,
    match: { sender?: string; participants?: string[]; text: string },
    original: { mail?: MailMessage; chat?: ChatMessage },
    opts: { rethrow?: boolean } = {},
  ): Promise<Outcome> {
    const clients = (await this.d.clients()).filter((c) => !c.archived);
    const aliases: Record<string, string[]> = {};
    for (const c of clients) aliases[c.id] = await this.d.profiles.aliases(c.name);
    const candidates = prematch(match, clients, { aliases, files: await this.filesByClient(clients) });
    const top = candidates.slice(0, MAX_PROFILES);
    const profiles: { clientId: string; markdown: string }[] = [];
    for (const cand of top) {
      const c = clients.find((x) => x.id === cand.clientId)!;
      const md = await this.d.profiles.read(c.name);
      if (md) profiles.push({ clientId: c.id, markdown: md });
    }
    const myTasks = await this.d.myTasks();
    const candIds = new Set(top.map((c) => c.clientId));
    const openTasks = (candIds.size ? myTasks.filter((t) => candIds.has(t.clientId)) : myTasks).slice(-MAX_CONTEXT_ITEMS);
    const pending = this.d.suggestions
      .list()
      .filter((s) => s.status === 'pending' && s.kind === 'create_task' && (!candIds.size || !s.clientId || candIds.has(s.clientId)))
      .slice(-MAX_CONTEXT_ITEMS);

    let triage: TriageOutput;
    try {
      triage = await runTriage(this.d.claude, source.id, item, {
        now: this.d.config.clock.now(),
        today: this.d.config.clock.today(),
        tz: this.d.config.clock.tz,
        me: this.d.config.me,
        clients,
        aliases,
        candidates,
        profiles,
        openTasks,
        pendingSuggestions: pending,
        proposeDueDates: this.d.config.proposeDueDates ?? true,
      });
    } catch (err) {
      return this.onTriageError(source, err as Error, opts.rethrow ?? false);
    }

    const suggestions = await this.store(source, triage, candidates, item, myTasks);
    if (source.connector !== 'manual' && source.connector !== 'voice') {
      if (suggestions.length) this.d.nudges.add({ kind: 'new_item', text: triage.nudge || source.label, source, suggestionIds: suggestions.map((s) => s.id) });
      // A client message never disappears silently: nothing to act on still gets a low-key FYI with the source link.
      else this.d.nudges.add({ kind: 'info', text: fyiText(item, source), source });
    }
    this.d.registry.emit('onMessageTriaged', { source, item, ...original, triage, suggestions, candidates });
    return { kind: 'done', suggestions };
  }

  /**
   * Refusal, cut-off or invalid output: the item is marked processed (retrying
   * would cost the same and fail the same) and the user is told. Spend cap and
   * transport errors: stop this batch and retry after a pause; nothing is lost.
   */
  private onTriageError(source: SourceRef, err: Error, rethrow: boolean): Outcome {
    if (err instanceof SpendCapError) {
      const day = this.d.config.clock.today();
      if (this.capNudgedDay !== day) {
        this.capNudgedDay = day;
        this.d.nudges.add({ kind: 'info', text: `I've reached today's Claude budget, so I've paused reading new messages. ${err.message}`, source: null });
      }
      if (rethrow) throw err;
      return { kind: 'retry', error: err };
    }
    if (err instanceof ClaudeRefusalError || err instanceof ClaudeMaxTokensError || err instanceof ClaudeOutputError) {
      this.d.log(`triage of ${source.id} gave no usable answer: ${err.message}`);
      this.d.nudges.add({ kind: 'info', text: `I couldn't read "${source.label}" properly (${err.message}) Please take a look yourself.`, source });
      if (rethrow) throw err;
      return { kind: 'done', suggestions: [] };
    }
    this.d.log(`triage of ${source.id} failed, will retry: ${err.message}`);
    if (rethrow) throw err;
    return { kind: 'retry', error: err };
  }

  /** Candidate meeting times for a schedule-meeting suggestion, computed in code from the calendar (none on a calendar outage). */
  private async meetingSlots(item: TriageItem, title: string): Promise<TimeSlot[]> {
    const { clock } = this.d.config;
    const today = clock.today();
    try {
      const events = await this.d.read.calendar.view(zonedTime(today, 0, clock.tz).toISOString(), zonedTime(addDaysIso(today, 15), 0, clock.tz).toISOString());
      const ask = `${title}\n${item.subject ?? ''}\n${item.body}`;
      return preferredSlots(findMeetingSlots(events, { now: clock.now(), tz: clock.tz, durationMin: meetingMinutes(ask) }), ask, clock.tz, today, 3);
    } catch (err) {
      this.d.log(`meeting slots for a suggestion skipped: ${(err as Error).message}`);
      return [];
    }
  }

  private async store(source: SourceRef, t: TriageOutput, candidates: Candidate[], item: TriageItem, myTasks: PmTask[]): Promise<Suggestion[]> {
    if (!t.tasks.length) return [];
    const me = this.d.config.me.id;
    const pendingNow = this.d.suggestions.list().filter((s) => s.status === 'pending' && s.kind === 'create_task');
    const slotsFor = new Map<number, TimeSlot[]>();
    for (const [i, task] of t.tasks.entries()) if (task.taskType === 'schedule_meeting' && !task.duplicateOf) slotsFor.set(i, await this.meetingSlots(item, task.title));
    const taskInputs: NewSuggestion[] = t.tasks.map((task, i) => ({
      kind: 'create_task',
      title: task.title,
      nudge: t.nudge,
      clientId: t.clientId,
      clientConfidence: t.confidence,
      source,
      direction: task.direction,
      taskType: task.taskType,
      // Claude's judgement first; a code check catches exact and near-exact repeats it missed (D12).
      duplicateOf: task.duplicateOf ?? repeatOf(task.title, t.clientId, task.dueDate, pendingNow, myTasks),
      payload: { title: task.title, dueDate: task.dueDate, assigneeIds: [me], ...(slotsFor.get(i)?.length ? { slots: slotsFor.get(i)! } : {}) },
    }));
    const tasks = await this.d.suggestions.addMany(taskInputs);
    if (t.confidence === 'high' && t.clientId) return tasks;
    const clientIds = new Set((await this.d.clients()).map((c) => c.id));
    const candidateClientIds = [...new Set([...(t.clientId ? [t.clientId] : []), ...candidates.slice(0, 3).map((c) => c.clientId)])].filter((id) => clientIds.has(id));
    const confirm = await this.d.suggestions.add({
      kind: 'confirm_client',
      title: t.alias ? `Which client is "${t.alias}"?` : `Which client is this about?`,
      nudge: t.nudge,
      clientId: t.clientId,
      clientConfidence: 'low',
      source,
      payload: { candidateClientIds, alias: t.alias, relatedSuggestionIds: tasks.map((s) => s.id) },
    });
    return [...tasks, confirm];
  }
}

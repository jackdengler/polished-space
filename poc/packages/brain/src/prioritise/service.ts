/**
 * Prioritise + calendar awareness (Phase 2A).
 *
 * One debounced, serialised `run()`:
 *  1. reads my open tasks, the overlay and the calendar (today to +5 days);
 *  2. offers a 30-minute lunch block when none is on today's calendar (code only);
 *  3. computes the free gap before the next meeting (code only);
 *  4. hashes the input (Today tasks, today's events, the gap rounded to
 *     30-minute buckets, pending create_task suggestions) and, only when the
 *     hash changed, asks Claude (`prioritise`, Sonnet) for the order, quick
 *     wins, the task that fits the gap and an optional focus-block task;
 *  5. writes order / quickWin / reason to the TaskMeta overlay, adds the
 *     `fit_now` nudge, and proposes a focus block as a suggestion.
 *
 * Nothing here writes to an outside system: blocks are `calendar_block`
 * suggestions, which the core executor writes to the calendar only when the
 * user approves them. The overlay and nudges are the assistant's own notes.
 */
import { createHash } from 'node:crypto';
import { addDaysIso, eventSpanMs, sectionKeyFor, weekdayName, zonedTime, type CalEvent, type PmTask, type Suggestion } from '@poc/contracts';
import { ClaudeError } from '../claude';
import type { ModuleContext } from '../modules/types';
import type { TaskMetaPatch } from '../store/taskMeta';
import { findFocusSlot, findLunchSlot, formatTime, gapBeforeNextMeeting, type Gap, type Span } from './calendar/gaps';
import { buildPrioritiseRequest, PrioritiseOutput } from './prompt';

type Block = Extract<Suggestion, { kind: 'calendar_block' }>;
const isBlock = (s: Suggestion): s is Block => s.kind === 'calendar_block';
const MIN = 60_000;

/** "45 minutes", "an hour", "an hour and a half", "1 hour 40 minutes", "2 hours". */
export function durationWords(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${m} minutes`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 1 && r === 0) return 'an hour';
  if (h === 1 && r === 30) return 'an hour and a half';
  const hours = h === 1 ? '1 hour' : `${h} hours`;
  return r ? `${hours} ${r} minutes` : hours;
}

export interface PrioritiseOptions {
  /** Wait this long after a trigger so a burst of changes makes one call. Default 1500 ms. */
  debounceMs?: number;
  /** As time passes, re-check once per this many minutes (the gap shrinks). Default 15. */
  tickMinutes?: number;
  /** Calendar look-ahead for focus slots, in days. Default 5. */
  lookaheadDays?: number;
}

export class Prioritiser {
  private lastHash: string | null = null;
  private lastFitKey: string | null = null;
  private fit: { today: string; taskId: string; sentence: string; meetingId: string; nudgeId: string } | null = null;
  private lastTickBucket: number | null = null;
  private scheduled: { promise: Promise<void>; fire: () => void; timer: NodeJS.Timeout } | null = null;
  private chain: Promise<void> = Promise.resolve();
  private stopped = false;
  /** Claude calls made (for logs and tests). */
  calls = 0;

  constructor(
    private ctx: ModuleContext,
    private opts: PrioritiseOptions = {},
  ) {}

  /** Ask for a run after the debounce. Calls in the window share one run. */
  schedule(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.scheduled) return this.scheduled.promise;
    let fire!: () => void;
    const wait = new Promise<void>((r) => (fire = r));
    const timer = setTimeout(() => fire(), this.opts.debounceMs ?? 1500);
    const promise = wait.then(() => {
      this.scheduled = null;
      const p = this.chain.then(() => (this.stopped ? undefined : this.run())).catch((err) => this.ctx.log(`prioritise run failed: ${(err as Error).message}`));
      this.chain = p;
      return p;
    });
    this.scheduled = { promise, fire, timer };
    return promise;
  }

  /** onTick: re-check when a new time bucket starts (or the day changes). Cheap otherwise. */
  tick(now: Date): Promise<void> | void {
    const bucket = Math.floor(now.getTime() / ((this.opts.tickMinutes ?? 15) * MIN));
    const first = this.lastTickBucket === null;
    if (bucket === this.lastTickBucket) return;
    this.lastTickBucket = bucket;
    if (!first) return this.schedule();
  }

  stop(): void {
    this.stopped = true;
    if (this.scheduled) {
      clearTimeout(this.scheduled.timer);
      this.scheduled.fire(); // let anything awaiting it (brain.idle) finish
    }
  }

  // ---- one run ---------------------------------------------------------------

  async run(): Promise<void> {
    const { clock, config } = this.ctx;
    const now = clock.now();
    const tz = clock.tz;
    const today = clock.today();
    const dayStart = zonedTime(today, 0, tz).getTime();
    const dayEnd = zonedTime(addDaysIso(today, 1), 0, tz).getTime();

    const [tasks, events] = await Promise.all([
      this.ctx.myTasks(),
      this.ctx.read.calendar.view(new Date(dayStart).toISOString(), zonedTime(addDaysIso(today, this.opts.lookaheadDays ?? 5), 0, tz).toISOString()),
    ]);
    const eventsToday = events.filter((e) => {
      const s = eventSpanMs(e);
      return s.start < dayEnd && s.end > dayStart;
    });
    const meta = this.ctx.taskMeta.all();
    const todayTasks = tasks
      .filter((t) => !t.done && sectionKeyFor({ dueDate: t.dueDate, onHold: meta[t.id]?.onHold ?? false, clientId: t.clientId }, today, config.internalClientId) === 'today')
      .sort((a, b) => a.id.localeCompare(b.id));

    // Big work due in the next few days can earn a focus block today or soon (Today is only ordered).
    const soon = addDaysIso(today, 7);
    const upcoming = tasks
      .filter((t) => !t.done && t.dueDate && t.dueDate > today && t.dueDate <= soon && !(meta[t.id]?.onHold ?? false) && t.clientId !== config.internalClientId)
      .sort((a, b) => a.id.localeCompare(b.id));

    await this.proposeLunch(now, today, eventsToday);

    const gap = gapBeforeNextMeeting(eventsToday, now, tz);
    this.refreshFitNow(today, gap, todayTasks);
    const stale = Object.values(meta).filter((m) => m.order !== null && !todayTasks.some((t) => t.id === m.taskId));
    if (stale.length) await this.ctx.taskMeta.upsertMany(stale.map((m) => [m.taskId, { order: null }]));
    if (!todayTasks.length) {
      this.lastHash = null;
      return;
    }

    const pending = this.ctx.suggestions
      .list()
      .filter((s) => s.status === 'pending' && s.kind === 'create_task')
      .sort((a, b) => a.id.localeCompare(b.id));
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          // Overlay defaults (as TaskMetaStore creates them), so our own order write does not change the hash.
          today,
          tasks: todayTasks.map((t) => [t.id, t.title, t.dueDate, t.clientId, meta[t.id]?.taskType ?? 'other', meta[t.id]?.direction ?? 'i_owe']),
          events: eventsToday.map((e) => [e.id, e.subject, e.start.dateTime, e.end.dateTime, e.showAs]),
          gap: gap ? [gap.nextMeeting?.id ?? 'end_of_day', Math.floor(gap.minutes / 30)] : null,
          pending: pending.map((s) => [s.id, s.title]),
          upcoming: upcoming.map((t) => [t.id, t.title, t.dueDate, meta[t.id]?.taskType ?? 'other']),
        }),
      )
      .digest('hex');
    if (hash === this.lastHash) return;

    const req = buildPrioritiseRequest({ now, tz, todayTasks, meta, eventsToday, gap, pending, upcoming });
    let out: PrioritiseOutput;
    try {
      this.calls++;
      out = (await this.ctx.claude.parse({ call: 'prioritise', sourceId: null }, { ...req, maxTokens: 8000 }, PrioritiseOutput)).data;
    } catch (err) {
      if (err instanceof ClaudeError) {
        this.ctx.log(`prioritise skipped: ${err.message}`);
        return;
      }
      throw err;
    }
    this.lastHash = hash;

    await this.writeOrder(todayTasks, out);
    this.nudgeFitNow(today, gap, todayTasks, out);
    await this.proposeFocus(now, today, events, [...todayTasks, ...upcoming], out);
  }

  /** Claude's order, with unknown ids dropped, duplicates removed and missing tasks appended. */
  private async writeOrder(todayTasks: PmTask[], out: PrioritiseOutput): Promise<void> {
    const ids = new Set(todayTasks.map((t) => t.id));
    const seen = new Set<string>();
    const entries: [string, TaskMetaPatch][] = [];
    for (const o of out.order) {
      if (!ids.has(o.taskId) || seen.has(o.taskId)) continue;
      seen.add(o.taskId);
      entries.push([o.taskId, { order: entries.length, quickWin: o.quickWin, reason: o.reason.trim() }]);
    }
    const missing = todayTasks.filter((t) => !seen.has(t.id)).sort((a, b) => a.title.localeCompare(b.title));
    for (const t of missing) entries.push([t.id, { order: entries.length, quickWin: false, reason: '' }]);
    if (missing.length) this.ctx.log(`prioritise: ${missing.length} Today task(s) missing from Claude's order, appended`);
    await this.ctx.taskMeta.upsertMany(entries);
  }

  /**
   * The time part of the fit-now nudge comes from code (the computed gap), never
   * from Claude, so "an hour" can never describe a 1h40m gap (D11). Claude's
   * sentence only says what to work on.
   */
  private fitText(gap: Gap, sentence: string): string {
    const tz = this.ctx.clock.tz;
    const until = gap.nextMeeting ? `before your ${formatTime(gap.nextMeeting.start, tz)} ${gap.nextMeeting.subject}` : 'before the end of your working day';
    return `You've got ${durationWords(gap.minutes)} ${until}. ${sentence.trim()}`;
  }

  /**
   * Keep the one fit-now nudge true on every run (calendar change, task change,
   * time passing): gone when there is no gap or its task left Today, re-worded
   * when the gap changed size (D11).
   */
  private refreshFitNow(today: string, gap: Gap | null, todayTasks: PmTask[]): void {
    const f = this.fit;
    const nudges = this.ctx.nudges.list().filter((n) => n.kind === 'fit_now');
    if (!f || !gap || f.today !== today || f.meetingId !== (gap.nextMeeting?.id ?? 'end_of_day') || !todayTasks.some((t) => t.id === f.taskId)) {
      if (nudges.length) this.ctx.nudges.remove((n) => n.kind === 'fit_now');
      if (f && (!gap || f.today !== today || f.meetingId !== (gap.nextMeeting?.id ?? 'end_of_day') || !todayTasks.some((t) => t.id === f.taskId))) {
        this.fit = null;
        this.lastFitKey = null;
      }
      return;
    }
    const n = nudges.find((x) => x.id === f.nudgeId);
    if (n) this.ctx.nudges.retext(n.id, this.fitText(gap, f.sentence));
  }

  private nudgeFitNow(today: string, gap: Gap | null, todayTasks: PmTask[], out: PrioritiseOutput): void {
    const fit = out.fitNow;
    if (!gap || !fit || !fit.sentence.trim() || !todayTasks.some((t) => t.id === fit.taskId)) return;
    const key = `${today}|${fit.taskId}|${gap.nextMeeting?.id ?? 'end_of_day'}`;
    if (key === this.lastFitKey && this.fit) return; // same advice for the same gap: do not repeat it
    this.lastFitKey = key;
    const next = gap.nextMeeting;
    // One fit-now nudge at a time: the new advice replaces the old.
    this.ctx.nudges.remove((n) => n.kind === 'fit_now');
    const made = this.ctx.nudges.add({
      kind: 'fit_now',
      text: this.fitText(gap, fit.sentence),
      taskId: fit.taskId,
      source: next ? { connector: 'calendar', id: next.id, label: `${next.subject} at ${formatTime(next.start, this.ctx.clock.tz)}` } : null,
    });
    this.fit = { today, taskId: fit.taskId, sentence: fit.sentence, meetingId: next?.id ?? 'end_of_day', nudgeId: made.id };
  }

  // ---- time blocks (suggestions only) ------------------------------------------

  private blocks(): Block[] {
    return this.ctx.suggestions.list().filter(isBlock);
  }

  private pendingBlockSpans(): Span[] {
    return this.blocks()
      .filter((s) => s.status === 'pending')
      .map((s) => ({ start: Date.parse(s.payload.start), end: Date.parse(s.payload.end) }));
  }

  /**
   * 30 minutes for lunch when today's calendar has none. Never re-suggested on
   * a day that already has a lunch suggestion in any state (pending, denied,
   * applied or failed), so a denial today sticks.
   */
  private async proposeLunch(now: Date, today: string, eventsToday: CalEvent[]): Promise<void> {
    const { dayOf, tz } = this.ctx.clock;
    if (this.blocks().some((s) => s.payload.purpose === 'lunch' && dayOf(s.payload.start) === today)) return;
    const slot = findLunchSlot(eventsToday, now, tz, this.pendingBlockSpans());
    if (!slot) return;
    const from = formatTime(slot.start, tz);
    const to = formatTime(slot.end, tz);
    await this.ctx.suggestions.add({
      kind: 'calendar_block',
      title: `Block ${from} to ${to} for lunch`,
      nudge: `You haven't got lunch in the calendar today. Want me to block ${from} to ${to}?`,
      clientId: null,
      clientConfidence: 'high',
      source: { connector: 'calendar', id: `lunch-${today}`, label: "Today's calendar" },
      payload: { subject: 'Lunch', start: new Date(slot.start).toISOString(), end: new Date(slot.end).toISOString(), purpose: 'lunch', taskId: null },
    });
  }

  /**
   * Focus time for the big task Claude named. At most one pending focus
   * suggestion at a time; not re-suggested for a task whose block is pending,
   * applied or failed, or was denied today, or that already has a focus event.
   */
  private async proposeFocus(now: Date, today: string, events: CalEvent[], candidates: PmTask[], out: PrioritiseOutput): Promise<void> {
    const todayTasks = candidates;
    const fb = out.focusBlock;
    const t = fb && todayTasks.find((x) => x.id === fb.taskId);
    if (!fb || !t) return;
    const { dayOf, tz } = this.ctx.clock;
    const focus = this.blocks().filter((s) => s.payload.purpose === 'focus');
    if (focus.some((s) => s.status === 'pending')) return;
    if (focus.some((s) => s.payload.taskId === t.id && (s.status !== 'denied' || dayOf(s.decidedAt ?? s.createdAt) === today))) return;
    if (events.some((e) => e.categories.includes('Focus time') && e.subject.includes(t.title))) return;

    const minutes = Math.min(120, Math.max(30, Math.round((Number.isFinite(fb.minutes) ? fb.minutes : 60) / 15) * 15));
    const slot = findFocusSlot(events, now, tz, minutes, { extraBusy: this.pendingBlockSpans() });
    if (!slot) return;
    const from = formatTime(slot.start, tz);
    const to = formatTime(slot.end, tz);
    const day = dayOf(new Date(slot.start).toISOString());
    const when = day === today ? `${from} to ${to}` : `${from} to ${to} on ${weekdayName(day)}`;
    await this.ctx.suggestions.add({
      kind: 'calendar_block',
      title: `Focus time: ${t.title}`,
      nudge: `"${t.title}" needs a proper run at it. Want me to hold ${when} as focus time?`,
      clientId: t.clientId,
      clientConfidence: 'high',
      source: { connector: 'calendar', id: `focus-${t.id}`, label: `Focus time for ${t.title}` },
      payload: { subject: `Focus: ${t.title}`, start: new Date(slot.start).toISOString(), end: new Date(slot.end).toISOString(), purpose: 'focus', taskId: t.id },
    });
  }
}

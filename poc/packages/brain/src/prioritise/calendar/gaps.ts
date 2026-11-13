/**
 * Calendar maths for prioritise + calendar awareness (plan 3.5: "free gaps
 * and the lunch check are computed in code"). Pure functions: no clock, no
 * I/O. Every function takes `now` and the IANA zone (`POC_TZ`) explicitly so
 * tests can fix both.
 *
 * Times on the wire are UTC (Graph `{ dateTime, timeZone: 'UTC' }`); the
 * working day (hours, lunch window) is local wall-clock time in `tz`.
 */
import { addDaysIso, eventSpanMs, localDate, localMinutes, weekdayIndex, zonedTime, type CalEvent } from '@poc/contracts';

const MIN = 60_000;

export interface WorkHours {
  /** Local minutes after midnight. */
  startMin: number;
  endMin: number;
}

/** POC decision: a 09:00 to 17:30 working day, Monday to Friday. */
export const WORK_HOURS: WorkHours = { startMin: 9 * 60, endMin: 17 * 60 + 30 };
/** A gap shorter than this is not worth a "fits before your next meeting" nudge. */
export const MIN_GAP_MINUTES = 30;
/** Lunch may start from 11:30 and must end by 14:30 local; 12:00 is preferred. */
export const LUNCH = { earliestMin: 11 * 60 + 30, latestEndMin: 14 * 60 + 30, preferredMin: 12 * 60, minutes: 30 } as const;
/** Proposed blocks start on a quarter hour. */
export const STEP_MINUTES = 15;

export interface Span {
  start: number; // epoch ms
  end: number;
}

export interface Gap {
  start: string; // ISO, UTC
  end: string;
  minutes: number;
  /** The busy event that ends the gap, or null when the gap runs to the end of the working day. */
  nextMeeting: { id: string; subject: string; start: string } | null;
}

export const isWorkday = (isoDate: string) => weekdayIndex(isoDate) < 5;

/** Events that block time: not `free`/`workingElsewhere`. All-day busy events block the whole day. */
export function busySpans(events: CalEvent[], extra: Span[] = []): Span[] {
  const spans = events.filter((e) => e.showAs !== 'free' && e.showAs !== 'workingElsewhere').map((e) => eventSpanMs(e));
  return [...spans, ...extra].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
}

/** The working day of `isoDate` as epoch ms. */
export function workDay(isoDate: string, tz: string, hours: WorkHours = WORK_HOURS): Span {
  return { start: zonedTime(isoDate, hours.startMin, tz).getTime(), end: zonedTime(isoDate, hours.endMin, tz).getTime() };
}

/** Free spans inside `window`, given busy spans (merged; touching meetings leave no gap). */
export function freeSpans(window: Span, busy: Span[]): Span[] {
  const out: Span[] = [];
  let cursor = window.start;
  for (const b of busy) {
    if (b.end <= cursor) continue;
    if (b.start >= window.end) break;
    if (b.start > cursor) out.push({ start: cursor, end: Math.min(b.start, window.end) });
    cursor = Math.max(cursor, b.end);
    if (cursor >= window.end) break;
  }
  if (cursor < window.end) out.push({ start: cursor, end: window.end });
  return out;
}

/** Free gaps today from `now` to the end of the working day, at least `minMinutes` long. */
export function freeGapsToday(events: CalEvent[], now: Date, tz: string, opts: { hours?: WorkHours; minMinutes?: number } = {}): Gap[] {
  const today = localDate(now, tz);
  if (!isWorkday(today)) return [];
  const day = workDay(today, tz, opts.hours);
  const window = { start: Math.max(day.start, now.getTime()), end: day.end };
  if (window.start >= window.end) return [];
  const minMs = (opts.minMinutes ?? MIN_GAP_MINUTES) * MIN;
  return freeSpans(window, busySpans(events))
    .filter((s) => s.end - s.start >= minMs)
    .map((s) => toGap(s, events, day.end));
}

/**
 * The free time from now until the next busy event (or the end of the
 * working day), if now is free and it is at least `minMinutes` long.
 * Returns null when a meeting is in progress, outside working hours, on a
 * weekend, or when the gap is too short.
 */
export function gapBeforeNextMeeting(events: CalEvent[], now: Date, tz: string, opts: { hours?: WorkHours; minMinutes?: number } = {}): Gap | null {
  const first = freeGapsToday(events, now, tz, { ...opts, minMinutes: 0 })[0];
  if (!first || Date.parse(first.start) !== now.getTime()) return null; // busy right now, or outside hours
  return first.minutes >= (opts.minMinutes ?? MIN_GAP_MINUTES) ? first : null;
}

function toGap(s: Span, events: CalEvent[], dayEnd: number): Gap {
  const next = s.end < dayEnd ? events.filter((e) => e.showAs !== 'free' && e.showAs !== 'workingElsewhere').find((e) => eventSpanMs(e).start === s.end) : undefined;
  return {
    start: new Date(s.start).toISOString(),
    end: new Date(s.end).toISOString(),
    minutes: Math.floor((s.end - s.start) / MIN),
    nextMeeting: next ? { id: next.id, subject: next.subject, start: new Date(eventSpanMs(next).start).toISOString() } : null,
  };
}

const ceilTo = (ms: number, stepMin: number) => Math.ceil(ms / (stepMin * MIN)) * stepMin * MIN;
const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

/** True when today's calendar already has a lunch block. */
export function hasLunch(events: CalEvent[]): boolean {
  return events.some((e) => /\blunch\b/i.test(e.subject) || e.categories.some((c) => /lunch/i.test(c)));
}

/**
 * A 30-minute lunch slot today: inside the lunch window, starting on a
 * quarter hour no earlier than now, free of busy events and of `extraBusy`
 * (e.g. blocks already proposed). The slot closest to 12:00 wins. Null when
 * lunch is already on the calendar, it is a weekend, or nothing fits.
 */
export function findLunchSlot(events: CalEvent[], now: Date, tz: string, extraBusy: Span[] = []): Span | null {
  const today = localDate(now, tz);
  if (!isWorkday(today) || hasLunch(events)) return null;
  const busy = busySpans(events, extraBusy);
  const from = ceilTo(now.getTime(), STEP_MINUTES);
  const len = LUNCH.minutes * MIN;
  const latestEnd = zonedTime(today, LUNCH.latestEndMin, tz).getTime();
  const preferred = zonedTime(today, LUNCH.preferredMin, tz).getTime();
  let best: Span | null = null;
  for (let t = zonedTime(today, LUNCH.earliestMin, tz).getTime(); t + len <= latestEnd; t += STEP_MINUTES * MIN) {
    if (t < from) continue;
    const slot = { start: t, end: t + len };
    if (busy.some((b) => overlaps(b, slot))) continue;
    if (!best || Math.abs(t - preferred) < Math.abs(best.start - preferred)) best = slot;
  }
  return best;
}

/**
 * The first free `minutes`-long slot for focus time: today from now (on a
 * quarter hour), else on the next working days (up to `days` working days
 * ahead), within working hours. `events` must cover that range.
 */
export function findFocusSlot(events: CalEvent[], now: Date, tz: string, minutes: number, opts: { hours?: WorkHours; extraBusy?: Span[]; days?: number } = {}): Span | null {
  const busy = busySpans(events, opts.extraBusy);
  const len = minutes * MIN;
  let day = localDate(now, tz);
  for (let checked = 0; checked <= (opts.days ?? 1); day = addDaysIso(day, 1)) {
    if (!isWorkday(day)) continue;
    checked++;
    const wd = workDay(day, tz, opts.hours);
    const window = { start: Math.max(wd.start, ceilTo(now.getTime(), STEP_MINUTES)), end: wd.end };
    for (const f of freeSpans(window, busy)) {
      const start = ceilTo(f.start, STEP_MINUTES);
      if (start + len <= f.end) return { start, end: start + len };
    }
  }
  return null;
}

/** "3:30pm" in `tz`. */
export function formatTime(d: Date | string | number, tz: string): string {
  const date = new Date(d);
  const h = Math.floor(localMinutes(date, tz) / 60);
  const m = localMinutes(date, tz) % 60;
  return `${h % 12 === 0 ? 12 : h % 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
}

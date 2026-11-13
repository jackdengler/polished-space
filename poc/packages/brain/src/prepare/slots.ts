/**
 * Meeting slot finder: pure code over the calendar, so proposed times can
 * never overlap an event (Claude only picks among these and words the reply).
 *
 * What counts as busy comes from the one shared rule in
 * `prioritise/calendar/gaps.ts` (`busySpans`), so the "free hour" nudge and
 * the meeting slots can never disagree about which events block time. The
 * stepping (30-minute starts, two-hour spread, lead time) is specific to
 * meeting proposals and stays here.
 */
import { addDaysIso, localDate, weekdayIndex, zonedTime, type CalEvent, type TimeSlot } from '@poc/contracts';
import { busySpans } from '../prioritise/calendar/gaps';

export interface SlotOptions {
  now: Date;
  tz: string;
  durationMin: number;
  /** Working days to look ahead, today included when time is left (default 7). */
  days?: number;
  /** Local working hours, minutes after midnight (default 09:00 to 17:00). */
  dayStartMin?: number;
  dayEndMin?: number;
  /** Granularity of start times (default 30). */
  stepMin?: number;
  /** Earliest start is now + this (default 120). */
  leadMin?: number;
  /** Free time kept before and after each busy event (default 0). */
  bufferMin?: number;
  /** Local spans kept clear (default lunch, 12:00 to 13:00). */
  avoid?: [number, number][];
  /** At most this many per day, spread out (default 3) and in total (default 15). */
  perDay?: number;
  max?: number;
}

/** Candidate meeting slots, earliest first, none overlapping a busy event. */
export function findMeetingSlots(events: CalEvent[], o: SlotOptions): TimeSlot[] {
  const dur = o.durationMin * 60_000;
  const step = (o.stepMin ?? 30) * 60_000;
  const buffer = (o.bufferMin ?? 0) * 60_000;
  const perDay = o.perDay ?? 3;
  const max = o.max ?? 15;
  const earliest = o.now.getTime() + (o.leadMin ?? 120) * 60_000;
  const busy = busySpans(events);
  const out: TimeSlot[] = [];
  let date = localDate(o.now, o.tz);
  let workingDays = 0;
  for (let guard = 0; workingDays < (o.days ?? 7) && guard < 31 && out.length < max; guard++, date = addDaysIso(date, 1)) {
    if (weekdayIndex(date) >= 5) continue;
    workingDays++;
    const dayStart = zonedTime(date, o.dayStartMin ?? 9 * 60, o.tz).getTime();
    const dayEnd = zonedTime(date, o.dayEndMin ?? 17 * 60, o.tz).getTime();
    const avoid = (o.avoid ?? [[12 * 60, 13 * 60]]).map(([a, b]) => ({ start: zonedTime(date, a, o.tz).getTime(), end: zonedTime(date, b, o.tz).getTime() }));
    const blocked = [...busy.map((b) => ({ start: b.start - buffer, end: b.end + buffer })), ...avoid];
    let picked = 0;
    let nextAllowed = -Infinity;
    for (let s = dayStart; s + dur <= dayEnd && picked < perDay && out.length < max; s += step) {
      if (s < earliest || s < nextAllowed) continue;
      const e = s + dur;
      if (blocked.some((b) => s < b.end && e > b.start)) continue;
      out.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString() });
      picked++;
      // Spread the day's options out: the next one starts at least two hours later.
      nextAllowed = s + 2 * 60 * 60_000;
    }
  }
  return out;
}

/** Meeting length asked for in the text ("45 minutes", "an hour"), else 30. Clamped to 15..180. */
export function meetingMinutes(text: string): number {
  const t = text.toLowerCase();
  let m: number | null = null;
  const mins = /(\d{1,3})\s*-?\s*(?:min|mins|minutes)\b/.exec(t);
  const hours = /(\d+(?:\.\d+)?)\s*-?\s*(?:hours?|hrs?)\b/.exec(t);
  if (mins) m = Number(mins[1]);
  else if (hours) m = Math.round(Number(hours[1]) * 60);
  else if (/\bhalf an hour\b/.test(t)) m = 30;
  else if (/\b(?:an|one) hour\b/.test(t)) m = 60;
  return Math.min(180, Math.max(15, m ?? 30));
}

/** "Tuesday 17 November, 14:00-14:45" in the user's zone. */
export function formatSlot(s: TimeSlot, tz: string): string {
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(s.start));
  const time = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  return `${day}, ${time(s.start)}-${time(s.end)}`;
}

const WEEKDAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

/**
 * The best `n` candidates for what the requester asked (named weekdays,
 * "morning"/"afternoon", "next week"), in code, earliest first. Used for the
 * times shown on a schedule-meeting suggestion card before anything is
 * prepared; prepared work then reuses them.
 */
export function preferredSlots(candidates: TimeSlot[], askText: string, tz: string, today: string, n = 3): TimeSlot[] {
  const t = askText.toLowerCase();
  const days = WEEKDAY_NAMES.filter((d) => new RegExp(`\\b${d}s?\\b`).test(t));
  const nextWeek = /\bnext week\b/.test(t);
  const nextMon = addDaysIso(today, 7 - weekdayIndex(today));
  const score = (s: TimeSlot) => {
    const d = new Date(s.start);
    const day = localDate(d, tz);
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(d));
    let v = 0;
    if (days.includes(WEEKDAY_NAMES[weekdayIndex(day)] ?? '')) v += 4;
    if (nextWeek && day >= nextMon && day < addDaysIso(nextMon, 7)) v += 2;
    if (/afternoon/.test(t) && hour >= 12) v += 1;
    if (/morning/.test(t) && hour < 12) v += 1;
    return v;
  };
  const ranked = candidates.map((s, i) => ({ s, i, v: score(s) })).sort((a, b) => b.v - a.v || a.i - b.i);
  // One per day where possible, so the options really differ.
  const out: TimeSlot[] = [];
  const usedDays = new Set<string>();
  const top = ranked[0]?.v ?? 0;
  for (const r of ranked) {
    const day = localDate(new Date(r.s.start), tz);
    if (r.v < top || usedDays.has(day)) continue;
    usedDays.add(day);
    out.push(r.s);
    if (out.length === n) break;
  }
  for (const r of ranked) if (out.length < n && !out.includes(r.s)) out.push(r.s);
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

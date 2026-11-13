/**
 * Meeting slot finder: pure code over the calendar, so proposed times can
 * never overlap an event (Claude only picks among these and words the reply).
 *
 * Note for the lead: MODULES.md names no shared `findMeetingSlots`, and the
 * calendar code in `prioritise/` was still in progress, so this small finder
 * lives here. It can be swapped for a shared one later.
 */
import { addDaysIso, eventSpanMs, localDate, weekdayIndex, zonedTime, type CalEvent, type TimeSlot } from '@poc/contracts';

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

/** Events that block time: anything not shown as free or working elsewhere. */
export function blocksTime(e: CalEvent): boolean {
  return e.showAs !== 'free' && e.showAs !== 'workingElsewhere';
}

/** Candidate meeting slots, earliest first, none overlapping a busy event. */
export function findMeetingSlots(events: CalEvent[], o: SlotOptions): TimeSlot[] {
  const dur = o.durationMin * 60_000;
  const step = (o.stepMin ?? 30) * 60_000;
  const buffer = (o.bufferMin ?? 0) * 60_000;
  const perDay = o.perDay ?? 3;
  const max = o.max ?? 15;
  const earliest = o.now.getTime() + (o.leadMin ?? 120) * 60_000;
  const busy = events.filter(blocksTime).map(eventSpanMs);
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

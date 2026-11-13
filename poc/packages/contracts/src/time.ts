/**
 * Clock and date helpers shared by every piece. Pure functions with no
 * `process` access, so the sidebar (browser) can use them too.
 *
 * POC decisions:
 * - "Now" is `POC_NOW` when set (tests, demos), else the real clock.
 * - The working day is in one IANA zone, `POC_TZ` (default `UTC`). Compose
 *   passes it to every container (also as `TZ`), and the seed reads it.
 * - Weeks run Monday to Sunday.
 */

/** Parse `POC_NOW` (pass `process.env.POC_NOW`); falls back to the real clock. Throws on a bad value. */
export function resolveNow(pocNow?: string | null): Date {
  if (!pocNow) return new Date();
  const ms = Date.parse(pocNow);
  if (Number.isNaN(ms)) throw new Error(`POC_NOW is not an ISO date-time: ${pocNow}`);
  return new Date(ms);
}

export const DEFAULT_TZ = 'UTC';

/** The calendar date (`YYYY-MM-DD`) of `date` in time zone `tz`. */
export function localDate(date: Date, tz: string = DEFAULT_TZ): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Minutes since local midnight of `date` in `tz` (0..1439). */
export function localMinutes(date: Date, tz: string = DEFAULT_TZ): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}

/**
 * The instant of local wall-clock time `minutes` after midnight on `isoDate`
 * in `tz`. Handles any fixed or DST offset by correcting once.
 */
export function zonedTime(isoDate: string, minutes: number, tz: string = DEFAULT_TZ): Date {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  const offsetMin = (at: number) => {
    const local = localDate(new Date(at), tz);
    const [ly, lm, ld] = local.split('-').map(Number) as [number, number, number];
    return (Date.UTC(ly, lm - 1, ld, 0, localMinutes(new Date(at), tz)) - at) / 60000;
  };
  const first = guess - offsetMin(guess) * 60000;
  return new Date(guess - offsetMin(first) * 60000);
}

/** `YYYY-MM-DD` plus `n` days. */
export function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Day of week for `YYYY-MM-DD`, Monday = 0 ... Sunday = 6. */
export function weekdayIndex(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** Monday of the week containing `iso`. */
export function weekStart(iso: string): string {
  return addDaysIso(iso, -weekdayIndex(iso));
}

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export function weekdayName(iso: string): (typeof WEEKDAYS)[number] {
  return WEEKDAYS[weekdayIndex(iso)]!;
}

/** The first date strictly after `today` that falls on `weekday` (Mon=0). "Friday" said on a Friday means next week's. */
export function nextWeekday(today: string, weekday: number): string {
  const diff = (weekday - weekdayIndex(today) + 7) % 7 || 7;
  return addDaysIso(today, diff);
}

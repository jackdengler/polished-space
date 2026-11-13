// All calendar dates are ISO strings ("YYYY-MM-DD") handled in UTC, so time zones never shift a day.

const MS_PER_DAY = 86_400_000;

export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const pad = (n: number) => String(n).padStart(2, '0');

/** Build an ISO date; month is 1–12. */
export function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isValidYmd(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month) && year >= 1900 && year <= 2200;
}

export function parseIso(iso: string): { year: number; month: number; day: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { year: y!, month: m!, day: d! };
}

/** Whole days since 1970-01-01. */
export function dayNumber(iso: string): number {
  const { year, month, day } = parseIso(iso);
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

export function fromDayNumber(n: number): string {
  const d = new Date(n * MS_PER_DAY);
  return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function addDays(iso: string, days: number): string {
  return fromDayNumber(dayNumber(iso) + days);
}

/** Today in the user's local time zone. */
export function todayIso(now: Date = new Date()): string {
  return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** "Oct 28" (adds the year when it differs from `relativeTo`'s year). */
export function formatShort(iso: string, relativeTo: string = todayIso()): string {
  const { year, month, day } = parseIso(iso);
  const base = `${MONTH_SHORT[month - 1]} ${day}`;
  return year === parseIso(relativeTo).year ? base : `${base}, ${year}`;
}

/** "Oct 28, 2026" */
export function formatLong(iso: string): string {
  const { year, month, day } = parseIso(iso);
  return `${MONTH_SHORT[month - 1]} ${day}, ${year}`;
}

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** 0 = Sunday … 6 = Saturday. (1970-01-01, day 0, was a Thursday.) */
export const dayOfWeek = (iso: string) => (((dayNumber(iso) + 4) % 7) + 7) % 7;
export const weekdayShort = (iso: string) => WEEKDAY_SHORT[dayOfWeek(iso)]!;
export const isWeekend = (iso: string) => dayOfWeek(iso) === 0 || dayOfWeek(iso) === 6;

/** The Monday on or before this date. */
export const mondayOf = (iso: string) => addDays(iso, -((dayOfWeek(iso) + 6) % 7));

/** Due-date display: "Tue Oct 28" (adds the year when it differs from today's). */
export function formatDue(iso: string, relativeTo: string = todayIso()): string {
  return `${weekdayShort(iso)} ${formatShort(iso, relativeTo)}`;
}

/** "10/28/26" — the format people type. */
export function formatNumeric(iso: string): string {
  const { year, month, day } = parseIso(iso);
  return `${month}/${day}/${pad(year % 100)}`;
}

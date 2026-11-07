import { addDays, dayOfWeek, daysInMonth, formatLong, formatNumeric, formatShort, isoDate, isValidYmd, MONTH_SHORT, dayNumber, parseIso, todayIso } from './dates';

/**
 * A date that is either exact ("10/28/26") or a broader period ("Fall 2026").
 * Periods carry a start and end so they sort and place on the timeline.
 */
export type FlexDate =
  | { kind: 'exact'; date: string }
  | { kind: 'range'; label: string; start: string; end: string };

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

function monthIndex(word: string): number | null {
  const w = word.replace(/\.$/, '');
  if (w.length < 3) return null;
  if (w === 'sept') return 9;
  const i = MONTH_NAMES.findIndex((name) => name.startsWith(w));
  return i === -1 ? null : i + 1;
}

function parseYear(token: string): number | null {
  const t = token.replace(/^'/, '');
  if (/^\d{4}$/.test(t)) return Number(t);
  if (/^\d{2}$/.test(t)) return 2000 + Number(t);
  return null;
}

const exact = (y: number, m: number, d: number): FlexDate | null =>
  isValidYmd(y, m, d) ? { kind: 'exact', date: isoDate(y, m, d) } : null;

/** Range over whole months, from month `m1` of `y1` to month `m2` of `y2` (inclusive). */
function months(label: string, y1: number, m1: number, y2: number, m2: number): FlexDate {
  return { kind: 'range', label, start: isoDate(y1, m1, 1), end: isoDate(y2, m2, daysInMonth(y2, m2)) };
}

const SEASONS: Record<string, { name: string; from: number; to: number }> = {
  spring: { name: 'Spring', from: 3, to: 5 },
  summer: { name: 'Summer', from: 6, to: 8 },
  fall: { name: 'Fall', from: 9, to: 11 },
  autumn: { name: 'Fall', from: 9, to: 11 },
  winter: { name: 'Winter', from: 12, to: 2 }, // Winter 2026 = Dec 2026 – Feb 2027
};

const PART = '(early|mid|late)';
const YEAR = "('?\\d{2}|\\d{4})";

/** How far back a yearless date may be before it snaps to next year. */
const SNAP_GRACE_DAYS = 31;

/**
 * Smart year snapping for dates typed without a year ("11/2", "Mar 3"):
 * the next occurrence, except dates up to 31 days ago stay in this year.
 * In November, "11/2" is this year and "1/15" is next January.
 */
export function snapYear(month: number, day: number, today: string = todayIso()): FlexDate | null {
  const { year } = parseIso(today);
  for (let y = year; y <= year + 4; y++) { // up to 4 years ahead, for Feb 29
    if (!isValidYmd(y, month, day)) continue; // e.g. Feb 29 only in leap years
    const iso = isoDate(y, month, day);
    if (dayNumber(iso) >= dayNumber(today) - SNAP_GRACE_DAYS) return { kind: 'exact', date: iso };
  }
  return null;
}

/** Parse free text into a FlexDate. Returns null if it isn't understood. Yearless dates snap (see snapYear). */
export function parseFlexDate(input: string, today: string = todayIso()): FlexDate | null {
  const s = input.trim().toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ');
  if (!s) return null;
  let m: RegExpMatchArray | null;

  // 2026-10-28
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return exact(+m[1]!, +m[2]!, +m[3]!);

  // 10/28/26, 10/28/2026, 10-28-26
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) {
    const y = parseYear(m[3]!);
    return y === null ? null : exact(y, +m[1]!, +m[2]!);
  }

  // today / tomorrow / a weekday ("fri", "next mon") → the next such day (today counts)
  if (s === 'today') return { kind: 'exact', date: today };
  if (s === 'tomorrow' || s === 'tmrw') return { kind: 'exact', date: addDays(today, 1) };
  if ((m = s.match(/^(next )?(sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)[a-z]*$/))) {
    const target = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(m[2]!.slice(0, 3));
    let ahead = (target - dayOfWeek(today) + 7) % 7;
    if (m[1] && ahead === 0) ahead = 7; // "next fri" on a Friday means a week out
    return { kind: 'exact', date: addDays(today, ahead) };
  }

  // 11/2 → snapped to the right year
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})$/))) return snapYear(+m[1]!, +m[2]!, today);

  // Nov 2, March 3rd → snapped (a bare 1–2 digit number after a month is a day; years need 4 digits or an apostrophe)
  if ((m = s.match(/^([a-z]+\.?) (\d{1,2})(?:st|nd|rd|th)?$/))) {
    const mo = monthIndex(m[1]!);
    if (mo) return snapYear(mo, +m[2]!, today);
  }

  // 11/2026
  if ((m = s.match(/^(\d{1,2})\/(\d{4})$/))) {
    const mo = +m[1]!, y = +m[2]!;
    return mo >= 1 && mo <= 12 ? months(`${MONTH_SHORT[mo - 1]} ${y}`, y, mo, y, mo) : null;
  }

  // Oct 28 2026, October 28th '26
  if ((m = s.match(new RegExp(`^([a-z]+\\.?) (\\d{1,2})(?:st|nd|rd|th)? ${YEAR}$`)))) {
    const mo = monthIndex(m[1]!), y = parseYear(m[3]!);
    return mo && y !== null ? exact(y, mo, +m[2]!) : null;
  }

  // Q4 2026
  if ((m = s.match(new RegExp(`^q([1-4]) ${YEAR}$`)))) {
    const q = +m[1]!, y = parseYear(m[2]!)!;
    return months(`Q${q} ${y}`, y, q * 3 - 2, y, q * 3);
  }

  // H1 2026
  if ((m = s.match(new RegExp(`^h([12]) ${YEAR}$`)))) {
    const h = +m[1]!, y = parseYear(m[2]!)!;
    return months(`H${h} ${y}`, y, h === 1 ? 1 : 7, y, h === 1 ? 6 : 12);
  }

  // Early 2027, mid-2026, late 2026
  if ((m = s.match(new RegExp(`^${PART}[ -]${YEAR}$`)))) {
    const part = m[1]!, y = parseYear(m[2]!)!;
    const [from, to] = part === 'early' ? [1, 4] : part === 'mid' ? [5, 8] : [9, 12];
    return months(`${cap(part)} ${y}`, y, from, y, to);
  }

  // Early Nov 2026, late-november '26
  if ((m = s.match(new RegExp(`^${PART}[ -]([a-z]+\\.?) ${YEAR}$`)))) {
    const part = m[1]!, mo = monthIndex(m[2]!), y = parseYear(m[3]!);
    if (!mo || y === null) return null;
    const last = daysInMonth(y, mo);
    const [d1, d2] = part === 'early' ? [1, 10] : part === 'mid' ? [11, 20] : [21, last];
    return { kind: 'range', label: `${cap(part)} ${MONTH_SHORT[mo - 1]} ${y}`, start: isoDate(y, mo, d1), end: isoDate(y, mo, d2) };
  }

  // Nov 2026, November '26, Fall 2026
  if ((m = s.match(new RegExp(`^([a-z]+\\.?) ${YEAR}$`)))) {
    const word = m[1]!, y = parseYear(m[2]!)!;
    const season = SEASONS[word];
    if (season) {
      const endYear = season.to < season.from ? y + 1 : y;
      return months(`${season.name} ${y}`, y, season.from, endYear, season.to);
    }
    const mo = monthIndex(word);
    return mo ? months(`${MONTH_SHORT[mo - 1]} ${y}`, y, mo, y, mo) : null;
  }

  // 2026
  if ((m = s.match(/^(\d{4})$/))) {
    const y = +m[1]!;
    return y >= 1900 && y <= 2200 ? months(`${y}`, y, 1, y, 12) : null;
  }

  return null;
}

const cap = (w: string) => w[0]!.toUpperCase() + w.slice(1);

export const flexStart = (f: FlexDate) => (f.kind === 'exact' ? f.date : f.start);
export const flexEnd = (f: FlexDate) => (f.kind === 'exact' ? f.date : f.end);

/** Chronological order: by start, then by end (an exact date sorts before a period starting the same day). */
export function compareFlex(a: FlexDate, b: FlexDate): number {
  return dayNumber(flexStart(a)) - dayNumber(flexStart(b)) || dayNumber(flexEnd(a)) - dayNumber(flexEnd(b));
}

/** Display text: "Oct 28, 2026" or "Fall 2026". */
export function formatFlex(f: FlexDate): string {
  return f.kind === 'exact' ? formatLong(f.date) : f.label;
}

/** Compact display: "Oct 28" (year shown if not this year) or "Fall 2026". */
export function formatFlexShort(f: FlexDate, today?: string): string {
  return f.kind === 'exact' ? formatShort(f.date, today) : f.label;
}

/** The text to put back in an input box for editing. */
export function flexToInput(f: FlexDate): string {
  return f.kind === 'exact' ? formatNumeric(f.date) : f.label;
}

export const FLEX_HINT = 'e.g. 11/12, 10/28/26, Nov 2026, Q1 2027, Fall 2026';

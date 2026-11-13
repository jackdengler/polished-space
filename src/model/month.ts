import { addDays, daysInMonth, isoDate, mondayOf, parseIso } from './dates';
import type { Client } from './schema';
import { buildWeek, type WeekItem, type WeekMeeting } from './week';

/**
 * The month calendar: weekdays only, trimmed to the weeks that touch the
 * month. Built from buildWeek, so rows, weekend→Friday and kickoffs behave
 * exactly like This week; "only mine" drops other people's work.
 */
export interface Month {
  /** "2026-11" */
  month: string;
  /** Each week's Mon–Fri dates. */
  weeks: string[][];
  items: Record<string, WeekItem[]>;
  meetings: Record<string, WeekMeeting[]>;
}

export interface MonthOptions { meId: string; month: string; today: string; hideDone: boolean; onlyMine: boolean }

export const monthOf = (iso: string) => iso.slice(0, 7);

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y!, m! - 1 + by, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Mondays of the weeks that include a weekday of the month. */
export function monthMondays(month: string): string[] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const first = isoDate(y, m, 1), last = isoDate(y, m, daysInMonth(y, m));
  const out: string[] = [];
  for (let mon = mondayOf(first); mon <= last; mon = addDays(mon, 7)) {
    const fri = addDays(mon, 4);
    // Skip a week whose weekdays are all outside the month (e.g. the 1st is a Saturday).
    if (fri >= first) out.push(mon);
  }
  return out;
}

export function buildMonth(clients: Client[], o: MonthOptions): Month {
  const weeks: string[][] = [];
  const items: Record<string, WeekItem[]> = {};
  const meetings: Record<string, WeekMeeting[]> = {};
  for (const monday of monthMondays(o.month)) {
    const w = buildWeek(clients, { meId: o.meId, monday, today: o.today, showWeekend: false, hideDone: o.hideDone });
    weeks.push(w.days);
    for (const d of w.days) {
      items[d] = [...w.mine[d]!, ...(o.onlyMine ? [] : w.others[d]!)];
      meetings[d] = w.meetings[d]!;
    }
  }
  return { month: o.month, weeks, items, meetings };
}

export const inMonth = (iso: string, month: string) => iso.slice(0, 7) === month;
export const dayOfMonth = (iso: string) => parseIso(iso).day;

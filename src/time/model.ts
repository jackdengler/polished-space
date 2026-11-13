import { z } from 'zod';
import { addDays, dayOfWeek, isoDate, todayIso } from '../model/dates';

/**
 * Time tracking — pure logic (no React, no storage), unit-tested.
 * One running timer at a time; nothing is written as an entry until Stop.
 * Client, deliverable and OpenAir task are each optional.
 */

export const TimeEntrySchema = z.object({
  id: z.string(),
  clientId: z.string().nullable(),
  deliverableId: z.string().nullable(),
  openAirTaskId: z.string().nullable(),
  note: z.string(),
  /** Exact, never rounded. */
  startISO: z.string(),
  endISO: z.string(),
  /** Local calendar day of the start (a timer past midnight files under its start day). */
  dayKey: z.string(),
});
export type TimeEntry = z.infer<typeof TimeEntrySchema>;

export const TimerSchema = z.object({
  startedAtISO: z.string(),
  clientId: z.string().nullable(),
  deliverableId: z.string().nullable(),
  openAirTaskId: z.string().nullable(),
  note: z.string(),
});
export type Timer = z.infer<typeof TimerSchema>;

export const PersonalTimeSchema = z.object({
  entries: z.array(TimeEntrySchema).default([]),
  timer: TimerSchema.nullable().default(null),
});
export type PersonalTime = z.infer<typeof PersonalTimeSchema>;

export type Target = Partial<Pick<Timer, 'clientId' | 'deliverableId' | 'openAirTaskId' | 'note'>>;

const newId = () => `te_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/** Local "YYYY-MM-DD" of a moment. */
export const localDay = (iso: string) => todayIso(new Date(iso));
export const durationMs = (e: { startISO: string; endISO: string }) => Math.max(0, Date.parse(e.endISO) - Date.parse(e.startISO));

export function startTimer(target: Target, now: Date): Timer {
  return {
    startedAtISO: now.toISOString(),
    clientId: target.clientId ?? null,
    deliverableId: target.deliverableId ?? null,
    openAirTaskId: target.openAirTaskId ?? null,
    note: target.note ?? '',
  };
}

/** The entry a stop produces, or null for a zero-length timer. */
export function stopTimer(timer: Timer, now: Date, id: string = newId()): TimeEntry | null {
  const endISO = now.toISOString();
  if (Date.parse(endISO) - Date.parse(timer.startedAtISO) < 1000) return null;
  return {
    id, clientId: timer.clientId, deliverableId: timer.deliverableId, openAirTaskId: timer.openAirTaskId,
    note: timer.note, startISO: timer.startedAtISO, endISO, dayKey: localDay(timer.startedAtISO),
  };
}

/**
 * Change what the running timer is on. Switching from one client to another
 * saves the stretch so far and RESTARTS the timer at now (the old app kept the
 * start time and counted that stretch twice). A timer with no client just moves.
 */
export function retarget(timer: Timer, patch: Target, now: Date): { timer: Timer; saved: TimeEntry | null } {
  const switchingClient = patch.clientId !== undefined && patch.clientId !== timer.clientId && timer.clientId !== null;
  if (!switchingClient) return { timer: { ...timer, ...patch }, saved: null };
  const saved = stopTimer(timer, now);
  return { timer: { ...startTimer({ ...timer, ...patch, deliverableId: patch.deliverableId ?? null }, now) }, saved };
}

/** Clean data from storage: drop duplicate ids; keep entries sorted newest first. */
export function normalize(data: PersonalTime): PersonalTime {
  const seen = new Set<string>();
  const entries = data.entries.filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)));
  entries.sort((a, b) => Date.parse(b.startISO) - Date.parse(a.startISO));
  return { entries, timer: data.timer };
}

// ---------- Formatting ----------

/** Live clock: "12s", "4m 12s", "1h 5m". */
export function formatClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Totals: "1h 5m", "45m", "0m". */
export function formatTotal(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  return m % 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 60)}h`;
}

/** "9:05 AM" */
export function formatTimeOfDay(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours(), m = d.getMinutes();
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// ---------- Weeks (Saturday–Friday, like OpenAir) ----------

export const weekStartSat = (day: string) => addDays(day, -((dayOfWeek(day) + 1) % 7));

// ---------- Rounding (per cell, then summed) ----------

export type Rounding = 'none' | '0.1' | '0.25';
export function roundHours(ms: number, r: Rounding): number {
  const h = ms / 3_600_000;
  if (r === 'none') return Math.round(h * 100) / 100;
  const step = Number(r);
  return Math.round(Math.round(h / step) * step * 100) / 100;
}

// ---------- Smart time typing ----------

/**
 * Parses "9am", "9:30 PM", "14:30" or a bare "9" into minutes after midnight.
 * A bare hour (no am/pm, ≤ 12) is read relative to the other time:
 *   end: the next such hour after the start; start: the previous one before the end.
 * Returns minutes, possibly < 0 or ≥ 1440 when it rolls across midnight.
 */
export function parseTimeOfDay(text: string, role: 'start' | 'end', otherMinutes: number | null): number | null {
  const s = text.trim().toLowerCase().replace(/\s+/g, '').replace(/\./g, '');
  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?(a|am|p|pm)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (min > 59) return null;
  const mer = m[3];
  if (mer) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (mer.startsWith('p') ? 12 : 0);
    return h * 60 + min;
  }
  if (h > 23) return null;
  if (h > 12 || h === 0 || m[1]!.length === 2 && m[1]!.startsWith('0') || otherMinutes === null) return h * 60 + min; // 24-hour or no reference
  // Ambiguous 1–12: try AM and PM (and the day before/after) and pick relative to the other time.
  const options = [-1440, 0, 1440].flatMap((day) => [h % 12, (h % 12) + 12].map((hh) => day + hh * 60 + min));
  if (role === 'end') return options.filter((o) => o > otherMinutes).sort((a, b) => a - b)[0] ?? null;
  return options.filter((o) => o < otherMinutes).sort((a, b) => b - a)[0] ?? null;
}

/** Local day + minutes after its midnight → ISO (minutes may roll into the next/previous day). */
export function atMinutes(day: string, minutes: number): string {
  const [y, mo, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, mo - 1, d, 0, minutes).toISOString();
}
export const minutesOf = (iso: string) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };

// ---------- Grouping for the list ----------

export interface Group { key: string; clientId: string | null; deliverableId: string | null; openAirTaskId: string | null; entries: TimeEntry[]; ms: number }
export interface Day { day: string; groups: Group[]; ms: number }
export interface Week { start: string; days: Day[]; ms: number }

export function groupEntries(entries: TimeEntry[], sortName: (g: Group) => [string, string, string]): Week[] {
  const byWeek = new Map<string, Map<string, TimeEntry[]>>();
  for (const e of entries) {
    const w = weekStartSat(e.dayKey);
    if (!byWeek.has(w)) byWeek.set(w, new Map());
    const days = byWeek.get(w)!;
    if (!days.has(e.dayKey)) days.set(e.dayKey, []);
    days.get(e.dayKey)!.push(e);
  }
  const weeks: Week[] = [];
  for (const [start, days] of byWeek) {
    const dayList: Day[] = [];
    for (const [day, list] of days) {
      const groups = new Map<string, Group>();
      for (const e of list) {
        const key = `${e.clientId ?? ''}|${e.deliverableId ?? ''}|${e.openAirTaskId ?? ''}`;
        if (!groups.has(key)) groups.set(key, { key, clientId: e.clientId, deliverableId: e.deliverableId, openAirTaskId: e.openAirTaskId, entries: [], ms: 0 });
        const g = groups.get(key)!;
        g.entries.push(e);
        g.ms += durationMs(e);
      }
      const gs = [...groups.values()];
      for (const g of gs) g.entries.sort((a, b) => Date.parse(b.startISO) - Date.parse(a.startISO));
      gs.sort((a, b) => {
        const [ca, oa, da] = sortName(a), [cb, ob, db] = sortName(b);
        return ca.localeCompare(cb) || (oa ? (ob ? oa.localeCompare(ob) : -1) : ob ? 1 : 0) || da.localeCompare(db);
      });
      dayList.push({ day, groups: gs, ms: gs.reduce((n, g) => n + g.ms, 0) });
    }
    dayList.sort((a, b) => b.day.localeCompare(a.day));
    weeks.push({ start, days: dayList, ms: dayList.reduce((n, d) => n + d.ms, 0) });
  }
  return weeks.sort((a, b) => b.start.localeCompare(a.start));
}

// ---------- Weekly timesheet ----------

export interface SheetRow { key: string; clientId: string | null; openAirTaskId: string | null; hours: number[]; notes: string[][]; total: number }
export interface Sheet { days: string[]; rows: SheetRow[]; dayTotals: number[]; total: number }

export function timesheet(entries: TimeEntry[], weekStart: string, rounding: Rounding): Sheet {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const cells = new Map<string, { clientId: string | null; openAirTaskId: string | null; ms: number[]; notes: string[][] }>();
  for (const e of entries) {
    const i = days.indexOf(e.dayKey);
    if (i < 0) continue;
    const key = `${e.clientId ?? ''}|${e.openAirTaskId ?? ''}`;
    if (!cells.has(key)) cells.set(key, { clientId: e.clientId, openAirTaskId: e.openAirTaskId, ms: days.map(() => 0), notes: days.map(() => []) });
    const c = cells.get(key)!;
    c.ms[i]! += durationMs(e);
    if (e.note.trim()) c.notes[i]!.push(e.note.trim());
  }
  const rows = [...cells.entries()].map(([key, c]) => {
    const hours = c.ms.map((ms) => roundHours(ms, rounding)); // round each cell, then add
    return { key, clientId: c.clientId, openAirTaskId: c.openAirTaskId, hours, notes: c.notes, total: sum(hours) };
  });
  const dayTotals = days.map((_, i) => sum(rows.map((r) => r.hours[i]!)));
  return { days, rows, dayTotals, total: sum(dayTotals) };
}
const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;

export { isoDate };

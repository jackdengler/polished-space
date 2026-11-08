import { describe, expect, it } from 'vitest';
import {
  atMinutes, formatClock, formatTotal, groupEntries, normalize, parseTimeOfDay, retarget, roundHours, startTimer, stopTimer,
  timesheet, weekStartSat, type TimeEntry,
} from './model';

const at = (h: number, m = 0, day = '2026-11-09') => new Date(atMinutes(day, h * 60 + m));

describe('timer', () => {
  it('writes nothing until stop, and skips a zero-length timer', () => {
    const t = startTimer({ clientId: 'c1', note: 'deck' }, at(9));
    expect(stopTimer(t, at(9))).toBeNull();
    const e = stopTimer(t, at(10, 30), 'e1')!;
    expect(e).toMatchObject({ id: 'e1', clientId: 'c1', note: 'deck', dayKey: '2026-11-09' });
    expect(Date.parse(e.endISO) - Date.parse(e.startISO)).toBe(90 * 60000);
  });

  it('switching client saves the stretch and restarts at now (no double counting)', () => {
    const t = startTimer({ clientId: 'c1' }, at(9));
    const { timer, saved } = retarget(t, { clientId: 'c2' }, at(10));
    expect(saved!.clientId).toBe('c1');
    expect(timer.clientId).toBe('c2');
    expect(timer.startedAtISO).toBe(at(10).toISOString());
    const after = stopTimer(timer, at(11))!;
    expect((Date.parse(saved!.endISO) - Date.parse(saved!.startISO)) + (Date.parse(after.endISO) - Date.parse(after.startISO))).toBe(2 * 3600000);
  });

  it('a timer with no client just moves; note/deliverable edits keep the start', () => {
    const t = startTimer({}, at(9));
    expect(retarget(t, { clientId: 'c2' }, at(10))).toMatchObject({ saved: null, timer: { clientId: 'c2', startedAtISO: t.startedAtISO } });
    expect(retarget({ ...t, clientId: 'c1' }, { note: 'x', deliverableId: 'd' }, at(10)).timer.startedAtISO).toBe(t.startedAtISO);
  });

  it('a timer past midnight files under its start day', () => {
    const t = startTimer({}, at(23, 30, '2026-11-09'));
    expect(stopTimer(t, at(1, 0, '2026-11-10'))!.dayKey).toBe('2026-11-09');
  });

  it('drops duplicate ids on load', () => {
    const e = { id: 'x', clientId: null, deliverableId: null, openAirTaskId: null, note: '', startISO: at(9).toISOString(), endISO: at(10).toISOString(), dayKey: '2026-11-09' };
    expect(normalize({ entries: [e, e], timer: null }).entries).toHaveLength(1);
  });
});

describe('formatting, weeks, rounding', () => {
  it('formats clocks and totals', () => {
    expect([formatClock(12000), formatClock(252000), formatClock(3900000)]).toEqual(['12s', '4m 12s', '1h 5m']);
    expect([formatTotal(2700000), formatTotal(3900000), formatTotal(7200000)]).toEqual(['45m', '1h 5m', '2h']);
  });
  it('starts weeks on Saturday', () => {
    expect(weekStartSat('2026-11-07')).toBe('2026-11-07'); // Saturday
    expect(weekStartSat('2026-11-13')).toBe('2026-11-07'); // Friday
    expect(weekStartSat('2026-11-14')).toBe('2026-11-14');
  });
  it('rounds hours', () => {
    expect(roundHours(50 * 60000, '0.25')).toBe(0.75);
    expect(roundHours(50 * 60000, '0.1')).toBe(0.8);
    expect(roundHours(50 * 60000, 'none')).toBe(0.83);
  });
});

describe('smart time typing', () => {
  it.each([
    ['9am', 'start', null, 540], ['9:30 PM', 'end', null, 1290], ['14:30', 'end', null, 870], ['12am', 'start', null, 0], ['12pm', 'start', null, 720],
    ['5', 'end', 9 * 60, 17 * 60],        // end after a 9:00 start → 5 PM
    ['11', 'end', 9 * 60, 11 * 60],       // → 11 AM
    ['9', 'start', 17 * 60, 9 * 60],      // start before a 5 PM end → 9 AM
    ['1', 'end', 23 * 60, 1440 + 60],     // after 11 PM → 1 AM next day
    ['11', 'start', 60, -60],             // before 1 AM → 11 PM the day before
  ] as const)('%s (%s, other=%s) → %s', (text, role, other, want) => {
    expect(parseTimeOfDay(text, role, other)).toBe(want);
  });
  it('rejects nonsense', () => {
    expect(parseTimeOfDay('25', 'start', null)).toBeNull();
    expect(parseTimeOfDay('9:75', 'start', null)).toBeNull();
    expect(parseTimeOfDay('soon', 'start', null)).toBeNull();
  });
});

describe('grouping and timesheet', () => {
  const e = (id: string, day: string, h: number, mins: number, clientId: string, oa: string | null = null, note = ''): TimeEntry => ({
    id, clientId, deliverableId: null, openAirTaskId: oa, note, startISO: atMinutes(day, h * 60), endISO: atMinutes(day, h * 60 + mins), dayKey: day,
  });
  const entries = [e('a', '2026-11-09', 9, 30, 'acme', 'oa1', 'prep'), e('b', '2026-11-09', 10, 20, 'acme', 'oa1'), e('c', '2026-11-10', 9, 50, 'bolt'), e('d', '2026-11-06', 9, 60, 'acme')];
  it('groups Week → Day → client/deliverable/OpenAir with totals', () => {
    const weeks = groupEntries(entries, (g) => [g.clientId ?? '', g.openAirTaskId ?? '', g.deliverableId ?? '']);
    expect(weeks.map((w) => w.start)).toEqual(['2026-11-07', '2026-10-31']);
    expect(weeks[0]!.days.map((d) => d.day)).toEqual(['2026-11-10', '2026-11-09']);
    expect(weeks[0]!.days[1]!.groups).toHaveLength(1);
    expect(weeks[0]!.days[1]!.ms).toBe(50 * 60000);
    expect(weeks[0]!.ms).toBe(100 * 60000);
  });
  it('builds a Sat–Fri timesheet, rounding each cell before summing', () => {
    const s = timesheet(entries, '2026-11-07', '0.25');
    expect(s.days[0]).toBe('2026-11-07');
    const acme = s.rows.find((r) => r.clientId === 'acme')!;
    expect(acme.hours[2]).toBe(0.75); // 50 minutes on Monday → 0.75
    expect(acme.notes[2]).toEqual(['prep']);
    expect(s.total).toBe(1.5); // acme Mon 0.75 + bolt Tue 0.75
  });
});

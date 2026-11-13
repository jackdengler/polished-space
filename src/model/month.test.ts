import { describe, expect, it } from 'vitest';
import type { Client, Task } from './schema';
import { buildMonth, monthMondays, shiftMonth } from './month';

const t0 = '2026-01-01T00:00:00.000Z';
let n = 0;
const task = (title: string, who: string[], due: string): Task => ({ id: `t${++n}`, createdAt: t0, updatedAt: t0, title, assigneeIds: who, dueDate: due, done: false, subtasks: [], keyFor: [] });
const client = (team: string[], tasks: Task[]): Client => ({
  id: 'c', createdAt: t0, updatedAt: t0, name: 'Acme', logo: null, teamMemberIds: team, plannedThrough: null, archived: false,
  adhoc: { deliverables: [{ id: 'd', createdAt: t0, updatedAt: t0, title: 'General', tasks }] }, meetings: [],
});

describe('month calendar', () => {
  it('lists the weeks with weekdays in the month', () => {
    expect(monthMondays('2026-11')).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30']); // Nov 1 is a Sunday
    expect(monthMondays('2026-08')).toEqual(['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31']); // Aug 1 is a Saturday
    expect(monthMondays('2026-10')[0]).toBe('2026-09-28'); // Oct 1 is a Thursday
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });

  it('places my and others’ tasks, weekend on Friday, and can show only mine', () => {
    const c = client(['me'], [task('Mine', ['me'], '2026-11-10'), task('Theirs', ['pat'], '2026-11-10'), task('Sat', ['me'], '2026-11-14')]);
    const opts = { meId: 'me', month: '2026-11', today: '2026-11-07', hideDone: false, onlyMine: false };
    const m = buildMonth([c], opts);
    expect(m.weeks).toHaveLength(5);
    expect(m.items['2026-11-10']!.map((i) => (i.kind === 'task' ? i.task.title : ''))).toEqual(['Mine', 'Theirs']);
    expect(m.items['2026-11-13']!.map((i) => i.weekendTag)).toEqual(['Sat']);
    expect(buildMonth([c], { ...opts, onlyMine: true }).items['2026-11-10']!).toHaveLength(1);
  });
});

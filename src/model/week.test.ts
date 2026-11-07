import { describe, expect, it } from 'vitest';
import { dayOfWeek, formatDue, isWeekend, mondayOf } from './dates';
import { SCHEMA_VERSION, WorkspaceSchema, type Client, type Task } from './schema';
import { buildWeek } from './week';

describe('weekday helpers', () => {
  it('knows the day of week', () => {
    expect(dayOfWeek('2026-11-07')).toBe(6); // Saturday
    expect(isWeekend('2026-11-08')).toBe(true);
    expect(isWeekend('2026-11-09')).toBe(false);
    expect(mondayOf('2026-11-08')).toBe('2026-11-02');
    expect(mondayOf('2026-11-09')).toBe('2026-11-09');
    expect(mondayOf('2026-11-13')).toBe('2026-11-09');
  });
  it('formats due dates with the weekday', () => {
    expect(formatDue('2026-10-28', '2026-11-07')).toBe('Wed Oct 28');
    expect(formatDue('2027-01-04', '2026-11-07')).toBe('Mon Jan 4, 2027');
  });
});

// ---- fixtures (fictional) ----
const t0 = '2026-01-01T00:00:00.000Z';
let n = 0;
const task = (title: string, assignee: string | string[] | null, dueDate: string | null, done = false): Task =>
  ({ id: `t${++n}`, createdAt: t0, updatedAt: t0, title, assigneeIds: assignee === null ? [] : ([] as string[]).concat(assignee), dueDate, done, subtasks: [], keyFor: [] });
const client = (name: string, team: string[], tasks: Task[], extra: Partial<Client> = {}): Client => ({
  id: `c-${name}`, createdAt: t0, updatedAt: t0, name, logo: null, teamMemberIds: team, plannedThrough: null, archived: false,
  adhoc: { deliverables: [{ id: `d-${name}`, createdAt: t0, updatedAt: t0, title: 'General', tasks }] },
  meetings: [], ...extra,
});

const ME = 'me', PAT = 'pat';
const opts = { meId: ME, monday: '2026-11-09', today: '2026-11-11', showWeekend: false, hideDone: false };

describe('buildWeek', () => {
  const mine = client('Acme', [ME], [
    task('My Tue', ME, '2026-11-10'),
    task('Pat Wed', PAT, '2026-11-11'),
    task('Nobody Thu', null, '2026-11-12'),
    task('Shared Thu', [PAT, ME], '2026-11-12'),
    task('My Sat', ME, '2026-11-14'),
    task('Overdue mine', ME, '2026-11-03'),
    task('Overdue done', ME, '2026-11-03', true),
    task('Next week', ME, '2026-11-16'),
    task('No date', ME, null),
  ], {
    meetings: [{
      id: 'm1', createdAt: t0, updatedAt: t0, title: 'Readout', date: { kind: 'exact', date: '2026-11-12' },
      kickoff: { date: '2026-11-10', done: false }, deliverables: [],
    }, {
      id: 'm2', createdAt: t0, updatedAt: t0, title: 'Later', date: { kind: 'range', label: 'Q1 2027', start: '2027-01-01', end: '2027-03-31' },
      kickoff: { date: '2026-11-02', done: false }, deliverables: [],
    }],
  });
  const notMine = client('Bolt', [PAT], [task('Pat elsewhere', PAT, '2026-11-10'), task('Me elsewhere', ME, '2026-11-10')]);
  const archived = client('Old', [ME], [task('Archived', ME, '2026-11-10')], { archived: true });

  const titles = (items: { kind: string }[]) => items.map((i) => (i as { task?: Task }).task?.title ?? i.kind);

  it('splits my work from others at my clients, Mon–Fri', () => {
    const w = buildWeek([mine, notMine, archived], opts);
    expect(w.days).toEqual(['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']);
    expect(titles(w.mine['2026-11-10']!)).toEqual(['My Tue', 'kickoff', 'Me elsewhere']);
    expect(titles(w.others['2026-11-11']!)).toEqual(['Pat Wed']);
    expect(titles(w.others['2026-11-12']!)).toEqual(['Nobody Thu']);
    expect(titles(w.mine['2026-11-12']!)).toEqual(['Shared Thu']); // shared with me → my work
    // Other people's work at clients I'm not on is not shown.
    expect(Object.values(w.others).flat().some((i) => i.client.name === 'Bolt')).toBe(false);
  });

  it('puts weekend tasks on Friday with a tag when the weekend is hidden', () => {
    const w = buildWeek([mine], opts);
    const fri = w.mine['2026-11-13']!;
    expect(titles(fri)).toEqual(['My Sat']);
    expect(fri[0]!.weekendTag).toBe('Sat');
    const w7 = buildWeek([mine], { ...opts, showWeekend: true });
    expect(w7.days).toHaveLength(7);
    expect(titles(w7.mine['2026-11-14']!)).toEqual(['My Sat']);
    expect(w7.mine['2026-11-14']![0]!.weekendTag).toBeNull();
  });

  it('collects open overdue items (tasks and kickoffs) only for the current week', () => {
    const w = buildWeek([mine], opts);
    expect(w.showOverdue).toBe(true);
    expect(titles(w.overdueMine)).toEqual(['kickoff', 'Overdue mine']); // oldest first
    const next = buildWeek([mine], { ...opts, monday: '2026-11-16' });
    expect(next.showOverdue).toBe(false);
    expect(next.overdueMine).toEqual([]);
  });

  it('shows exact-dated meetings at my clients, and can hide done work', () => {
    const w = buildWeek([mine], opts);
    expect(w.meetings['2026-11-12']!.map((m) => m.meeting.title)).toEqual(['Readout']);
    const withDone = client('Done', [ME], [task('Finished', ME, '2026-11-10', true)]);
    expect(titles(buildWeek([withDone], opts).mine['2026-11-10']!)).toEqual(['Finished']);
    expect(buildWeek([withDone], { ...opts, hideDone: true }).mine['2026-11-10']).toEqual([]);
  });
});

describe('clientDueStatus', () => {
  const today = '2026-11-07'; // Saturday; this week ends Sun Nov 8, next week ends Sun Nov 15
  const c = (dates: (string | null)[], done = false) => client('X', [], dates.map((d, i) => task(`t${i}`, null, d, done)));
  it('picks the most urgent open work', async () => {
    const { clientDueStatus } = await import('./derive');
    expect(clientDueStatus(c(['2026-11-15', '2026-11-08', '2026-11-06']), today)!.status).toBe('overdue');
    expect(clientDueStatus(c(['2026-11-15', '2026-11-08']), today)!.status).toBe('thisWeek');
    expect(clientDueStatus(c(['2026-11-15', '2026-11-20']), today)!.status).toBe('nextWeek');
    expect(clientDueStatus(c(['2026-11-20', null]), today)).toBeNull();
    expect(clientDueStatus(c(['2026-11-06'], true), today)).toBeNull(); // done tasks don't count
    expect(clientDueStatus(c(['2026-11-06', '2026-11-08', '2026-11-09']), today)!.counts).toEqual({ overdue: 1, thisWeek: 1, nextWeek: 1 });
  });
});

describe('sidebar schedule', () => {
  const today = '2026-11-07';
  const meeting = (id: string, date: string, title = '') => ({ id, createdAt: t0, updatedAt: t0, title, date: { kind: 'exact' as const, date }, kickoff: null,
    deliverables: [{ id: `d${id}`, createdAt: t0, updatedAt: t0, title: 'Peer group', tasks: [] }, { id: `e${id}`, createdAt: t0, updatedAt: t0, title: 'Trends', tasks: [] }] });
  it('labels clients and sorts by next meeting', async () => {
    const { clientSchedule, compareBySchedule, meetingLabel, plannedStatus } = await import('./derive');
    const soon = client('Soon', [], [], { meetings: [meeting('a', '2026-11-20'), meeting('b', '2026-10-01')] });
    const later = client('Later', [], [], { meetings: [meeting('c', '2027-01-05')] });
    const past = client('Past', [], [], { meetings: [meeting('d', '2026-01-05')] });
    const none = client('Adhoc', [], []);
    expect(clientSchedule(soon, today)).toMatchObject({ kind: 'next', meeting: { id: 'a' } });
    expect(clientSchedule(past, today).kind).toBe('notScheduled');
    expect(clientSchedule(none, today).kind).toBe('adhocOnly');
    expect([none, past, later, soon].sort((x, y) => compareBySchedule(x, y, today)).map((c) => c.name)).toEqual(['Soon', 'Later', 'Past', 'Adhoc']);
    expect(meetingLabel(meeting('x', '2026-11-20'))).toBe('Peer group +1');
    expect(plannedStatus({ ...soon, plannedThrough: { kind: 'exact', date: '2026-11-01' } }, today)).toEqual({ kind: 'passed', days: 6 });
    expect(plannedStatus({ ...soon, plannedThrough: { kind: 'exact', date: '2026-11-27' } }, today)).toEqual({ kind: 'soon', days: 20 });
    expect(plannedStatus({ ...soon, plannedThrough: { kind: 'exact', date: '2027-03-01' } }, today)).toBeNull();
  });
});

describe('tasksAsText', () => {
  it('formats a paste-ready list', async () => {
    const { tasksAsText } = await import('./derive');
    const d = (title: string, tasks: Task[]) => ({ id: title, createdAt: t0, updatedAt: t0, title, tasks });
    expect(tasksAsText([d('Peer group', [task('Pull proxy data', null, '2026-11-12'), task('Draft slides', null, null)]), d('Empty', [])]))
      .toBe('Peer group\n11/12 (Thu): Pull proxy data\nTBD: Draft slides');
  });
});

describe('schema defaults', () => {
  it('loads files saved before key tasks and kickoffs existed', () => {
    const old = {
      schemaVersion: SCHEMA_VERSION, teamMembers: [],
      clients: [{
        id: 'c', createdAt: t0, updatedAt: t0, name: 'X', logo: null, teamMemberIds: [], plannedThrough: null, archived: false,
        adhoc: { deliverables: [{ id: 'd', createdAt: t0, updatedAt: t0, title: 'G', tasks: [{ id: 't', createdAt: t0, updatedAt: t0, title: 'T', assigneeId: 'm9', dueDate: null, done: false, subtasks: [] }] }] },
        meetings: [{ id: 'm', createdAt: t0, updatedAt: t0, title: '', date: { kind: 'exact', date: '2026-11-12' }, deliverables: [] }],
      }],
    };
    const ws = WorkspaceSchema.parse(old);
    expect(ws.clients[0]!.adhoc.deliverables[0]!.tasks[0]!.keyFor).toEqual([]);
    expect(ws.clients[0]!.adhoc.deliverables[0]!.tasks[0]!.assigneeIds).toEqual(['m9']); // old single assignee migrates
    expect(ws.clients[0]!.meetings[0]!.kickoff).toBeNull();
  });
});

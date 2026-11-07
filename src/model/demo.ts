import { addDays, parseIso, todayIso } from './dates';
import { parseFlexDate, type FlexDate } from './flexDate';
import { SCHEMA_VERSION, type Client, type Deliverable, type Meeting, type Task, type TeamMember, type Workspace } from './schema';

/**
 * Realistic-looking sample data for trying the app, built relative to today
 * so there is always a mix of past, current, upcoming and overdue work.
 * All names are fictional.
 */
export function makeDemoWorkspace(today: string = todayIso()): Workspace {
  let seq = 0;
  const t0 = new Date().toISOString();
  const id = (p: string) => `demo-${p}-${++seq}`;
  const rec = (p: string) => ({ id: id(p), createdAt: t0, updatedAt: t0 });
  let rand = 7;
  const rnd = () => ((rand = (rand * 16807) % 2147483647) / 2147483647);

  const team: TeamMember[] = ([
    ['Alex Rivera', '#5b6ea8', 'Principal'], ['Priya Shah', '#4f8a8b', 'Consultant'], ['Marcus Lee', '#6a8f6b', 'Sr Associate'], ['Dana Kim', '#9a7b4f', 'Sr Consultant'],
    ['Sam Ortiz', '#8c6b8f', 'Associate'], ['Taylor Brooks', '#a06a5f', 'Consultant'], ['Jordan Ellis', '#6f7d93', 'Associate'], ['Riley Chen', '#7d7a55', 'Sr Associate'],
  ] as const).map(([name, color, role]) => ({ id: id('member'), name, color, role }));

  const flex = (text: string): FlexDate => parseFlexDate(text)!;
  const on = (offset: number): FlexDate => ({ kind: 'exact', date: addDays(today, offset) });
  const { year, month } = parseIso(today);
  const q = Math.ceil(month / 3);
  const quarter = (ahead: number) => {
    const n = q - 1 + ahead;
    return flex(`Q${(n % 4) + 1} ${year + Math.floor(n / 4)}`);
  };
  /** The season containing the date ~3·ahead months from today, e.g. "Spring 2027". */
  const season = (ahead: number) => {
    const { year: y, month: m } = parseIso(addDays(today, 91 * ahead));
    if (m === 12) return flex(`Winter ${y}`);
    if (m <= 2) return flex(`Winter ${y - 1}`);
    return flex(`${m <= 5 ? 'Spring' : m <= 8 ? 'Summer' : 'Fall'} ${y}`);
  };

  /** Build a task assigned to one of `assignees`. */
  function task(title: string, assignees: string[], dueDay: string | null, done: boolean, subs: string[] = []): Task {
    return {
      ...rec('task'), title, done,
      assigneeIds: assignees.length ? [assignees[Math.floor(rnd() * assignees.length)]!] : [],
      dueDate: dueDay,
      subtasks: subs.map((s, i) => ({ ...rec('sub'), title: s, done: done || (i === 0 && rnd() > 0.4) })),
      keyFor: [],
    };
  }

  const LIBRARY: Record<string, [string, string[]?][]> = {
    'Market pricing analysis': [
      ['Collect HRIS census file', ['Confirm field list', 'Check for missing job codes']],
      ['Match benchmark jobs to surveys'],
      ['Age survey data to effective date'],
      ['QA match quality with client HR', ['Prep match review sheet', 'Schedule review call']],
    ],
    'Salary structure draft': [
      ['Set midpoint progression'],
      ['Build grade ranges'],
      ['Model cost to bring under-min employees to minimum'],
    ],
    'Incentive plan review': [
      ['Summarize current bonus plan'],
      ['Benchmark target bonus levels'],
      ['Draft plan design options', ['Option A: team pool', 'Option B: individual targets']],
    ],
    'Pay equity audit': [
      ['Define comparator groups'],
      ['Run regression model'],
      ['Write findings memo'],
    ],
    'Job architecture': [
      ['Draft career levels'],
      ['Map current titles to levels'],
      ['Review with department heads'],
    ],
    'Board comp committee deck': [
      ['Outline storyline'],
      ['Build peer group charts'],
      ['Final formatting & proofread'],
    ],
    'Executive benchmarking': [
      ['Select proxy peer group'],
      ['Pull proxy data'],
      ['Summarize CEO & CFO positioning'],
    ],
  };

  function deliverable(name: string, assignees: string[], meetingDay: string, progress: number): Deliverable {
    const items = LIBRARY[name]!;
    return {
      ...rec('deliv'), title: name,
      tasks: items.map(([title, subs], i) => {
        const due = addDays(meetingDay, -2 * (items.length - i) - 1);
        return task(title, assignees, due, rnd() < progress, subs);
      }),
    };
  }

  function meeting(title: string, date: FlexDate, deliverables: string[], assignees: string[], progress: number): Meeting {
    const day = date.kind === 'exact' ? date.date : date.start;
    // Upcoming meetings get a kickoff ~3 weeks before (when that's still ahead or this week).
    const kickoffDay = addDays(day, -21);
    const kickoff = date.kind === 'exact' && progress < 1 && kickoffDay >= addDays(today, -7) ? { date: kickoffDay, done: progress > 0.3 } : null;
    return { ...rec('meeting'), title, date, kickoff, deliverables: deliverables.map((d) => deliverable(d, assignees, day, progress)) };
  }

  const pick = (...idx: number[]) => idx.map((i) => team[i]!.id);

  function client(name: string, members: string[], planned: FlexDate | null, meetings: Meeting[], adhoc: Task[], archived = false): Client {
    return {
      ...rec('client'), name, logo: null, teamMemberIds: members, plannedThrough: planned, archived,
      adhoc: { deliverables: [{ ...rec('deliv'), title: 'General', tasks: adhoc }] },
      meetings,
    };
  }

  const nw = pick(0, 1, 2);
  const bb = pick(3, 4);
  const sc = pick(0, 5, 6);
  const hp = pick(1, 7);
  const at = pick(2, 3, 6);

  const clients: Client[] = [
    client('Northwind Health', nw, quarter(2), [
      meeting('Kickoff', on(-48), ['Market pricing analysis'], nw, 1),
      meeting('Market data review', on(-12), ['Market pricing analysis', 'Job architecture'], nw, 0.8),
      meeting('Structure working session', on(9), ['Salary structure draft', 'Job architecture'], nw, 0.45),
      meeting('Leadership readout', on(37), ['Board comp committee deck'], nw, 0),
      meeting('Incentive design', quarter(1), ['Incentive plan review'], nw, 0),
    ], [
      task('Send updated SOW for signature', nw, addDays(today, -3), false),
      task('Request 2026 org chart', nw, addDays(today, 6), false),
      task('Set up shared data folder', nw, null, true),
    ]),
    client('Bluebird Logistics', bb, season(1), [
      meeting('Intro & data request', on(-20), ['Market pricing analysis'], bb, 0.9),
      meeting('Pay equity findings', on(16), ['Pay equity audit'], bb, 0.3),
      meeting('Annual cycle planning', season(1), ['Salary structure draft'], bb, 0),
    ], [
      task('Follow up on missing census fields', bb, addDays(today, 2), false, ['Email HR lead', 'Log open questions']),
    ]),
    client('Summit Credit Union', sc, quarter(1), [
      meeting('Comp committee prep', on(-5), ['Executive benchmarking'], sc, 0.85),
      meeting('Comp committee', on(3), ['Board comp committee deck', 'Executive benchmarking'], sc, 0.6),
      meeting('Year-end review', quarter(1), ['Incentive plan review'], sc, 0),
    ], [
      task('Draft proposal for 2027 scope', sc, addDays(today, 21), false),
      task('Invoice Q3 work', sc, addDays(today, -8), false),
    ]),
    client('Harbor & Pine Retail', hp, season(2), [
      meeting('Discovery', on(25), ['Job architecture'], hp, 0),
      meeting('Structure rollout', season(2), ['Salary structure draft', 'Market pricing analysis'], hp, 0),
    ], []),
    client('Atlas Manufacturing', at, on(60), [
      meeting('Plant leadership check-in', on(-30), ['Market pricing analysis'], at, 1),
      meeting('Range refresh', on(12), ['Salary structure draft'], at, 0.5),
      meeting('Rollout planning', on(80), ['Incentive plan review'], at, 0),
    ], [
      task('Confirm union contract dates', at, addDays(today, 4), false),
    ]),
    client('Old Mill Bakery', pick(4), null, [
      meeting('Final readout', on(-120), ['Pay equity audit'], pick(4), 1),
    ], [], true),
  ];

  return { schemaVersion: SCHEMA_VERSION, teamMembers: team, clients };
}

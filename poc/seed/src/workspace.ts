/**
 * The seeded Planr workspace (`data/pm/workspace.json`), in Planr's own
 * `workspace.json` shape (src/model/schema.ts), plus the four client fields
 * the POC adds: emailDomains, contacts, fileFolder, nicknames.
 *
 * Dates are relative to "today" so there is always overdue, today, this week
 * and later work. Ids are stable so tests and canned messages can refer to them.
 */
import type { Client, Deliverable, Meeting, Task, Workspace } from '../../../src/model/schema';
import { addDaysIso } from '@poc/contracts';
import { ACME, CLIENTS, HARBORLIGHT, INTERNAL, ME, MARCUS, PRIYA, DANA, QUILLON, TEAM, TESSERA, type ClientSeed } from './people';

/** The four fields Planr's ClientSchema gains in Phase 1 (with defaults). */
export interface ClientExtras {
  emailDomains: string[];
  contacts: { name: string; email: string; role: string }[];
  fileFolder: string | null;
  nicknames: string[];
}
export type SeedClient = Client & ClientExtras;
export type SeedWorkspace = Omit<Workspace, 'clients'> & { clients: SeedClient[] };

export function buildWorkspace(today: string, nowIso: string): SeedWorkspace {
  const rec = (id: string) => ({ id, createdAt: nowIso, updatedAt: nowIso });
  const day = (offset: number) => addDaysIso(today, offset);
  let n = 0;

  const task = (client: ClientSeed, title: string, due: number | null, opts: { who?: string[]; done?: boolean; subs?: string[] } = {}): Task => {
    const id = `poc-task-${client.id.replace('poc-client-', '')}-${++n}`;
    return {
      ...rec(id),
      title,
      assigneeIds: opts.who ?? [ME.id],
      dueDate: due === null ? null : day(due),
      done: opts.done ?? false,
      subtasks: (opts.subs ?? []).map((s, i) => ({ ...rec(`${id}-sub-${i + 1}`), title: s, done: false })),
      keyFor: [],
    };
  };
  const deliverable = (id: string, title: string, tasks: Task[]): Deliverable => ({ ...rec(id), title, tasks });
  const meeting = (id: string, title: string, offset: number, deliverables: Deliverable[]): Meeting => ({
    ...rec(id),
    title,
    date: { kind: 'exact', date: day(offset) },
    kickoff: null,
    deliverables,
  });
  const client = (seed: ClientSeed, meetings: Meeting[], general: Task[]): SeedClient => ({
    ...rec(seed.id),
    name: seed.name,
    logo: null,
    teamMemberIds: seed.teamMemberIds,
    plannedThrough: null,
    archived: false,
    adhoc: { deliverables: [deliverable(`${seed.id}-general`, 'General', general)] },
    meetings,
    emailDomains: seed.emailDomains,
    contacts: seed.contacts,
    fileFolder: seed.fileFolder,
    nicknames: seed.nicknames,
  });

  const clients: SeedClient[] = [
    client(
      ACME,
      [
        meeting('poc-meeting-acme-review', 'Market data review', 6, [
          deliverable('poc-deliv-acme-pricing', 'Market pricing analysis', [
            task(ACME, 'Finish market pricing summary draft', 0, { subs: ['Update aging factor to the effective date', 'Add the two weak matches as footnotes'] }),
            task(ACME, 'QA benchmark matches with Lena', 3, { who: [ME.id, MARCUS.id] }),
            task(ACME, 'Collect HRIS census file', -10, { done: true, who: [MARCUS.id] }),
          ]),
        ]),
        meeting('poc-meeting-acme-structure', 'Salary structure working session', 20, [
          deliverable('poc-deliv-acme-structure', 'Salary structure draft', [
            task(ACME, 'Set midpoint progression', 13, { who: [PRIYA.id] }),
            task(ACME, 'Model cost to bring employees to range minimum', 17),
          ]),
        ]),
      ],
      [task(ACME, 'Send revised SOW to Lena', -2), task(ACME, 'Get job match sign-off from Michael', 1)],
    ),
    client(
      HARBORLIGHT,
      [
        meeting('poc-meeting-harbor-driverpay', 'Driver pay structure review', 9, [
          deliverable('poc-deliv-harbor-driverpay', 'Driver pay structure', [
            task(HARBORLIGHT, 'Review driver census sample', 0),
            task(HARBORLIGHT, 'Draft regional pay differentials', 7, { who: [PRIYA.id] }),
          ]),
        ]),
      ],
      [task(HARBORLIGHT, 'Set up shared data folder with Priscilla', null), task(HARBORLIGHT, 'Send kickoff recap', -6, { done: true })],
    ),
    client(
      QUILLON,
      [
        meeting('poc-meeting-quillon-readout', 'Job architecture readout', 15, [
          deliverable('poc-deliv-quillon-levels', 'Job architecture', [
            task(QUILLON, 'Map engineering titles to levels', 2, { who: [MARCUS.id] }),
            task(QUILLON, 'Build readout deck', 12),
          ]),
        ]),
      ],
      [task(QUILLON, 'Book readout room and send invite', 8)],
    ),
    client(
      TESSERA,
      [
        meeting('poc-meeting-tessera-findings', 'Pay equity findings', 12, [
          deliverable('poc-deliv-tessera-equity', 'Pay equity audit', [
            task(TESSERA, 'Confirm comparator group list', -1, { who: [ME.id, DANA.id] }),
            task(TESSERA, 'Draft pay equity memo outline', 1),
            task(TESSERA, 'Run regression model', 5, { who: [DANA.id] }),
          ]),
        ]),
      ],
      [task(TESSERA, 'Send data request reminder', 14)],
    ),
    client(INTERNAL, [], [task(INTERNAL, 'Submit weekly timesheet', 0), task(INTERNAL, 'Prep team training on pay equity basics', 21), task(INTERNAL, 'Update CRM notes', 4)]),
  ];

  if (clients.length !== CLIENTS.length) throw new Error('every seeded client must be built');

  return {
    schemaVersion: 1,
    teamMembers: TEAM.map((t) => ({ id: t.id, name: t.name, color: t.color, role: t.role })),
    clients,
    settings: {
      openAirTasks: [
        { id: 'poc-oa-analysis', name: 'Analysis', group: 'Client' },
        { id: 'poc-oa-meetings', name: 'Meetings', group: 'Client' },
        { id: 'poc-oa-admin', name: 'Admin', group: 'Internal' },
      ],
    },
  };
}

import { parseFlexDate, type FlexDate } from '../model/flexDate';
import { cleanName, MEMBER_COLORS } from '../model/derive';
import type { Client, Deliverable, Role, Task, TeamMember, Workspace } from '../model/schema';

/**
 * Converts client exports from the previous tracker (one JSON file per client)
 * into this app's clients. Pure: no I/O, so it can be tested and reused by a
 * future server import.
 *
 * Old shape (the parts we use):
 *   { id, name, logo|customLogo (data URL), plannedThrough "YYYY-MM-DD"|"",
 *     staffing: { principal: [names], consultant: [...], ... }, team: [names], archived?,
 *     meetings / pastMeetings: [{ isAdHoc, name, date, deliverables: [{ name, tasks: [{ name, assignees: [names], due, complete }] }] }] }
 *
 * Not carried over: edit logs, timers/time entries, colors, calendars, deliverable "buckets",
 * staffing roles (people are kept, their role level isn't).
 */

export interface ImportResult {
  clients: Client[];
  newMembers: TeamMember[];
  /** Logo data URLs to store, by client id. */
  logos: { clientId: string; dataUrl: string }[];
  summary: { name: string; meetings: number; tasks: number }[];
  skipped: { file: string; reason: string }[];
}

const NO_END_YEAR = 2090;

/** The old tool's staffing keys → roles. */
const OLD_ROLES: Record<string, Role> = {
  principal: 'Principal', srConsultant: 'Sr Consultant', consultant: 'Consultant',
  srAssociate: 'Sr Associate', associate: 'Associate', unassigned: 'Unassigned',
}; // "2099-12-31" was used as "no end date"

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const isIso = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export function looksLikeLegacyClient(data: unknown): boolean {
  const o = obj(data);
  return typeof o.name === 'string' && (Array.isArray(o.meetings) || Array.isArray(o.pastMeetings));
}

export function convertLegacyClients(
  files: { name: string; data: unknown }[],
  existing: Workspace,
  opts: { newId?: () => string; now?: string; today?: string } = {},
): ImportResult {
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const now = opts.now ?? new Date().toISOString();
  const today = opts.today ?? now.slice(0, 10);
  const rec = () => ({ id: newId(), createdAt: now, updatedAt: now });

  const members = new Map(existing.teamMembers.map((m) => [m.name.toLowerCase(), m]));
  const newMembers: TeamMember[] = [];
  const memberId = (rawName: string, role?: Role): string | null => {
    const name = cleanName(rawName);
    if (!name) return null;
    const key = name.toLowerCase();
    let m = members.get(key);
    if (!m) {
      m = { id: newId(), name, color: MEMBER_COLORS[members.size % MEMBER_COLORS.length]!, role: role ?? 'Unassigned' };
      members.set(key, m);
      newMembers.push(m);
    } else if (role && role !== 'Unassigned' && m.role === 'Unassigned' && newMembers.includes(m)) {
      m.role = role; // a later client's staffing knows this new person's role
    }
    return m.id;
  };

  const takenIds = new Set(existing.clients.map((c) => c.id));
  const result: ImportResult = { clients: [], newMembers, logos: [], summary: [], skipped: [] };

  for (const file of files) {
    if (!looksLikeLegacyClient(file.data)) {
      result.skipped.push({ file: file.name, reason: "isn't a client export (no name or meetings)" });
      continue;
    }
    const src = obj(file.data);
    const clientId = str(src.id) || newId();
    if (takenIds.has(clientId)) {
      result.skipped.push({ file: file.name, reason: `"${str(src.name)}" is already imported` });
      continue;
    }
    takenIds.add(clientId);

    // Staffing first, so people get their properly written names before task assignees are matched.
    const staffing = Object.entries(obj(src.staffing)).flatMap(([key, names]) => arr(names).map((n) => memberId(str(n), OLD_ROLES[key])));
    const teamMemberIds = [...new Set([...staffing, ...arr(src.team).map((n) => memberId(str(n)))].filter((id): id is string => !!id))];

    const toTask = (t: unknown): Task => {
      const o = obj(t);
      const due = str(o.due);
      return {
        ...rec(),
        title: str(o.name) || 'Untitled task',
        assigneeIds: [...new Set(arr(o.assignees).map((a) => memberId(str(a))).filter((id): id is string => !!id))],
        dueDate: isIso(due) ? due : null,
        done: o.complete === true,
        subtasks: [],
        keyFor: [],
      };
    };
    const toDeliverables = (list: unknown[]): Deliverable[] =>
      list.map((d) => ({ ...rec(), title: str(obj(d).name) || 'Untitled deliverable', tasks: arr(obj(d).tasks).map(toTask) }));

    const allMeetings = [...arr(src.meetings), ...arr(src.pastMeetings)].map(obj);
    const adhoc = toDeliverables(allMeetings.filter((m) => m.isAdHoc === true).flatMap((m) => arr(m.deliverables)));
    const meetings = allMeetings.filter((m) => m.isAdHoc !== true).map((m) => {
      const name = str(m.name);
      const created = str(m.date);
      // The old tool's "name" usually held the real meeting date ("9/2/25", "Fall 2026").
      const fromName = parseFlexDate(name);
      const date: FlexDate = fromName ?? { kind: 'exact', date: isIso(created) ? created : today };
      return { ...rec(), title: fromName ? '' : name, date, kickoff: null, deliverables: toDeliverables(arr(m.deliverables)) };
    });


    const planned = str(src.plannedThrough);
    const plannedThrough: FlexDate | null =
      isIso(planned) && Number(planned.slice(0, 4)) < NO_END_YEAR ? { kind: 'exact', date: planned } : null;

    const client: Client = {
      id: clientId, createdAt: now, updatedAt: now,
      name: str(src.name) || 'Unnamed client',
      logo: null,
      teamMemberIds,
      plannedThrough,
      archived: src.archived === true,
      adhoc: { deliverables: adhoc.length ? adhoc : [{ ...rec(), title: 'General', tasks: [] }] },
      meetings,
    };
    result.clients.push(client);

    const logo = str(src.customLogo) || str(src.logo);
    if (logo.startsWith('data:image/')) result.logos.push({ clientId, dataUrl: logo });

    const taskCount = [...client.adhoc.deliverables, ...meetings.flatMap((m) => m.deliverables)].reduce((n, d) => n + d.tasks.length, 0);
    result.summary.push({ name: client.name, meetings: meetings.length, tasks: taskCount });
  }
  return result;
}

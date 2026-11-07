import { addDays, dayNumber, isWeekend, weekdayShort } from './dates';
import { meetingLabel } from './derive';
import type { Client, Deliverable, Meeting, Task } from './schema';
import { ADHOC } from './schema';

/**
 * Buckets a workspace into one week for the weekly calendar. Pure, so it is
 * unit-tested and can later run on a server.
 *
 * Rows: meetings at my clients; my work (my tasks anywhere + kickoffs at my
 * clients); others' work at my clients (assigned to someone else, or unassigned).
 * "My clients" = clients whose team includes me. Archived clients are ignored.
 */

export type WeekItem =
  | { kind: 'task'; id: string; task: Task; client: Client; boardId: string; boardLabel: string; deliverable: Deliverable; date: string; weekendTag: string | null }
  | { kind: 'kickoff'; id: string; client: Client; meeting: Meeting; date: string; done: boolean; weekendTag: string | null };

export interface WeekMeeting { client: Client; meeting: Meeting }

export interface Week {
  monday: string;
  days: string[];
  /** Overdue column is shown only when the week contains today. */
  showOverdue: boolean;
  meetings: Record<string, WeekMeeting[]>;
  mine: Record<string, WeekItem[]>;
  others: Record<string, WeekItem[]>;
  overdueMine: WeekItem[];
  overdueOthers: WeekItem[];
}

export interface WeekOptions { meId: string; monday: string; today: string; showWeekend: boolean; hideDone: boolean }

const isDone = (i: WeekItem) => (i.kind === 'task' ? i.task.done : i.done);

export function buildWeek(clients: Client[], o: WeekOptions): Week {
  const days = Array.from({ length: o.showWeekend ? 7 : 5 }, (_, i) => addDays(o.monday, i));
  const start = dayNumber(o.monday);
  const end = start + 6;
  const friday = addDays(o.monday, 4);
  const todayN = dayNumber(o.today);
  const showOverdue = todayN >= start && todayN <= end;

  const empty = () => Object.fromEntries(days.map((d) => [d, []]));
  const week: Week = { monday: o.monday, days, showOverdue, meetings: empty(), mine: empty(), others: empty(), overdueMine: [], overdueOthers: [] };

  /** Day column for a date inside the week (weekend → Friday when hidden). */
  const column = (date: string): { day: string; tag: string | null } =>
    !o.showWeekend && isWeekend(date) ? { day: friday, tag: weekdayShort(date) } : { day: date, tag: null };

  const place = (row: 'mine' | 'others', item: WeekItem) => {
    if (o.hideDone && isDone(item)) return;
    const n = dayNumber(item.date);
    if (n >= start && n <= end) {
      const { day, tag } = column(item.date);
      item.weekendTag = tag;
      week[row][day]!.push(item);
    } else if (showOverdue && n < start && !isDone(item)) {
      (row === 'mine' ? week.overdueMine : week.overdueOthers).push(item);
    }
  };

  for (const client of clients) {
    if (client.archived) continue;
    const mineClient = client.teamMemberIds.includes(o.meId);
    const boards = [
      { boardId: ADHOC, boardLabel: 'Ad-hoc', deliverables: client.adhoc.deliverables },
      ...client.meetings.map((m) => ({ boardId: m.id, boardLabel: meetingLabel(m, o.today), deliverables: m.deliverables })),
    ];
    for (const b of boards) {
      for (const d of b.deliverables) {
        for (const task of d.tasks) {
          if (!task.dueDate) continue;
          // Mine if I'm one of the people on it; otherwise others' work at my clients.
          const row = task.assigneeIds.includes(o.meId) ? 'mine' : mineClient ? 'others' : null;
          if (row) place(row, { kind: 'task', id: task.id, task, client, boardId: b.boardId, boardLabel: b.boardLabel, deliverable: d, date: task.dueDate, weekendTag: null });
        }
      }
    }
    if (!mineClient) continue;
    for (const meeting of client.meetings) {
      if (meeting.kickoff) {
        place('mine', { kind: 'kickoff', id: `kickoff:${meeting.id}`, client, meeting, date: meeting.kickoff.date, done: meeting.kickoff.done, weekendTag: null });
      }
      if (meeting.date.kind === 'exact') {
        const n = dayNumber(meeting.date.date);
        if (n >= start && n <= end) week.meetings[column(meeting.date.date).day]!.push({ client, meeting });
      }
    }
  }

  const byClient = (a: { client: Client }, b: { client: Client }) => a.client.name.localeCompare(b.client.name);
  const byDate = (a: WeekItem, b: WeekItem) => dayNumber(a.date) - dayNumber(b.date) || byClient(a, b);
  for (const d of days) { week.mine[d]!.sort(byClient); week.others[d]!.sort(byClient); week.meetings[d]!.sort(byClient); }
  week.overdueMine.sort(byDate);
  week.overdueOthers.sort(byDate);
  return week;
}

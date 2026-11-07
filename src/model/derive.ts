import { addDays, dayNumber, mondayOf, todayIso } from './dates';
import { compareFlex, flexEnd, flexStart, formatFlexShort } from './flexDate';
import type { Client, Deliverable, Meeting, Task, TeamMember } from './schema';

export interface Progress { done: number; total: number }

export const deliverableProgress = (d: Deliverable): Progress => ({
  done: d.tasks.filter((t) => t.done).length,
  total: d.tasks.length,
});

export function boardProgress(deliverables: Deliverable[]): Progress {
  return deliverables.reduce<Progress>((acc, d) => {
    const p = deliverableProgress(d);
    return { done: acc.done + p.done, total: acc.total + p.total };
  }, { done: 0, total: 0 });
}

/** A deliverable is complete when it has tasks and all of them are done. */
export const isDeliverableComplete = (d: Deliverable) => d.tasks.length > 0 && d.tasks.every((t) => t.done);

/** Deliverables complete out of all deliverables on a board. */
export const deliverablesComplete = (deliverables: Deliverable[]): Progress => ({
  done: deliverables.filter(isDeliverableComplete).length,
  total: deliverables.length,
});

export const isOverdue = (t: Task, today = todayIso()) => !t.done && t.dueDate !== null && dayNumber(t.dueDate) < dayNumber(today);

export type DueStatus = 'overdue' | 'thisWeek' | 'nextWeek';

/**
 * A client's most urgent open work, for the sidebar dot:
 * overdue (red) › due this week (yellow) › due next week (green). Weeks run Monday–Sunday.
 */
export function clientDueStatus(c: Client, today = todayIso()): { status: DueStatus; counts: Record<DueStatus, number> } | null {
  const t = dayNumber(today);
  const thisEnd = dayNumber(addDays(mondayOf(today), 6));
  const nextEnd = thisEnd + 7;
  const counts: Record<DueStatus, number> = { overdue: 0, thisWeek: 0, nextWeek: 0 };
  for (const b of [c.adhoc, ...c.meetings]) for (const d of b.deliverables) for (const task of d.tasks) {
    if (task.done || !task.dueDate) continue;
    const n = dayNumber(task.dueDate);
    if (n < t) counts.overdue++;
    else if (n <= thisEnd) counts.thisWeek++;
    else if (n <= nextEnd) counts.nextWeek++;
  }
  const status: DueStatus | null = counts.overdue ? 'overdue' : counts.thisWeek ? 'thisWeek' : counts.nextWeek ? 'nextWeek' : null;
  return status ? { status, counts } : null;
}

export const allTasks = (deliverables: Deliverable[]) => deliverables.flatMap((d) => d.tasks);

export const sortedMeetings = (c: Client): Meeting[] => [...c.meetings].sort((a, b) => compareFlex(a.date, b.date));

/** Past = the meeting's date (or period) has fully passed. */
export const isPastMeeting = (m: Meeting, today = todayIso()) => dayNumber(flexEnd(m.date)) < dayNumber(today);

export const isAfterPlannedThrough = (m: Meeting, c: Client) =>
  c.plannedThrough !== null && dayNumber(flexStart(m.date)) > dayNumber(flexEnd(c.plannedThrough));

/** Which meeting to open by default: the next one not yet past, else the latest. */
export function defaultMeeting(c: Client, today = todayIso()): Meeting | null {
  const list = sortedMeetings(c);
  return list.find((m) => !isPastMeeting(m, today)) ?? list[list.length - 1] ?? null;
}

/** The meeting's title, or else what it covers ("Peer Group Update +2"). */
export function meetingLabel(m: Meeting, today?: string): string {
  if (m.title) return m.title;
  const [first, ...rest] = m.deliverables;
  if (first) return rest.length ? `${first.title} +${rest.length}` : first.title;
  return `Meeting ${formatFlexShort(m.date, today)}`;
}

/** The next meeting that hasn't fully passed, if any. */
export const nextMeeting = (c: Client, today = todayIso()): Meeting | null => sortedMeetings(c).find((m) => !isPastMeeting(m, today)) ?? null;

/** What the sidebar shows next to a client. */
export type Schedule = { kind: 'next'; meeting: Meeting } | { kind: 'notScheduled' } | { kind: 'adhocOnly' };
export function clientSchedule(c: Client, today = todayIso()): Schedule {
  const next = nextMeeting(c, today);
  if (next) return { kind: 'next', meeting: next };
  return c.meetings.length ? { kind: 'notScheduled' } : { kind: 'adhocOnly' };
}

/** Sidebar order "by next meeting": soonest first, then not scheduled, then ad-hoc only; A–Z within each. */
export function compareBySchedule(a: Client, b: Client, today = todayIso()): number {
  const sa = clientSchedule(a, today), sb = clientSchedule(b, today);
  const rank = (s: Schedule) => (s.kind === 'next' ? 0 : s.kind === 'notScheduled' ? 1 : 2);
  return rank(sa) - rank(sb)
    || (sa.kind === 'next' && sb.kind === 'next' ? compareFlex(sa.meeting.date, sb.meeting.date) : 0)
    || a.name.localeCompare(b.name);
}

/** Planned-through status: passed, or ending within 30 days. */
export function plannedStatus(c: Client, today = todayIso()): { kind: 'passed' | 'soon'; days: number } | null {
  if (!c.plannedThrough) return null;
  const days = dayNumber(flexEnd(c.plannedThrough)) - dayNumber(today);
  if (days < 0) return { kind: 'passed', days: -days };
  if (days <= 30) return { kind: 'soon', days };
  return null;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export const memberById = (members: TeamMember[], id: string | null) => (id ? members.find((m) => m.id === id) : undefined);

export const MEMBER_COLORS = ['#5b6ea8', '#4f8a8b', '#6a8f6b', '#9a7b4f', '#8c6b8f', '#a06a5f', '#6f7d93', '#7d7a55', '#5f7fa3', '#93705c'];

/** A stable color for a client without a logo, from its name. */
export function colorFor(text: string): string {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return MEMBER_COLORS[h % MEMBER_COLORS.length]!;
}

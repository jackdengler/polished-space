import { dayNumber, todayIso } from './dates';
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

export const isOverdue = (t: Task, today = todayIso()) => !t.done && t.dueDate !== null && dayNumber(t.dueDate) < dayNumber(today);

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

/** The meeting's title, or else what it covers (its deliverables). */
export function meetingLabel(m: Meeting, today?: string): string {
  return m.title || m.deliverables.map((d) => d.title).join(', ') || `Meeting ${formatFlexShort(m.date, today)}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export const memberById = (members: TeamMember[], id: string | null) => (id ? members.find((m) => m.id === id) : undefined);

export const MEMBER_COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777', '#7c3aed', '#2563eb', '#65a30d', '#ea580c'];

/** A stable color for a client without a logo, from its name. */
export function colorFor(text: string): string {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return MEMBER_COLORS[h % MEMBER_COLORS.length]!;
}

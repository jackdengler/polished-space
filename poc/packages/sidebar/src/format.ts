import { addDaysIso, fromGraphDateTime, weekdayName, type CalEvent, type Direction, type Person, type SourceRef, type TaskType } from '@poc/contracts';

/**
 * Display helpers. Dates are relative to the brain's `today` (never the
 * browser clock), so the sidebar agrees with the brain about "today".
 * Times are shown in the browser's zone, which on the demo laptop is the
 * sandbox's POC_TZ.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number) as [number, number, number];
  return `${MONTHS[m - 1]} ${d}`;
}

/** "Today", "Tomorrow", "Fri", "Nov 24", "Yesterday", "3 days ago". */
export function relativeDue(due: string, today: string): string {
  if (due === today) return 'Today';
  if (due === addDaysIso(today, 1)) return 'Tomorrow';
  if (due === addDaysIso(today, -1)) return 'Yesterday';
  if (due < today) {
    const days = Math.round((Date.parse(today) - Date.parse(due)) / 86400000);
    return days <= 14 ? `${days} days ago` : shortDate(due);
  }
  const days = Math.round((Date.parse(due) - Date.parse(today)) / 86400000);
  if (days < 7) return weekdayName(due).slice(0, 3);
  return shortDate(due);
}

export function time(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function dayAndTime(iso: string, today: string): string {
  const d = new Date(iso);
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${relativeDue(local, today)} ${time(iso)}`;
}

export function span(startIso: string, endIso: string): string {
  return `${time(startIso)} – ${time(endIso)}`;
}

export function minutesBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 60000);
}

export function eventStart(e: CalEvent): string {
  return fromGraphDateTime(e.start);
}
export function eventEnd(e: CalEvent): string {
  return fromGraphDateTime(e.end);
}

/** "2 min ago", "just now", or a time. */
export function ago(iso: string, nowIso: string): string {
  const mins = Math.round((Date.parse(nowIso) - Date.parse(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  return time(iso);
}

export const DIRECTION_LABEL: Record<Direction, string> = { i_owe: 'I owe', owed_to_me: 'Owed to me' };

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  reply_email: 'Reply',
  schedule_meeting: 'Meeting',
  review_file: 'File review',
  follow_up: 'Follow-up',
  other: 'Task',
};

export const SOURCE_ICON: Record<SourceRef['connector'], 'mail' | 'chat' | 'calendar' | 'file' | 'pen' | 'mic' | 'next'> = {
  mail: 'mail',
  chat: 'chat',
  calendar: 'calendar',
  files: 'file',
  manual: 'pen',
  voice: 'mic',
  next_step: 'next',
};

export function personLabel(p: Person): string {
  return p.name ? `${p.name} <${p.address}>` : p.address;
}

/** Parse "Name <addr>, other@x.example" into people. Returns null if any part is not an address. */
export function parsePeople(text: string): Person[] | null {
  const parts = text
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: Person[] = [];
  for (const part of parts) {
    const m = /^(.*?)\s*<([^<>\s]+@[^<>\s]+)>$/.exec(part);
    if (m) out.push({ name: m[1]!.replace(/^"|"$/g, '').trim(), address: m[2]! });
    else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(part)) out.push({ name: '', address: part });
    else return null;
  }
  return out;
}

export function usd(n: number): string {
  return n < 10 ? `$${n.toFixed(2)}` : `$${n.toFixed(0)}`;
}

/** `datetime-local` value (browser zone) for an ISO instant, and back. */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fromLocalInput(v: string): string | null {
  const ms = new Date(v).getTime();
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

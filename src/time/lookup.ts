import { isPastMeeting, meetingLabel, sortedMeetings } from '../model/derive';
import type { Client, Deliverable, OpenAirTask } from '../model/schema';

/** Deliverables you can track time on: Ad-hoc and current (not past) meetings, labelled "Deliverable — Meeting". */
export function deliverableOptions(c: Client, today?: string): { id: string; label: string }[] {
  const out = c.adhoc.deliverables.filter((d) => d.title.trim()).map((d) => ({ id: d.id, label: `${d.title} — Ad-hoc` }));
  for (const m of sortedMeetings(c)) {
    if (isPastMeeting(m, today)) continue;
    for (const d of m.deliverables) if (d.title.trim()) out.push({ id: d.id, label: `${d.title} — ${meetingLabel(m, today)}` });
  }
  return out;
}

export function findDeliverable(clients: Client[], id: string | null): { client: Client; deliverable: Deliverable } | null {
  if (!id) return null;
  for (const c of clients) for (const b of [c.adhoc, ...c.meetings]) for (const d of b.deliverables) if (d.id === id) return { client: c, deliverable: d };
  return null;
}

export const clientName = (clients: Client[], id: string | null) => (id ? clients.find((c) => c.id === id)?.name ?? 'Deleted client' : 'No client');
export const openAirName = (tasks: OpenAirTask[], id: string | null) => (id ? tasks.find((t) => t.id === id)?.name ?? '' : '');

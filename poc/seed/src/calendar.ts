/**
 * The seeded calendar, built relative to "now" (POC_NOW or the clock):
 *
 * - One meeting earlier today (already over).
 * - The next meeting starts 90-120 minutes from now (next half hour + 90
 *   min), so there is always a free hour before it. Nothing sits between
 *   now and then.
 * - One more meeting later today, and a spread over the next 12 weekdays at
 *   fixed local times (POC_TZ, no weekends), leaving plenty of free slots
 *   for the meeting-time finder.
 * - No lunch block anywhere (the assistant offers to add one).
 *
 * All times are stored the Graph way with timeZone "UTC".
 */
import { addDaysIso, localDate, toGraphDateTime, weekdayIndex, zonedTime, type CalEvent } from '@poc/contracts';
import { ACME, HARBORLIGHT, QUILLON, TESSERA, contact, me, teammate, DANA, MARCUS, PRIYA } from './people';

const HALF_HOUR = 30 * 60_000;
const MIN = 60_000;

/** Minutes from now to the next meeting's start is always in [90, 120). */
export const NEXT_MEETING_LEAD_MIN = 90;

type Person = { name: string; address: string };

export function buildCalendar(now: Date, tz: string): CalEvent[] {
  let n = 0;
  const ev = (subject: string, start: Date, minutes: number, people: Person[], body = ''): CalEvent => ({
    id: `poc-event-${++n}`,
    subject,
    start: toGraphDateTime(start.toISOString()),
    end: toGraphDateTime(new Date(start.getTime() + minutes * MIN).toISOString()),
    attendees: [me, ...people].map((p) => ({ emailAddress: p, type: 'required' as const })),
    showAs: 'busy',
    isAllDay: false,
    categories: [],
    bodyPreview: body,
  });
  /** Local hh:mm on the `workdays`-th weekday after today (Saturdays and Sundays skipped). */
  const at = (workdays: number, hh: number, mm = 0) => {
    let day = localDate(now, tz);
    for (let left = workdays; left > 0; ) {
      day = addDaysIso(day, 1);
      if (weekdayIndex(day) < 5) left--;
    }
    return zonedTime(day, hh * 60 + mm, tz);
  };

  const ceilHalf = new Date(Math.ceil(now.getTime() / HALF_HOUR) * HALF_HOUR);
  const floorHalf = new Date(Math.floor(now.getTime() / HALF_HOUR) * HALF_HOUR);
  const next = new Date(ceilHalf.getTime() + NEXT_MEETING_LEAD_MIN * MIN);

  const events: CalEvent[] = [
    ev('Team huddle', new Date(floorHalf.getTime() - 150 * MIN), 30, [teammate(PRIYA), teammate(MARCUS), teammate(DANA)], 'Weekly priorities and staffing.'),
    ev('Harborlight Freight: driver pay working session', next, 45, [contact(HARBORLIGHT, 'Dmitri Vance'), contact(HARBORLIGHT, 'Priscilla Mbeki'), teammate(PRIYA)], 'Walk through the census sample and open questions on regional differentials.'),
    ev('Quillon Robotics: job architecture sync', new Date(next.getTime() + 150 * MIN), 30, [contact(QUILLON, 'Renata Solis'), teammate(MARCUS)], 'Check progress on title mapping.'),
    ev('Tessera Foods: comparator groups', at(1, 10), 45, [contact(TESSERA, 'Gareth Lindqvist'), teammate(DANA)]),
    ev('Internal: staffing review', at(1, 15), 30, [teammate(DANA)]),
    ev('Acme Tooling Co.: benchmark QA with Lena', at(3, 11), 60, [contact(ACME, 'Lena Hartwell'), teammate(MARCUS)]),
    ev('Harborlight Freight: payroll data call', at(4, 9, 30), 30, [contact(HARBORLIGHT, 'Priscilla Mbeki')]),
    ev('Acme Tooling Co.: market data review', at(6, 10), 60, [contact(ACME, 'Michael Okafor'), contact(ACME, 'Lena Hartwell'), teammate(PRIYA), teammate(MARCUS)]),
    ev('Internal: team training dry run', at(7, 14), 60, [teammate(PRIYA), teammate(MARCUS), teammate(DANA)]),
    ev('Harborlight Freight: driver pay structure review', at(9, 13), 60, [contact(HARBORLIGHT, 'Dmitri Vance'), teammate(PRIYA)]),
    ev('Tessera Foods: pay equity findings', at(12, 14), 60, [contact(TESSERA, 'Gareth Lindqvist'), teammate(DANA)]),
  ];
  // Fixed-time events never land between now and the next meeting (they are on later days).
  return events.sort((a, b) => a.start.dateTime.localeCompare(b.start.dateTime));
}

import { z } from 'zod';
import { GraphEmailAddress, GraphItemBody, graphList } from './mail';

/**
 * Fake Outlook calendar, shaped like Microsoft Graph v1.0 `event`
 * (https://learn.microsoft.com/graph/api/resources/event).
 *
 * Graph writes times as `{ dateTime, timeZone }` where `dateTime` has NO
 * offset (e.g. `2026-11-13T15:00:00.0000000`). POC decision: the mock always
 * stores and returns `timeZone: "UTC"`. Use `toGraphDateTime` /
 * `fromGraphDateTime` to convert to and from normal ISO strings; only UTC is
 * supported, which is enough for the sandbox.
 */

export const GraphDateTimeTimeZone = z.object({
  dateTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?$/, 'expected Graph dateTime with no offset'),
  timeZone: z.string().min(1),
});
export type GraphDateTimeTimeZone = z.infer<typeof GraphDateTimeTimeZone>;

export const GraphAttendee = z.object({
  emailAddress: GraphEmailAddress,
  type: z.enum(['required', 'optional', 'resource']).default('required'),
});
export type GraphAttendee = z.infer<typeof GraphAttendee>;

export const ShowAs = z.enum(['free', 'tentative', 'busy', 'oof', 'workingElsewhere', 'unknown']);
export type ShowAs = z.infer<typeof ShowAs>;

/** A calendar event. `CalEvent` is the name the brain uses. */
export const CalEvent = z.object({
  id: z.string().min(1),
  subject: z.string(),
  start: GraphDateTimeTimeZone,
  end: GraphDateTimeTimeZone,
  attendees: z.array(GraphAttendee).default([]),
  showAs: ShowAs.default('busy'),
  isAllDay: z.boolean().default(false),
  location: z.object({ displayName: z.string() }).optional(),
  categories: z.array(z.string()).default([]),
  bodyPreview: z.string().default(''),
});
export type CalEvent = z.infer<typeof CalEvent>;

export const CalEventList = graphList(CalEvent);
export type CalEventList = z.infer<typeof CalEventList>;

/** Body of `POST /v1.0/me/events`. The mock assigns `id` and returns the CalEvent (201). */
export const NewCalEvent = z.object({
  subject: z.string().min(1),
  start: GraphDateTimeTimeZone,
  end: GraphDateTimeTimeZone,
  attendees: z.array(GraphAttendee).default([]),
  showAs: ShowAs.default('busy'),
  body: GraphItemBody.optional(),
  categories: z.array(z.string()).default([]),
});
export type NewCalEvent = z.infer<typeof NewCalEvent>;

/** ISO instant (any offset) → Graph `{ dateTime, timeZone: 'UTC' }`. */
export function toGraphDateTime(iso: string): GraphDateTimeTimeZone {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`not a date: ${iso}`);
  // 2026-11-13T15:00:00.000Z -> 2026-11-13T15:00:00.0000000 (Graph uses 7 fraction digits)
  return { dateTime: `${new Date(ms).toISOString().slice(0, 23)}0000`, timeZone: 'UTC' };
}

/** Graph `{ dateTime, timeZone: 'UTC' }` → ISO instant ending in `Z`. Throws for other zones. */
export function fromGraphDateTime(g: GraphDateTimeTimeZone): string {
  if (g.timeZone !== 'UTC') throw new Error(`only UTC is supported in the POC, got ${g.timeZone}`);
  const [main, frac = '0'] = g.dateTime.split('.');
  return `${main}.${frac.padEnd(3, '0').slice(0, 3)}Z`;
}

/** Start and end of an event in epoch milliseconds. */
export function eventSpanMs(e: Pick<CalEvent, 'start' | 'end'>): { start: number; end: number } {
  return { start: Date.parse(fromGraphDateTime(e.start)), end: Date.parse(fromGraphDateTime(e.end)) };
}

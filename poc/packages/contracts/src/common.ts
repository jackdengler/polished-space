import { z } from 'zod';

/** Calendar date, `YYYY-MM-DD`. Same rule as Planr's `IsoDate`. */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/**
 * A moment in time, ISO 8601 with an explicit offset or `Z`
 * (e.g. `2026-11-13T15:00:00Z`, `2026-11-13T15:00:00.000+01:00`).
 * Used for every timestamp the POC owns. Graph's calendar `dateTime` is
 * different (no offset; see `GraphDateTimeTimeZone` in calendar.ts).
 */
export const IsoDateTime = z.iso.datetime({ offset: true });

/** Where an item came from. `id` is the id in that source (mail id, chat id, task id...). */
export const ConnectorKind = z.enum([
  'mail',
  'chat',
  'calendar',
  'files',
  'manual',
  'voice',
  /** Proposed by the assistant as the follow-on after prepared work was approved; `id` is that task id. */
  'next_step',
]);
export type ConnectorKind = z.infer<typeof ConnectorKind>;

export const SourceRef = z.object({
  connector: ConnectorKind,
  /** Id in the source system. For `manual`/`voice` the brain makes one up (e.g. `manual-<uuid>`). */
  id: z.string().min(1),
  /** Short human label for the link, e.g. "Email from Michael Okafor: Pricing update". */
  label: z.string(),
  /** Mail `conversationId`, or chat contact/channel id, when there is one. */
  threadId: z.string().optional(),
});
export type SourceRef = z.infer<typeof SourceRef>;

export const TaskType = z.enum(['reply_email', 'schedule_meeting', 'review_file', 'follow_up', 'other']);
export type TaskType = z.infer<typeof TaskType>;

/** `i_owe`: something I promised. `owed_to_me`: something someone else owes me. */
export const Direction = z.enum(['i_owe', 'owed_to_me']);
export type Direction = z.infer<typeof Direction>;

export const ClientConfidence = z.enum(['high', 'low']);
export type ClientConfidence = z.infer<typeof ClientConfidence>;

/** A person and their address, used by mail drafts and client contacts. */
export const Person = z.object({ name: z.string(), address: z.email() });
export type Person = z.infer<typeof Person>;

/** A time span with ISO datetimes; `end` is after `start`. */
export const TimeSlot = z
  .object({ start: IsoDateTime, end: IsoDateTime })
  .refine((s) => Date.parse(s.end) > Date.parse(s.start), { message: 'end must be after start' });
export type TimeSlot = z.infer<typeof TimeSlot>;

/** `{ ok: true, service }` from every health endpoint. */
export const Health = z.object({ ok: z.boolean(), service: z.string(), now: IsoDateTime });
export type Health = z.infer<typeof Health>;

/** Error body every POC HTTP service returns on a 4xx/5xx. */
export const ErrorBody = z.object({ error: z.string() });
export type ErrorBody = z.infer<typeof ErrorBody>;

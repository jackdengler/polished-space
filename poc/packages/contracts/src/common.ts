import { z } from 'zod';

/** True for a real calendar date in `YYYY-MM-DD` form (rejects 2026-02-30, 2026-13-45, 2026-02-29). */
export function isRealIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return d <= days;
}

/**
 * Calendar date, `YYYY-MM-DD`, and a real one: the shape Planr expects, plus a
 * calendar check (Planr's own schema only checks the shape, so this contract
 * is the trust boundary for every date the POC writes).
 */
export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .refine(isRealIsoDate, { message: 'is not a real calendar date' });

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

const FIELD_NAMES: Record<string, string> = {
  dueDate: 'The due date',
  start: 'The start time',
  end: 'The end time',
  title: 'The title',
  subject: 'The subject',
  body: 'The message',
  to: 'The recipients',
  cc: 'The cc list',
  address: 'An email address',
  assigneeIds: 'The assignee',
  clientId: 'The client',
  taskId: 'The task',
  slots: 'The meeting times',
};

/**
 * One plain-English sentence for a zod error, for people (never raw JSON).
 * e.g. "The due date (2026-02-30) is not a real calendar date."
 */
export function humanIssues(error: { issues: readonly { path: readonly PropertyKey[]; message: string; code?: string; input?: unknown }[] }, value?: unknown): string {
  const parts = error.issues.slice(0, 3).map((i) => {
    const key = [...i.path].reverse().find((p) => typeof p === 'string') as string | undefined;
    const field = (key && FIELD_NAMES[key]) || (key ? `"${key}"` : 'The value');
    let got: unknown = value;
    for (const p of i.path) got = got && typeof got === 'object' ? (got as Record<PropertyKey, unknown>)[p] : undefined;
    const shown = typeof got === 'string' && got.length <= 40 ? ` (${got})` : '';
    let msg = i.message;
    if (/^Invalid/.test(msg)) msg = got === undefined ? 'is missing' : 'is not valid';
    else if (/^Too small/.test(msg)) msg = Array.isArray(got) ? 'needs at least one entry' : 'is empty';
    else if (/^Too big/.test(msg)) msg = Array.isArray(got) ? 'has too many entries' : 'is too long';
    if (/^[A-Z]/.test(msg) && !/^(The|An|A) /.test(msg)) return msg.endsWith('.') ? msg : `${msg}.`;
    if (/^(The|An|A) /.test(msg)) return msg.endsWith('.') ? msg : `${msg}.`;
    return `${field}${shown} ${msg.replace(/^expected /, 'should be ')}${msg.endsWith('.') ? '' : '.'}`;
  });
  return [...new Set(parts)].slice(0, 2).join(' ');
}

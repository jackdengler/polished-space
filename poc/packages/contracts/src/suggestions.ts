import { z } from 'zod';
import { ClientConfidence, Direction, IsoDate, IsoDateTime, SourceRef, TaskType, TimeSlot } from './common';
import { MailDraft } from './mail';
import { EDITABLE_PROFILE_SECTIONS } from './profile';

/**
 * Suggestions, the task overlay and prepared work (plan section 4).
 *
 * The rule that makes "nothing without approval" structural: Claude can only
 * create Suggestions. The only code that sends mail, writes the calendar or
 * calls an MCP write tool is the brain's approve endpoint, acting on one
 * Suggestion.
 */

export const SuggestionKind = z.enum([
  'create_task',
  'complete_task',
  'reschedule_task',
  'calendar_block',
  'send_reply',
  'confirm_client',
]);
export type SuggestionKind = z.infer<typeof SuggestionKind>;

export const SuggestionStatus = z.enum(['pending', 'approved', 'denied', 'applied', 'failed']);
export type SuggestionStatus = z.infer<typeof SuggestionStatus>;

// ---- payload per kind ----------------------------------------------------

/** Becomes `create_task` on approve. The client comes from `Suggestion.clientId`, which must be set by then. */
export const CreateTaskPayload = z.object({
  title: z.string().trim().min(1),
  dueDate: IsoDate.nullable(),
  assigneeIds: z.array(z.string()).default([]),
  deliverableId: z.string().optional(),
});
export type CreateTaskPayload = z.infer<typeof CreateTaskPayload>;

export const CompleteTaskPayload = z.object({ taskId: z.string().min(1) });
export type CompleteTaskPayload = z.infer<typeof CompleteTaskPayload>;

export const RescheduleTaskPayload = z.object({ taskId: z.string().min(1), dueDate: IsoDate.nullable() });
export type RescheduleTaskPayload = z.infer<typeof RescheduleTaskPayload>;

/** A time block written to the calendar on approve (lunch, or focus time for a task). */
export const CalendarBlockPayload = z.object({
  subject: z.string().min(1),
  start: IsoDateTime,
  end: IsoDateTime,
  purpose: z.enum(['lunch', 'focus']),
  /** For a focus block: the task it is for. */
  taskId: z.string().nullable().default(null),
});
export type CalendarBlockPayload = z.infer<typeof CalendarBlockPayload>;

/**
 * Sends `draft` through the mail connector on approve. If `taskId` is set,
 * that task is completed after the send succeeds (reply, meeting reply and
 * chaser tasks finish this way).
 */
export const SendReplyPayload = z.object({
  draft: MailDraft,
  taskId: z.string().nullable().default(null),
});
export type SendReplyPayload = z.infer<typeof SendReplyPayload>;

/**
 * An uncertain client match, shown in Inbox. Approving it needs
 * `edits.clientId` (or exactly one candidate, which is then used). On approve
 * the brain sets that clientId on every suggestion in `relatedSuggestionIds`
 * (they stay pending for their own approval) and, if `alias` is set, records
 * it under "Also known as" in that client's profile (shorthand learning).
 */
export const ConfirmClientPayload = z.object({
  candidateClientIds: z.array(z.string()),
  /** The shorthand that triggered the uncertain match, e.g. "the robo team". */
  alias: z.string().nullable().default(null),
  relatedSuggestionIds: z.array(z.string()).default([]),
});
export type ConfirmClientPayload = z.infer<typeof ConfirmClientPayload>;

export const PAYLOAD_SCHEMAS = {
  create_task: CreateTaskPayload,
  complete_task: CompleteTaskPayload,
  reschedule_task: RescheduleTaskPayload,
  calendar_block: CalendarBlockPayload,
  send_reply: SendReplyPayload,
  confirm_client: ConfirmClientPayload,
} as const satisfies Record<SuggestionKind, z.ZodType>;

// ---- the suggestion ------------------------------------------------------

/** Points at what a suggestion repeats: an existing Planr task, or another suggestion. */
export const DuplicateRef = z.object({ kind: z.enum(['task', 'suggestion']), id: z.string().min(1) });
export type DuplicateRef = z.infer<typeof DuplicateRef>;

const suggestionBase = {
  id: z.string().min(1),
  status: SuggestionStatus,
  /** Card headline, e.g. "Reply to Michael about the pricing update". */
  title: z.string().min(1),
  /** One plain-English sentence, like an assistant would say it. Not the subject line. */
  nudge: z.string(),
  clientId: z.string().nullable(),
  clientConfidence: ClientConfidence,
  source: SourceRef.nullable(),
  direction: Direction.optional(),
  taskType: TaskType.optional(),
  duplicateOf: DuplicateRef.nullable().optional(),
  createdAt: IsoDateTime,
  decidedAt: IsoDateTime.nullable(),
  /** Set when status is `failed`: what went wrong, shown to the user. Never retried silently. */
  error: z.string().nullable(),
};

export const Suggestion = z.discriminatedUnion('kind', [
  z.object({ ...suggestionBase, kind: z.literal('create_task'), payload: CreateTaskPayload }),
  z.object({ ...suggestionBase, kind: z.literal('complete_task'), payload: CompleteTaskPayload }),
  z.object({ ...suggestionBase, kind: z.literal('reschedule_task'), payload: RescheduleTaskPayload }),
  z.object({ ...suggestionBase, kind: z.literal('calendar_block'), payload: CalendarBlockPayload }),
  z.object({ ...suggestionBase, kind: z.literal('send_reply'), payload: SendReplyPayload }),
  z.object({ ...suggestionBase, kind: z.literal('confirm_client'), payload: ConfirmClientPayload }),
]);
export type Suggestion = z.infer<typeof Suggestion>;

/**
 * `POST /api/suggestions/:id/approve` body. Edits are applied before the
 * action runs: `payload` is shallow-merged over the suggestion's payload and
 * the result is re-validated against `PAYLOAD_SCHEMAS[kind]` (400 if it fails).
 * For `send_reply`, pass the whole edited draft as `payload.draft`.
 */
export const ApproveBody = z.object({
  edits: z
    .object({
      title: z.string().trim().min(1).optional(),
      clientId: z.string().min(1).optional(),
      payload: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});
export type ApproveBody = z.infer<typeof ApproveBody>;

/** Response of approve and deny: the suggestion after the decision (status applied, denied or failed). */
export const DecisionResponse = z.object({ suggestion: Suggestion });
export type DecisionResponse = z.infer<typeof DecisionResponse>;

// ---- prepared work -------------------------------------------------------

export const PreparedWork = z.discriminatedUnion('type', [
  z.object({ type: z.literal('reply_email'), draft: MailDraft }),
  z.object({ type: z.literal('schedule_meeting'), slots: z.array(TimeSlot).min(1), draft: MailDraft }),
  z.object({
    type: z.literal('review_file'),
    /** FileInfo.path, relative to the files root. */
    path: z.string().min(1),
    summary: z.string().min(1),
    keyPoints: z.array(z.string().min(1)).min(1),
  }),
  z.object({ type: z.literal('follow_up'), draft: MailDraft }),
  z.object({
    type: z.literal('other'),
    context: z.array(z.object({ label: z.string(), text: z.string(), source: SourceRef.nullable() })),
  }),
]);
export type PreparedWork = z.infer<typeof PreparedWork>;

export const PreparedStatus = z.enum(['none', 'preparing', 'ready', 'failed']);
export type PreparedStatus = z.infer<typeof PreparedStatus>;

/**
 * The brain's overlay for one Planr task (`data/brain/taskmeta.json`, keyed by
 * task id). Planr has no source link, on-hold flag or order, so they live here.
 *
 * `preparedSuggestionId` is how prepared work gets approved: when prepared
 * work is ready the brain also creates one pending Suggestion that acts on it
 * (`send_reply` for reply/meeting/follow-up drafts, `complete_task` for file
 * review and "other"). The prepared-work view's Approve/Edit/Deny buttons act
 * on that suggestion through the normal approve endpoint, so there is still
 * exactly one write path.
 */
export const TaskMeta = z.object({
  taskId: z.string().min(1),
  source: SourceRef.nullable(),
  direction: Direction,
  taskType: TaskType,
  onHold: z.boolean().default(false),
  /** Position in Today, 0 first. null when not in Today or not ordered yet. */
  order: z.number().int().nonnegative().nullable().default(null),
  quickWin: z.boolean().default(false),
  /** Why it sits where it does (from the prioritise call). */
  reason: z.string().default(''),
  prepared: PreparedWork.nullable().default(null),
  preparedStatus: PreparedStatus.default('none'),
  preparedSuggestionId: z.string().nullable().default(null),
});
export type TaskMeta = z.infer<typeof TaskMeta>;

/** `GET /api/tasks/:id/prepared` response. */
export const PreparedResponse = z.object({
  taskId: z.string(),
  status: PreparedStatus,
  prepared: PreparedWork.nullable(),
  suggestion: Suggestion.nullable(),
});
export type PreparedResponse = z.infer<typeof PreparedResponse>;

/** `POST /api/tasks/:id/hold` body; responds with the updated TaskMeta. */
export const HoldBody = z.object({ onHold: z.boolean() });
export type HoldBody = z.infer<typeof HoldBody>;

/** `POST /api/input` body (typed task). Responds with the suggestions it produced. */
export const InputBody = z.object({ text: z.string().trim().min(1) });
export type InputBody = z.infer<typeof InputBody>;
export const InputResponse = z.object({ suggestions: z.array(Suggestion) });
export type InputResponse = z.infer<typeof InputResponse>;

/** Structured profile edit (from triage or the profile-update call). Code applies it. */
export const ProfileEdit = z.object({
  section: z.enum(EDITABLE_PROFILE_SECTIONS),
  op: z.enum(['add', 'replace', 'remove']),
  text: z.string().min(1),
});
export type ProfileEdit = z.infer<typeof ProfileEdit>;

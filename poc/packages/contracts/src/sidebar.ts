import { z } from 'zod';
import { Direction, IsoDate, IsoDateTime, SourceRef, TaskType } from './common';
import { CalEvent } from './calendar';
import { PreparedStatus, Suggestion } from './suggestions';
import { UsageSummary } from './usage';
import { addDaysIso, weekStart, weekdayName } from './time';

/**
 * What the sidebar shows (plan section 3.6 and section 4), and the rule that
 * puts each task in a section. The brain builds SidebarState; the sidebar only
 * renders it. `sectionKeyFor` lives here so both sides (and the sidebar's
 * fixture server) agree.
 *
 * Section order, top to bottom:
 *   inbox, on_hold, overdue, today, tomorrow, day-YYYY-MM-DD (each remaining
 *   day of this week, Mon-Sun weeks), next_week, next_week_1, next_week_2,
 *   later, internal
 *
 * POC decisions beyond the plan:
 * - `later` holds dated tasks beyond "Next week +2", so nothing disappears.
 *   It is empty in the demo.
 * - Undated tasks go to `inbox` (plan question 7).
 * - Precedence: on hold > internal client > undated > by date.
 * - Pending suggestions are not tasks; the sidebar shows them as cards (and
 *   `confirm_client` cards, plus suggestions with clientId null, in Inbox).
 */

export const FIXED_SECTION_KEYS = [
  'inbox',
  'on_hold',
  'overdue',
  'today',
  'tomorrow',
  'next_week',
  'next_week_1',
  'next_week_2',
  'later',
  'internal',
] as const;
export const SectionKey = z.union([z.enum(FIXED_SECTION_KEYS), z.string().regex(/^day-\d{4}-\d{2}-\d{2}$/)]);
export type SectionKey = z.infer<typeof SectionKey>;

export interface SectionInput {
  dueDate: string | null;
  onHold: boolean;
  clientId: string;
}

/** Which section a task belongs in, given today's local date and the Internal client's id. */
export function sectionKeyFor(task: SectionInput, today: string, internalClientId: string | null): SectionKey {
  if (task.onHold) return 'on_hold';
  if (internalClientId && task.clientId === internalClientId) return 'internal';
  const due = task.dueDate;
  if (!due) return 'inbox';
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  if (due === addDaysIso(today, 1)) return 'tomorrow';
  const nextMon = addDaysIso(weekStart(today), 7);
  if (due < nextMon) return `day-${due}`;
  if (due < addDaysIso(nextMon, 7)) return 'next_week';
  if (due < addDaysIso(nextMon, 14)) return 'next_week_1';
  if (due < addDaysIso(nextMon, 21)) return 'next_week_2';
  return 'later';
}

/** Every section key for `today`, in display order (day keys only for days after tomorrow up to Sunday). */
export function sectionKeys(today: string): SectionKey[] {
  const days: SectionKey[] = [];
  const nextMon = addDaysIso(weekStart(today), 7);
  for (let d = addDaysIso(today, 2); d < nextMon; d = addDaysIso(d, 1)) days.push(`day-${d}`);
  return ['inbox', 'on_hold', 'overdue', 'today', 'tomorrow', ...days, 'next_week', 'next_week_1', 'next_week_2', 'later', 'internal'];
}

const LABELS: Record<(typeof FIXED_SECTION_KEYS)[number], string> = {
  inbox: 'Inbox',
  on_hold: 'On hold',
  overdue: 'Overdue',
  today: 'Today',
  tomorrow: 'Tomorrow',
  next_week: 'Next week',
  next_week_1: 'Next week +1',
  next_week_2: 'Next week +2',
  later: 'Later',
  internal: 'Internal',
};

/** Display label: fixed labels, or the weekday name ("Thursday") for day keys. */
export function sectionLabel(key: SectionKey): string {
  if (key.startsWith('day-')) return weekdayName(key.slice(4));
  return LABELS[key as keyof typeof LABELS];
}

/** A task as the sidebar shows it: the Planr task joined with the brain's overlay. */
export const SidebarTask = z.object({
  taskId: z.string(),
  title: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  dueDate: IsoDate.nullable(),
  done: z.boolean(),
  assigneeIds: z.array(z.string()),
  /** null when the task has no overlay (e.g. added by hand in Planr). */
  taskType: TaskType.nullable(),
  direction: Direction.nullable(),
  onHold: z.boolean(),
  /** Position within Today (0 first); null elsewhere. Today's items are sorted by it. */
  order: z.number().int().nonnegative().nullable(),
  quickWin: z.boolean(),
  reason: z.string().nullable(),
  source: SourceRef.nullable(),
  preparedStatus: PreparedStatus,
  preparedSuggestionId: z.string().nullable(),
});
export type SidebarTask = z.infer<typeof SidebarTask>;

export const SidebarSection = z.object({ key: SectionKey, label: z.string(), items: z.array(SidebarTask) });
export type SidebarSection = z.infer<typeof SidebarSection>;

/**
 * A plain-English tap on the shoulder. `new_item`: something arrived.
 * `fit_now`: a free block before the next meeting (from prioritise's fitNow).
 * `info`: anything else (e.g. a failed action).
 */
export const Nudge = z.object({
  id: z.string(),
  kind: z.enum(['new_item', 'fit_now', 'info']),
  text: z.string().min(1),
  createdAt: IsoDateTime,
  source: SourceRef.nullable(),
  suggestionIds: z.array(z.string()).default([]),
  /** For `fit_now`: the task it suggests working on. */
  taskId: z.string().nullable().default(null),
});
export type Nudge = z.infer<typeof Nudge>;

/**
 * `GET /api/state` and the `state` SSE event. Every section from
 * `sectionKeys(today)` is present, even when empty, in that order.
 * `suggestions` holds pending and failed suggestions only, newest first.
 * `nudges` is newest first, at most 20.
 */
export const SidebarState = z.object({
  now: IsoDateTime,
  /** Local date of `now` in POC_TZ. */
  today: IsoDate,
  me: z.object({ id: z.string(), name: z.string() }),
  /** Active clients, for the client picker on Edit and confirm_client. */
  clients: z.array(z.object({ id: z.string(), name: z.string() })),
  sections: z.array(SidebarSection),
  suggestions: z.array(Suggestion),
  nudges: z.array(Nudge),
  /** Today's events, sorted by start. */
  calendarToday: z.array(CalEvent),
  usageToday: UsageSummary,
});
export type SidebarState = z.infer<typeof SidebarState>;

/** Brain SSE (`GET /api/events`): event name -> data schema. */
export const BRAIN_SSE_EVENTS = {
  state: SidebarState,
  nudge: Nudge,
  /** Sent every HEARTBEAT_MS so the sidebar can tell a live stream from a silent, dead one. */
  heartbeat: z.object({ now: IsoDateTime }),
} as const;

/** The brain sends a heartbeat this often; the sidebar calls the connection lost after HEARTBEAT_TIMEOUT_MS of silence. */
export const HEARTBEAT_MS = 3_000;
export const HEARTBEAT_TIMEOUT_MS = 8_000;

/** `GET /api/sources/:connector/:id`: the original message behind a source link. Read only; the body is untrusted text. */
export const SourceMessage = z.object({
  connector: z.enum(['mail', 'chat']),
  id: z.string(),
  from: z.object({ name: z.string(), address: z.string() }),
  /** Mail recipients, or the chat channel / "personal chat". */
  to: z.array(z.string()),
  at: IsoDateTime,
  subject: z.string().nullable(),
  body: z.string(),
  truncated: z.boolean(),
});
export type SourceMessage = z.infer<typeof SourceMessage>;

/** `GET /api/conversation`: the one conversation, oldest first (typed and spoken turns). */
export const ConversationTurn = z.object({
  id: z.string(),
  at: IsoDateTime,
  via: z.enum(['text', 'voice']),
  user: z.string(),
  assistant: z.string(),
  interrupted: z.boolean(),
  suggestionIds: z.array(z.string()),
});
export type ConversationTurn = z.infer<typeof ConversationTurn>;
export const ConversationResponse = z.object({ turns: z.array(ConversationTurn) });
export type ConversationResponse = z.infer<typeof ConversationResponse>;

/** `POST /api/chat` body; the response is an SSE stream of CHAT_SSE_EVENTS. */
export const ChatBody = z.object({ text: z.string().trim().min(1) });
export type ChatBody = z.infer<typeof ChatBody>;

export const CHAT_SSE_EVENTS = {
  /** Next piece of the assistant's reply text. */
  delta: z.object({ text: z.string() }),
  /** A suggestion the assistant proposed during this turn. */
  suggestion: z.object({ suggestion: Suggestion }),
  /** End of turn; `text` is the full reply. */
  done: z.object({ text: z.string() }),
  error: z.object({ error: z.string() }),
} as const;

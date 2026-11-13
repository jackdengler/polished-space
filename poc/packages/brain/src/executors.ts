/**
 * Core executors: what approving each suggestion kind does. Called only by
 * approve.ts, inside `runApproved()`. Modules may override a kind through the
 * registry and call through to these with `x.core`.
 */
import { toGraphDateTime, type Suggestion, type SuggestionKind } from '@poc/contracts';
import type { ApplyResult, ExecContext, Executor } from './modules/types';

type Of<K extends SuggestionKind> = Extract<Suggestion, { kind: K }>;

const createTask = async (s: Of<'create_task'>, x: ExecContext): Promise<ApplyResult> => {
  if (!s.clientId) throw new Error('No client set; pick a client before approving.');
  const p = s.payload;
  const { task } = await x.writes.pm.createTask({
    clientId: s.clientId,
    title: p.title,
    dueDate: p.dueDate,
    assigneeIds: p.assigneeIds.length ? p.assigneeIds : [x.config.me.id],
    ...(p.deliverableId ? { deliverableId: p.deliverableId } : {}),
  });
  await x.taskMeta.upsert(task.id, { source: s.source, direction: s.direction ?? 'i_owe', taskType: s.taskType ?? 'other' });
  return { taskIds: [task.id], tasksChanged: true, detail: `created task ${task.id}` };
};

const completeTask = async (s: Of<'complete_task'>, x: ExecContext): Promise<ApplyResult> => {
  const { task } = await x.writes.pm.completeTask(s.payload.taskId);
  return { taskIds: [task.id], tasksChanged: true, detail: `completed task ${task.id}` };
};

const rescheduleTask = async (s: Of<'reschedule_task'>, x: ExecContext): Promise<ApplyResult> => {
  const { task } = await x.writes.pm.rescheduleTask(s.payload.taskId, s.payload.dueDate);
  return { taskIds: [task.id], tasksChanged: true, detail: `rescheduled task ${task.id} to ${task.dueDate ?? 'no date'}` };
};

const calendarBlock = async (s: Of<'calendar_block'>, x: ExecContext): Promise<ApplyResult> => {
  const p = s.payload;
  if (Date.parse(p.end) <= Date.parse(p.start)) throw new Error('The block must end after it starts.');
  const ev = await x.writes.calendar.createEvent({
    subject: p.subject,
    start: toGraphDateTime(p.start),
    end: toGraphDateTime(p.end),
    attendees: [],
    showAs: 'busy',
    categories: [p.purpose === 'lunch' ? 'Lunch' : 'Focus time'],
  });
  return { calendarChanged: true, detail: `created event ${ev.id}` };
};

const sendReply = async (s: Of<'send_reply'>, x: ExecContext): Promise<ApplyResult> => {
  const sent = await x.writes.mail.send(s.payload.draft);
  if (!s.payload.taskId) return { detail: `sent ${sent.id}` };
  try {
    await x.writes.pm.completeTask(s.payload.taskId);
  } catch (err) {
    throw new Error(`The email was sent, but marking the task done failed: ${(err as Error).message}`);
  }
  return { taskIds: [s.payload.taskId], tasksChanged: true, detail: `sent ${sent.id}, completed ${s.payload.taskId}` };
};

/**
 * Sets the confirmed client on the related suggestions (they stay pending
 * for their own approval). Recording the alias in the profile is the profiles
 * module's job, in onSuggestionApplied. No outside system is written.
 */
const confirmClient = async (s: Of<'confirm_client'>, x: ExecContext): Promise<ApplyResult> => {
  const clientId = s.clientId;
  if (!clientId) throw new Error('No client chosen.');
  for (const id of s.payload.relatedSuggestionIds) {
    const r = x.suggestions.get(id);
    if (!r || r.status !== 'pending') continue;
    await x.suggestions.revise(id, (cur) => ({ ...cur, clientId, clientConfidence: 'high' }));
  }
  return { detail: `client ${clientId} confirmed` };
};

export const CORE_EXECUTORS: { [K in SuggestionKind]: (s: Of<K>, x: ExecContext) => Promise<ApplyResult> } = {
  create_task: createTask,
  complete_task: completeTask,
  reschedule_task: rescheduleTask,
  calendar_block: calendarBlock,
  send_reply: sendReply,
  confirm_client: confirmClient,
};

export function coreExecutor(kind: SuggestionKind): Executor {
  return CORE_EXECUTORS[kind] as Executor;
}

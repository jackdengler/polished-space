import type { ApproveBody, MailDraft, Suggestion } from '@poc/contracts';
import { fromLocalInput, parsePeople, personLabel, toLocalInput } from './format';

/**
 * The editable fields of each suggestion kind, and how a filled-in form turns
 * into `ApproveBody.edits` (contract: `title`, `clientId`, and `payload`,
 * shallow-merged over the suggestion's payload by the brain). Only changed
 * fields are sent. For `send_reply` the whole edited draft goes in
 * `payload.draft`, as the contract asks.
 */

export type EditForm =
  | { kind: 'create_task'; title: string; clientId: string; dueDate: string }
  | { kind: 'complete_task'; taskId: string }
  | { kind: 'reschedule_task'; dueDate: string }
  | { kind: 'calendar_block'; subject: string; start: string; end: string }
  | { kind: 'send_reply'; to: string; cc: string; subject: string; body: string }
  | { kind: 'confirm_client'; clientId: string; alias: string };

export function initialForm(s: Suggestion): EditForm {
  switch (s.kind) {
    case 'create_task':
      return { kind: 'create_task', title: s.payload.title, clientId: s.clientId ?? '', dueDate: s.payload.dueDate ?? '' };
    case 'complete_task':
      return { kind: 'complete_task', taskId: s.payload.taskId };
    case 'reschedule_task':
      return { kind: 'reschedule_task', dueDate: s.payload.dueDate ?? '' };
    case 'calendar_block':
      return { kind: 'calendar_block', subject: s.payload.subject, start: toLocalInput(s.payload.start), end: toLocalInput(s.payload.end) };
    case 'send_reply':
      return {
        kind: 'send_reply',
        to: s.payload.draft.to.map(personLabel).join(', '),
        cc: s.payload.draft.cc.map(personLabel).join(', '),
        subject: s.payload.draft.subject,
        body: s.payload.draft.body,
      };
    case 'confirm_client':
      return {
        kind: 'confirm_client',
        clientId: s.clientId ?? (s.payload.candidateClientIds.length === 1 ? s.payload.candidateClientIds[0]! : ''),
        alias: s.payload.alias ?? '',
      };
  }
}

export type BuildResult = { ok: true; edits: ApproveBody['edits'] } | { ok: false; error: string };

/** Turn a form into edits. `undefined` edits means "approve as is". */
export function buildEdits(s: Suggestion, f: EditForm): BuildResult {
  const edits: NonNullable<ApproveBody['edits']> = {};
  const payload: Record<string, unknown> = {};
  switch (f.kind) {
    case 'create_task': {
      if (s.kind !== 'create_task') break;
      const title = f.title.trim();
      if (!title) return { ok: false, error: 'The task needs a title.' };
      if (!f.clientId) return { ok: false, error: 'Pick a client first.' };
      if (title !== s.payload.title) {
        payload.title = title;
        edits.title = title;
      }
      if (f.clientId !== s.clientId) edits.clientId = f.clientId;
      const due = f.dueDate || null;
      if (due !== s.payload.dueDate) payload.dueDate = due;
      break;
    }
    case 'complete_task':
      if (s.kind !== 'complete_task') break;
      if (!f.taskId) return { ok: false, error: 'Pick a task.' };
      if (f.taskId !== s.payload.taskId) payload.taskId = f.taskId;
      break;
    case 'reschedule_task': {
      if (s.kind !== 'reschedule_task') break;
      const due = f.dueDate || null;
      if (due !== s.payload.dueDate) payload.dueDate = due;
      break;
    }
    case 'calendar_block': {
      if (s.kind !== 'calendar_block') break;
      const subject = f.subject.trim();
      const start = fromLocalInput(f.start);
      const end = fromLocalInput(f.end);
      if (!subject) return { ok: false, error: 'The block needs a name.' };
      if (!start || !end) return { ok: false, error: 'Enter a start and an end time.' };
      if (Date.parse(end) <= Date.parse(start)) return { ok: false, error: 'The end must be after the start.' };
      if (subject !== s.payload.subject) payload.subject = subject;
      if (Date.parse(start) !== Date.parse(s.payload.start)) payload.start = start;
      if (Date.parse(end) !== Date.parse(s.payload.end)) payload.end = end;
      break;
    }
    case 'send_reply': {
      if (s.kind !== 'send_reply') break;
      const to = parsePeople(f.to);
      const cc = parsePeople(f.cc);
      if (!to || to.length === 0) return { ok: false, error: 'Add at least one valid "To" address.' };
      if (!cc) return { ok: false, error: 'One of the "Cc" addresses is not valid.' };
      if (!f.subject.trim()) return { ok: false, error: 'The email needs a subject.' };
      if (!f.body.trim()) return { ok: false, error: 'The email is empty.' };
      const old = s.payload.draft;
      // Keep the original display names when only the address list text is unchanged.
      const draft: MailDraft = {
        to: f.to === old.to.map(personLabel).join(', ') ? old.to : to,
        cc: f.cc === old.cc.map(personLabel).join(', ') ? old.cc : cc,
        subject: f.subject.trim(),
        body: f.body,
        replyToMessageId: old.replyToMessageId,
      };
      if (JSON.stringify(draft) !== JSON.stringify(old)) payload.draft = draft;
      break;
    }
    case 'confirm_client': {
      if (s.kind !== 'confirm_client') break;
      if (!f.clientId) return { ok: false, error: 'Pick the client this is about.' };
      // Approving a confirm_client always names the client (contract: edits.clientId).
      edits.clientId = f.clientId;
      const alias = f.alias.trim() || null;
      if (alias !== s.payload.alias) payload.alias = alias;
      break;
    }
  }
  if (Object.keys(payload).length) edits.payload = payload;
  return { ok: true, edits: Object.keys(edits).length ? edits : undefined };
}

/** Whether a suggestion can be approved without opening the form. */
export function needsInputBeforeApprove(s: Suggestion): string | null {
  if (s.kind === 'create_task' && !s.clientId) return 'Pick a client first.';
  if (s.kind === 'confirm_client' && !s.clientId && s.payload.candidateClientIds.length !== 1) return 'Pick the client this is about.';
  return null;
}

/**
 * Prepared work: gather context in code, make ONE prepare call, store the
 * result in the TaskMeta overlay, and create (or revise) the ONE pending
 * suggestion that approving it runs through the normal approve path.
 *
 * Nothing here writes to an outside system: it only reads (`ctx.read`),
 * proposes (`ctx.suggestions`) and keeps its own notes (TaskMeta, and the
 * proposed next steps in `brain/prepare-next-steps.json`).
 */
import { join } from 'node:path';
import {
  IsoDate,
  addDaysIso,
  zonedTime,
  type MailDraft,
  type MailMessage,
  type Person,
  type PreparedResponse,
  type PreparedWork,
  type SourceRef,
  type Suggestion,
  type TaskType,
} from '@poc/contracts';
import type { ModuleContext } from '../modules/types';
import type { NewSuggestion } from '../store/suggestions';
import { JsonFile } from '../store/jsonFile';
import { chaseTarget, contactNamed, findFile, gather, mailRef, mailText, mentionedFiles, PrepareError, profileExcerpts, relatedMail, replyTarget, resolvePerson, type Gathered } from './gather';
import { buildPrepareRequest, OUTPUT_SCHEMAS, type NextStepOut, type PromptFacts } from './prompt';
import { findMeetingSlots, formatSlot, meetingMinutes } from './slots';

/** The prepare call is aborted after this long, so a stuck call ends as `failed`, never a hang. */
export const PREPARE_TIMEOUT_MS = 180_000;
const MAX_PDF_BASE64 = 30_000_000;
const MAX_TEXT_CHARS = 150_000;

export const NEXT_STEPS_FILE = 'brain/prepare-next-steps.json';

interface NextStepRecord {
  nextStep: NextStepOut;
  /** People the next-step email may go to besides the client's contacts (the reply recipient). */
  people: Person[];
  /** The suggestion id that acts on the prepared work, when this next step was made. */
  forSuggestionId: string | null;
  /** Set once the next-step suggestion exists, so it is proposed exactly once. */
  proposedSuggestionId: string | null;
}

interface Built {
  prepared: PreparedWork;
  nextStep: NextStepOut;
  people: Person[];
}

const reSubject = (s: string) => (/^re:/i.test(s.trim()) ? s.trim() : `Re: ${s.trim()}`);
const firstName = (name: string) => name.split(/\s+/)[0] ?? name;
const personLine = (p: Person) => `${p.name} <${p.address}>`;
const mailMaterial = (m: MailMessage, label?: string) => ({
  label: label ?? `${m.from.emailAddress.name} <${m.from.emailAddress.address}> on ${m.receivedDateTime}, subject "${m.subject}"`,
  text: mailText(m),
});

export class PrepareService {
  private gen = new Map<string, number>();
  private errors = new Map<string, string>();
  private pending = new Set<Promise<unknown>>();
  private nextSteps: Record<string, NextStepRecord> = {};
  private file: JsonFile<Record<string, NextStepRecord>>;

  constructor(private ctx: ModuleContext) {
    this.file = new JsonFile(join(ctx.config.dataDir, NEXT_STEPS_FILE));
  }

  async load(): Promise<void> {
    const raw = await this.file.load({});
    this.nextSteps = raw && typeof raw === 'object' ? raw : {};
  }

  /** Resolves when every preparation started so far has finished. For tests. */
  async idle(): Promise<void> {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  /** Start preparing in the background (route use); returns at once. */
  startPrepare(taskId: string): void {
    const p = this.prepare(taskId).catch((err) => this.ctx.log(`prepare ${taskId} crashed: ${(err as Error).message}`));
    this.pending.add(p);
    p.finally(() => this.pending.delete(p));
  }

  /** What `GET /api/tasks/:id/prepared` returns. `error` is an extra field: why it failed (null otherwise). */
  response(taskId: string): PreparedResponse & { error: string | null } {
    const meta = this.ctx.taskMeta.get(taskId);
    const status = meta?.preparedStatus ?? 'none';
    const suggestion = meta?.preparedSuggestionId ? this.ctx.suggestions.get(meta.preparedSuggestionId) : null;
    return { taskId, status, prepared: meta?.prepared ?? null, suggestion, error: status === 'failed' ? (this.errors.get(taskId) ?? 'Preparing this task failed.') : null };
  }

  /**
   * Prepare (or regenerate) one task. A newer run supersedes an older one:
   * only the latest run writes its result.
   */
  async prepare(taskId: string): Promise<void> {
    const gen = (this.gen.get(taskId) ?? 0) + 1;
    this.gen.set(taskId, gen);
    const current = () => this.gen.get(taskId) === gen;
    this.errors.delete(taskId);
    await this.ctx.taskMeta.upsert(taskId, { preparedStatus: 'preparing' });
    try {
      const g = await gather(this.ctx, taskId);
      if (g.task.done) throw new PrepareError('This task is already done.');
      const built = await this.build(g);
      if (!current()) return;
      const suggestionId = await this.upsertSuggestion(g, built.prepared);
      if (!current()) return;
      await this.ctx.taskMeta.upsert(taskId, { prepared: built.prepared, preparedStatus: 'ready', preparedSuggestionId: suggestionId });
      const prev = this.nextSteps[taskId];
      if (!prev?.proposedSuggestionId) {
        this.nextSteps[taskId] = { nextStep: built.nextStep, people: built.people, forSuggestionId: suggestionId, proposedSuggestionId: null };
        await this.file.save(this.nextSteps);
      }
    } catch (err) {
      if (!current()) return;
      const message = (err as Error).message || String(err);
      this.errors.set(taskId, message);
      this.ctx.log(`prepare ${taskId} failed: ${message}`);
      await this.ctx.taskMeta.upsert(taskId, { preparedStatus: 'failed' });
      const title = this.ctx.taskMeta.get(taskId) ? (await this.taskTitle(taskId)) : taskId;
      this.ctx.nudges.add({ kind: 'info', text: `I couldn't prepare "${title}": ${message} You can try again from the task.`, source: null, taskId });
    }
  }

  private async taskTitle(taskId: string): Promise<string> {
    try {
      const { tasks } = await this.ctx.read.pm.listTasks({ includeDone: true });
      return tasks.find((t) => t.id === taskId)?.title ?? taskId;
    } catch {
      return taskId;
    }
  }

  // ---- the one approving suggestion ------------------------------------------

  /**
   * Revise the still-pending prepared suggestion in place (same id, so no
   * orphan), or add a new one. If the old one was already approved, the
   * task is done and no new suggestion is made.
   */
  private async upsertSuggestion(g: Gathered, prepared: PreparedWork): Promise<string | null> {
    const input = this.suggestionFor(g, prepared);
    const oldId = g.meta.preparedSuggestionId;
    const old = oldId ? this.ctx.suggestions.get(oldId) : null;
    if (old && (old.status === 'applied' || old.status === 'approved')) return old.id;
    if (old && old.status === 'pending' && old.kind === input.kind) {
      try {
        const revised = await this.ctx.suggestions.revise(old.id, (cur) => ({ ...cur, title: input.title, nudge: input.nudge, source: input.source, taskType: input.taskType, payload: input.payload }) as Suggestion);
        return revised.id;
      } catch {
        // Decided while we were preparing; fall through and decide afresh.
        const now = this.ctx.suggestions.get(old.id);
        if (now && (now.status === 'applied' || now.status === 'approved')) return now.id;
      }
    }
    return (await this.ctx.suggestions.add(input)).id;
  }

  private suggestionFor(g: Gathered, prepared: PreparedWork): NewSuggestion {
    const base = {
      clientId: g.task.clientId,
      clientConfidence: 'high' as const,
      source: g.meta.source,
      direction: g.meta.direction,
      taskType: g.meta.taskType,
      duplicateOf: null,
    };
    if (prepared.type === 'reply_email' || prepared.type === 'schedule_meeting' || prepared.type === 'follow_up') {
      const to = prepared.draft.to[0]!;
      const what = prepared.type === 'schedule_meeting' ? 'reply with meeting times' : prepared.type === 'follow_up' ? 'follow-up' : 'reply';
      return {
        ...base,
        kind: 'send_reply',
        title: `Send the ${what} to ${to.name}`,
        nudge: `Your ${what} to ${firstName(to.name)} is drafted. Approve to send it and tick off "${g.task.title}".`,
        payload: { draft: prepared.draft, taskId: g.task.id },
      };
    }
    return {
      ...base,
      kind: 'complete_task',
      title: `Mark "${g.task.title}" done`,
      nudge: prepared.type === 'review_file' ? `I've read ${prepared.path.split('/').pop()} and noted the key points. Approve when you're happy with the review.` : `I've gathered the context for "${g.task.title}". Approve when it's done.`,
      payload: { taskId: g.task.id },
    };
  }

  // ---- next step ---------------------------------------------------------------

  /** After the prepared suggestion is applied: propose ONE follow-on (never applied automatically). */
  async proposeNextStep(applied: Suggestion): Promise<Suggestion | null> {
    const entry = Object.values(this.ctx.taskMeta.all()).find((m) => m.preparedSuggestionId === applied.id);
    if (!entry) return null;
    const taskId = entry.taskId;
    const rec = this.nextSteps[taskId];
    if (!rec || rec.proposedSuggestionId || rec.nextStep.kind === 'none') return null;
    if (this.ctx.suggestions.list().some((s) => s.source?.connector === 'next_step' && s.source.id === taskId)) return null;
    rec.proposedSuggestionId = 'pending'; // claim synchronously so it is proposed once
    const { tasks } = await this.ctx.read.pm.listTasks({ includeDone: true });
    const task = tasks.find((t) => t.id === taskId);
    const client = (await this.ctx.clients()).find((c) => c.id === (task?.clientId ?? applied.clientId)) ?? null;
    const n = rec.nextStep;
    const source: SourceRef = { connector: 'next_step', id: taskId, label: `Next step after "${task?.title ?? applied.title}"` };
    const base = { clientId: client?.id ?? applied.clientId, clientConfidence: 'high' as const, source, direction: 'i_owe' as const, duplicateOf: null };
    let input: NewSuggestion | null = null;
    if (n.kind === 'email') {
      const to = resolvePerson(n.toName, client, rec.people);
      if (to && n.subject.trim() && n.body.trim()) {
        input = {
          ...base,
          taskType: 'other',
          kind: 'send_reply',
          title: n.title.trim() || `Email ${to.name}`,
          nudge: n.nudge.trim() || `Want me to email ${firstName(to.name)}?`,
          payload: { draft: { to: [to], cc: [], subject: n.subject.trim(), body: n.body.trim(), replyToMessageId: null }, taskId: null },
        };
      }
    } else if (n.kind === 'task' && n.title.trim() && base.clientId) {
      const due = n.dueDate && IsoDate.safeParse(n.dueDate).success ? n.dueDate : null;
      input = {
        ...base,
        taskType: n.taskType,
        kind: 'create_task',
        title: n.title.trim(),
        nudge: n.nudge.trim() || `Shall I add "${n.title.trim()}"?`,
        payload: { title: n.title.trim(), dueDate: due, assigneeIds: [this.ctx.config.me.id] },
      };
    }
    if (!input) {
      rec.proposedSuggestionId = null;
      rec.nextStep = { ...n, kind: 'none' };
      await this.file.save(this.nextSteps);
      return null;
    }
    const made = await this.ctx.suggestions.add(input);
    rec.proposedSuggestionId = made.id;
    await this.file.save(this.nextSteps);
    this.ctx.nudges.add({ kind: 'new_item', text: made.nudge, source, suggestionIds: [made.id], taskId });
    return made;
  }

  // ---- building prepared work per type ------------------------------------------

  private async call<T extends TaskType>(g: Gathered, type: T, facts: string[], material: PromptFacts['material'], pdf: PromptFacts['pdf'] = null) {
    const c = this.ctx;
    const contacts = g.client?.contacts.map((k) => `${k.name} <${k.email}>${k.role ? ` (${k.role})` : ''}`) ?? [];
    const req = buildPrepareRequest({
      now: c.clock.now(),
      today: c.clock.today(),
      tz: c.clock.tz,
      me: c.config.me,
      taskType: type,
      facts: [`Task: "${g.task.title}" for ${g.task.clientName}${g.task.dueDate ? `, due ${g.task.dueDate}` : ''}.`, `Client contacts: ${contacts.join('; ') || 'none listed'}.`, ...facts],
      profile: g.profile,
      material,
      pdf,
    });
    const { data } = await c.claude.parse(
      { call: 'prepare', sourceId: g.task.id },
      { ...req, effort: 'medium', maxTokens: 16000, cacheTtl: '5m', signal: AbortSignal.timeout(PREPARE_TIMEOUT_MS) },
      OUTPUT_SCHEMAS[type],
    );
    return data as import('zod').infer<(typeof OUTPUT_SCHEMAS)[T]>;
  }

  private sourceMaterial(g: Gathered): PromptFacts['material'] {
    if (g.sourceChat) return [{ label: `Chat from ${g.sourceChat.sender_display_name} on ${g.sourceChat.date_time}`, text: g.sourceChat.message }];
    if (!g.sourceMail && g.sourceText) return [{ label: g.meta.source?.label ?? 'Task source', text: g.sourceText }];
    return [];
  }

  private threadFor(g: Gathered, m: MailMessage | null): MailMessage[] {
    if (!m) return [];
    return g.inbox.filter((x) => x.conversationId === m.conversationId && x.id !== m.id).concat(m).slice(-6);
  }

  async build(g: Gathered): Promise<Built> {
    switch (g.meta.taskType) {
      case 'reply_email':
        return this.buildReply(g);
      case 'schedule_meeting':
        return this.buildMeeting(g);
      case 'review_file':
        return this.buildReview(g);
      case 'follow_up':
        return this.buildFollowUp(g);
      default:
        return this.buildOther(g);
    }
  }

  private draft(to: Person, subject: string, body: string, replyTo: string | null): MailDraft {
    if (!body.trim()) throw new PrepareError('Claude returned an empty draft.');
    return { to: [to], cc: [], subject: subject.trim() || 'Following up', body: body.trim(), replyToMessageId: replyTo };
  }

  private async buildReply(g: Gathered): Promise<Built> {
    const { to, replyTo } = replyTarget(this.ctx, g);
    const out = await this.call(
      g,
      'reply_email',
      [`Reply to: ${personLine(to)}.`, replyTo ? `Answering the email "${replyTo.subject}" (the last item in the thread below).` : 'There is no email to answer; write a short new email about the task.'],
      [...this.threadFor(g, replyTo).map((m) => mailMaterial(m)), ...this.sourceMaterial(g)],
    );
    const subject = replyTo ? reSubject(replyTo.subject) : out.subject;
    return { prepared: { type: 'reply_email', draft: this.draft(to, subject, out.body, replyTo?.id ?? null) }, nextStep: out.nextStep, people: [to] };
  }

  private async buildMeeting(g: Gathered): Promise<Built> {
    const c = this.ctx;
    const { to, replyTo } = replyTarget(c, g);
    const today = c.clock.today();
    const events = await c.read.calendar.view(zonedTime(today, 0, c.clock.tz).toISOString(), zonedTime(addDaysIso(today, 15), 0, c.clock.tz).toISOString());
    const askText = `${g.task.title}\n${replyTo ? mailText(replyTo) : g.sourceText}`;
    const minutes = meetingMinutes(askText);
    const candidates = findMeetingSlots(events, { now: c.clock.now(), tz: c.clock.tz, durationMin: minutes }).map((s, i) => ({ id: `t${i + 1}`, slot: s }));
    if (!candidates.length) throw new PrepareError('There is no free time in the next working week for this meeting.');
    const out = await this.call(
      g,
      'schedule_meeting',
      [
        `Reply to: ${personLine(to)}.`,
        replyTo ? `Answering the email "${replyTo.subject}".` : 'There is no email to answer; write a short new email proposing a meeting.',
        `Meeting length: ${minutes} minutes.`,
        `Candidate free times (${c.clock.tz}), computed from the user's calendar:\n${candidates.map((x) => `- ${x.id}: ${formatSlot(x.slot, c.clock.tz)}`).join('\n')}`,
      ],
      [...this.threadFor(g, replyTo).map((m) => mailMaterial(m)), ...this.sourceMaterial(g)],
    );
    const byId = new Map(candidates.map((x) => [x.id, x.slot]));
    let chosen = [...new Set(out.slotIds)].flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])).slice(0, 3);
    if (chosen.length < 2) chosen = candidates.slice(0, 3).map((x) => x.slot);
    chosen.sort((a, b) => a.start.localeCompare(b.start));
    const lines = chosen.map((s) => `- ${formatSlot(s, c.clock.tz)} (${c.clock.tz})`).join('\n');
    const body = fillTimes(out.body, lines);
    const subject = replyTo ? reSubject(replyTo.subject) : `Time to meet: ${g.task.title}`;
    return { prepared: { type: 'schedule_meeting', slots: chosen, draft: this.draft(to, subject, body, replyTo?.id ?? null) }, nextStep: out.nextStep, people: [to] };
  }

  private async buildReview(g: Gathered): Promise<Built> {
    const file = await findFile(this.ctx, g);
    let pdf: PromptFacts['pdf'] = null;
    const material = [...(g.sourceMail ? [mailMaterial(g.sourceMail)] : []), ...this.sourceMaterial(g)];
    if (file.mimeType === 'application/pdf') {
      if (file.content.length > MAX_PDF_BASE64) throw new PrepareError(`${file.name} is too large to send for review.`);
      pdf = file;
    } else {
      const text = file.content.length > MAX_TEXT_CHARS ? `${file.content.slice(0, MAX_TEXT_CHARS)}\n[Truncated: first ${MAX_TEXT_CHARS} of ${file.content.length} characters.]` : file.content;
      material.unshift({ label: `File ${file.path} (${file.mimeType})`, text });
    }
    const out = await this.call(g, 'review_file', [`The file to review: ${file.path}${pdf ? ' (attached above as a PDF document)' : ' (its text is in the material below)'}.`], material, pdf);
    const keyPoints = out.keyPoints.map((k) => k.trim()).filter(Boolean).slice(0, 8);
    if (!out.summary.trim() || !keyPoints.length) throw new PrepareError('Claude returned no summary or key points.');
    const people = g.sourceMail ? [{ name: g.sourceMail.from.emailAddress.name, address: g.sourceMail.from.emailAddress.address }] : [];
    return { prepared: { type: 'review_file', path: file.path, summary: out.summary.trim(), keyPoints }, nextStep: out.nextStep, people };
  }

  private async buildFollowUp(g: Gathered): Promise<Built> {
    const { to, lastSent, lastFrom } = await chaseTarget(this.ctx, g);
    const material = [
      ...(lastSent ? [mailMaterial(lastSent, `The last email the user sent to ${to.name}, on ${lastSent.sentDateTime ?? lastSent.receivedDateTime}, subject "${lastSent.subject}"`)] : []),
      ...(lastFrom ? [mailMaterial(lastFrom, `The last email from ${to.name}, on ${lastFrom.receivedDateTime}, subject "${lastFrom.subject}"`)] : []),
      ...(g.sourceMail && g.sourceMail.id !== lastFrom?.id ? [mailMaterial(g.sourceMail)] : []),
      ...this.sourceMaterial(g),
    ];
    const out = await this.call(g, 'follow_up', [`Chase: ${personLine(to)}.`, lastSent ? `They have not answered the email "${lastSent.subject}".` : 'No sent email to them is on file; base the chaser on the task and the profile.'], material);
    const subject = lastSent ? reSubject(lastSent.subject) : out.subject;
    return { prepared: { type: 'follow_up', draft: this.draft(to, subject, out.body, lastSent?.id ?? null) }, nextStep: out.nextStep, people: [to] };
  }

  private async buildOther(g: Gathered): Promise<Built> {
    const related = relatedMail(g, g.sourceMail?.id ?? null);
    const files = g.client?.fileFolder ? mentionedFiles(await this.ctx.read.files.list(g.client.fileFolder), `${g.task.title}\n${g.sourceText}`).slice(0, 2) : [];
    const fileItems = await Promise.all(
      files.map(async (f) => {
        const ref: SourceRef = { connector: 'files', id: f.path, label: f.name };
        if (f.mimeType === 'application/pdf') return { label: `File: ${f.name}`, text: `PDF, ${Math.round(f.size / 1024)} KB, in ${f.folder}.`, source: ref };
        const content = await this.ctx.read.files.read(f.path);
        return { label: `File: ${f.name}`, text: content.content.slice(0, 1200), source: ref };
      }),
    );
    const sourceItem = g.meta.source && (g.sourceText || g.sourceMail) ? [{ label: g.meta.source.label, text: (g.sourceText || '').slice(0, 2000), source: g.meta.source }] : [];
    const relatedItems = related.map((m) => ({ label: mailRef(m).label, text: mailText(m).slice(0, 1200), source: mailRef(m) }));
    const profileItems = profileExcerpts(g.profile).map((p) => ({ ...p, source: null }));
    const named = contactNamed(g.client, `${g.task.title}\n${g.sourceText}`);
    const out = await this.call(
      g,
      'other',
      named ? [`Person involved: ${personLine(named)}.`] : [],
      [...sourceItem, ...relatedItems, ...fileItems].map((x) => ({ label: x.label, text: x.text })),
    );
    const notes = out.notes.filter((n) => n.label.trim() && n.text.trim()).slice(0, 3).map((n) => ({ label: n.label.trim(), text: n.text.trim(), source: null }));
    const context = [...(out.summary.trim() ? [{ label: 'Summary', text: out.summary.trim(), source: null }] : []), ...notes, ...sourceItem, ...relatedItems, ...fileItems, ...profileItems];
    const people = [...(named ? [named] : []), ...(g.sourceMail ? [{ name: g.sourceMail.from.emailAddress.name, address: g.sourceMail.from.emailAddress.address }] : [])];
    return { prepared: { type: 'other', context }, nextStep: out.nextStep, people };
  }
}

/** Put the code-made list of times where Claude wrote [[TIMES]]; if it did not, before the sign-off. */
export function fillTimes(body: string, lines: string): string {
  const cleaned = body.trim();
  if (cleaned.includes('[[TIMES]]')) return cleaned.replace(/\[\[TIMES\]\]/g, lines);
  const paras = cleaned.split(/\n\s*\n/);
  if (paras.length < 2) return `${cleaned}\n\n${lines}`;
  paras.splice(paras.length - 1, 0, lines);
  return paras.join('\n\n');
}

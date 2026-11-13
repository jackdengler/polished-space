/**
 * The approve path: the ONLY code that runs actions against outside systems.
 *
 * approve(id, { edits }) -> validate edits -> claim (pending|failed -> approved)
 * -> run the kind's executor inside runApproved() -> applied, or failed with
 * the error shown to the user. A failed action is never retried by the brain;
 * the user may approve it again by hand. deny(id) changes nothing outside.
 */
import { ApproveBody, PAYLOAD_SCHEMAS, Suggestion, humanIssues, type PmClient } from '@poc/contracts';
import type { BrainConfig } from './config';
import { coreExecutor } from './executors';
import { runApproved, type Connectors } from './guard';
import { HttpProblem } from './httpProblem';
import type { Registry } from './modules/registry';
import type { ApplyResult, ExecContext, ModuleContext } from './modules/types';
import type { NudgeStore } from './store/nudges';
import { SuggestionConflictError, type SuggestionStore } from './store/suggestions';

/** Kinds whose only write is one Planr call, so a refusal by Planr means nothing changed. */
const PM_ONLY = new Set(['create_task', 'complete_task', 'reschedule_task']);

/** 409 text: someone (another tab, a double click) decided it first. Starts with "Already" so the sidebar can tell. */
export function alreadyDecided(status: string): string {
  if (status === 'applied' || status === 'approved') return 'Already approved: this was done a moment ago.';
  if (status === 'denied') return 'Already dealt with: this suggestion was denied or replaced.';
  return `Already decided (${status}).`;
}

export interface ApproverDeps {
  config: BrainConfig;
  store: SuggestionStore;
  writes: Connectors;
  registry: Registry;
  nudges: NudgeStore;
  clients(): Promise<PmClient[]>;
  taskMeta: ModuleContext['taskMeta'];
  suggestions: ModuleContext['suggestions'];
  /** Called after an action that changed tasks or the calendar. */
  afterApply(result: ApplyResult): void;
  log(msg: string): void;
}

export class Approver {
  constructor(private d: ApproverDeps) {}

  private async applyEdits(current: Suggestion, body: unknown): Promise<Suggestion> {
    const parsed = ApproveBody.safeParse(body ?? {});
    if (!parsed.success) throw new HttpProblem(400, `That change could not be read: ${humanIssues(parsed.error, body)}`);
    const edits = parsed.data.edits ?? {};
    const next = structuredClone(current) as unknown as Omit<Suggestion, 'payload'> & { payload: Record<string, unknown> };
    if (edits.title) next.title = edits.title;
    if (edits.clientId) {
      const clients = await this.d.clients();
      if (!clients.some((c) => c.id === edits.clientId && !c.archived)) throw new HttpProblem(400, `There is no active client with id "${edits.clientId}". Pick one from the list.`);
      next.clientId = edits.clientId;
      next.clientConfidence = 'high';
    }
    const merged: Record<string, unknown> = { ...next.payload, ...(edits.payload ?? {}) };
    if (current.kind === 'create_task' && edits.title && edits.payload?.title === undefined) merged.title = edits.title;
    const payload = PAYLOAD_SCHEMAS[current.kind].safeParse(merged);
    if (!payload.success) throw new HttpProblem(400, `${humanIssues(payload.error, merged)} Nothing was changed.`);
    next.payload = payload.data as Record<string, unknown>;
    if (current.kind === 'confirm_client') {
      const cands = (next.payload.candidateClientIds as string[]) ?? [];
      const chosen = edits.clientId ?? (cands.length === 1 ? cands[0]! : null);
      if (!chosen) throw new HttpProblem(400, 'Pick a client first, then approve.');
      if (!edits.clientId) {
        const clients = await this.d.clients();
        if (!clients.some((c) => c.id === chosen && !c.archived)) throw new HttpProblem(400, `There is no active client with id "${chosen}". Pick one from the list.`);
      }
      next.clientId = chosen;
      next.clientConfidence = 'high';
    }
    if (current.kind === 'create_task' && !next.clientId) throw new HttpProblem(400, 'This task has no client yet. Pick a client, then approve.');
    const valid = Suggestion.safeParse(next);
    if (!valid.success) throw new HttpProblem(400, `${humanIssues(valid.error, next)} Nothing was changed.`);
    return valid.data;
  }

  async approve(id: string, body: unknown): Promise<Suggestion> {
    const current = this.d.store.get(id);
    if (!current) throw new HttpProblem(404, 'That suggestion no longer exists.');
    if (current.status !== 'pending' && current.status !== 'failed') throw new HttpProblem(409, alreadyDecided(current.status));
    const edited = await this.applyEdits(current, body);
    try {
      this.d.store.claim(id, ['pending', 'failed'], 'approved');
    } catch (err) {
      if (err instanceof SuggestionConflictError) throw new HttpProblem(409, alreadyDecided(this.d.store.get(id)?.status ?? 'decided'));
      throw err;
    }
    const approved = await this.d.store.update(id, () => ({ ...edited, status: 'approved', error: null }));

    const executor = this.d.registry.executorOverride(approved.kind) ?? coreExecutor(approved.kind);
    const x: ExecContext = {
      config: this.d.config,
      writes: this.d.writes,
      taskMeta: this.d.taskMeta,
      suggestions: this.d.suggestions,
      core: coreExecutor(approved.kind),
    };
    let result: ApplyResult;
    try {
      result = await runApproved(id, () => executor(approved, x));
    } catch (err) {
      const message = (err as Error).message || String(err);
      // Planr refused the input of a task action (unknown member, task or deliverable, bad date):
      // nothing was written, so this is a bad request, not a failed action. Put the suggestion back as it was.
      if ((err as { refused?: boolean }).refused === true && PM_ONLY.has(approved.kind)) {
        await this.d.store.update(id, () => current);
        this.d.log(`approve ${id} (${approved.kind}) refused by Planr: ${message}`);
        throw new HttpProblem(400, `${message.replace(/\.?$/, '.')} Nothing was changed.`);
      }
      const failed = await this.d.store.update(id, (s) => ({ ...s, status: 'failed', error: message, decidedAt: this.d.config.clock.now().toISOString() }));
      this.d.log(`approve ${id} (${failed.kind}) failed: ${message}`);
      this.d.nudges.add({ kind: 'info', text: `I couldn't finish "${failed.title}": ${message}`, source: failed.source, suggestionIds: [id] });
      this.d.registry.emit('onSuggestionFailed', { suggestion: failed });
      return failed;
    }
    const applied = await this.d.store.update(id, (s) => ({ ...s, status: 'applied', error: null, decidedAt: this.d.config.clock.now().toISOString() }));
    this.d.log(`approve ${id} (${applied.kind}) applied${result.detail ? `: ${result.detail}` : ''}`);
    this.d.registry.emit('onSuggestionApplied', { suggestion: applied, result });
    this.d.afterApply(result);
    return applied;
  }

  async deny(id: string): Promise<Suggestion> {
    const current = this.d.store.get(id);
    if (!current) throw new HttpProblem(404, 'That suggestion no longer exists.');
    try {
      this.d.store.claim(id, ['pending', 'failed'], 'denied');
    } catch (err) {
      if (err instanceof SuggestionConflictError) throw new HttpProblem(409, alreadyDecided(this.d.store.get(id)?.status ?? 'decided'));
      throw err;
    }
    const denied = await this.d.store.update(id, (s) => ({ ...s, status: 'denied', decidedAt: this.d.config.clock.now().toISOString() }));
    this.d.registry.emit('onSuggestionDenied', { suggestion: denied });
    return denied;
  }
}

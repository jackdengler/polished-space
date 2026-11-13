/**
 * The approve path: the ONLY code that runs actions against outside systems.
 *
 * approve(id, { edits }) -> validate edits -> claim (pending|failed -> approved)
 * -> run the kind's executor inside runApproved() -> applied, or failed with
 * the error shown to the user. A failed action is never retried by the brain;
 * the user may approve it again by hand. deny(id) changes nothing outside.
 */
import { ApproveBody, PAYLOAD_SCHEMAS, Suggestion, type PmClient } from '@poc/contracts';
import type { BrainConfig } from './config';
import { coreExecutor } from './executors';
import { runApproved, type Connectors } from './guard';
import { HttpProblem } from './httpProblem';
import type { Registry } from './modules/registry';
import type { ApplyResult, ExecContext, ModuleContext } from './modules/types';
import type { NudgeStore } from './store/nudges';
import { SuggestionConflictError, type SuggestionStore } from './store/suggestions';

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
    if (!parsed.success) throw new HttpProblem(400, `invalid approve body: ${parsed.error.message}`);
    const edits = parsed.data.edits ?? {};
    const next = structuredClone(current) as unknown as Omit<Suggestion, 'payload'> & { payload: Record<string, unknown> };
    if (edits.title) next.title = edits.title;
    if (edits.clientId) {
      const clients = await this.d.clients();
      if (!clients.some((c) => c.id === edits.clientId && !c.archived)) throw new HttpProblem(400, `unknown client ${edits.clientId}`);
      next.clientId = edits.clientId;
      next.clientConfidence = 'high';
    }
    const merged: Record<string, unknown> = { ...next.payload, ...(edits.payload ?? {}) };
    if (current.kind === 'create_task' && edits.title && edits.payload?.title === undefined) merged.title = edits.title;
    const payload = PAYLOAD_SCHEMAS[current.kind].safeParse(merged);
    if (!payload.success) throw new HttpProblem(400, `invalid edits for ${current.kind}: ${payload.error.message}`);
    next.payload = payload.data as Record<string, unknown>;
    if (current.kind === 'confirm_client') {
      const cands = (next.payload.candidateClientIds as string[]) ?? [];
      const chosen = edits.clientId ?? (cands.length === 1 ? cands[0]! : null);
      if (!chosen) throw new HttpProblem(400, 'pick a client: edits.clientId is required when there is not exactly one candidate');
      if (!edits.clientId) {
        const clients = await this.d.clients();
        if (!clients.some((c) => c.id === chosen && !c.archived)) throw new HttpProblem(400, `unknown client ${chosen}`);
      }
      next.clientId = chosen;
      next.clientConfidence = 'high';
    }
    if (current.kind === 'create_task' && !next.clientId) throw new HttpProblem(400, 'this task has no client yet: pass edits.clientId');
    const valid = Suggestion.safeParse(next);
    if (!valid.success) throw new HttpProblem(400, `invalid edits: ${valid.error.message}`);
    return valid.data;
  }

  async approve(id: string, body: unknown): Promise<Suggestion> {
    const current = this.d.store.get(id);
    if (!current) throw new HttpProblem(404, `no suggestion ${id}`);
    if (current.status !== 'pending' && current.status !== 'failed') throw new HttpProblem(409, `suggestion is already ${current.status}`);
    const edited = await this.applyEdits(current, body);
    try {
      this.d.store.claim(id, ['pending', 'failed'], 'approved');
    } catch (err) {
      if (err instanceof SuggestionConflictError) throw new HttpProblem(409, err.message);
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
    if (!current) throw new HttpProblem(404, `no suggestion ${id}`);
    try {
      this.d.store.claim(id, ['pending', 'failed'], 'denied');
    } catch (err) {
      if (err instanceof SuggestionConflictError) throw new HttpProblem(409, err.message);
      throw err;
    }
    const denied = await this.d.store.update(id, (s) => ({ ...s, status: 'denied', decidedAt: this.d.config.clock.now().toISOString() }));
    this.d.registry.emit('onSuggestionDenied', { suggestion: denied });
    return denied;
  }
}

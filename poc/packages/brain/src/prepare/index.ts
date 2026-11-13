/**
 * Phase 2B: prepared work for the four task types plus "other", meeting
 * slots, and the one next step. See src/MODULES.md ("2B").
 *
 * - An approved create_task starts preparation in the background.
 * - GET  /api/tasks/:id/prepared  -> PreparedResponse (+ `error`); a task never
 *   prepared (status "none") starts preparing on first open.
 * - POST /api/tasks/:id/prepare   -> 202 + PreparedResponse; regenerates.
 * - Approving the prepared suggestion goes through the normal approve path
 *   (core send_reply / complete_task executors; no override). Once it is
 *   applied, ONE next-step suggestion (source `next_step`) is proposed.
 */
import { HttpProblem } from '../httpProblem';
import type { BrainModule, ModuleContext } from '../modules/types';
import { sendJson } from '../server';
import { PrepareService } from './service';

export interface PrepareModule extends BrainModule {
  /** Resolves when background preparation (including route-started runs) is done. For tests. */
  idle(): Promise<void>;
  service(): PrepareService | null;
}

export function createPrepareModule(): PrepareModule {
  let ctx: ModuleContext | null = null;
  let svc: PrepareService | null = null;

  const taskExists = async (id: string): Promise<boolean> => {
    if (ctx!.taskMeta.get(id)) return true;
    const { tasks } = await ctx!.read.pm.listTasks({ includeDone: true });
    return tasks.some((t) => t.id === id);
  };

  return {
    name: 'prepare',

    async init(c) {
      ctx = c;
      svc = new PrepareService(c);
      await svc.load();
      c.routes.add('GET', '/api/tasks/:id/prepared', async ({ res, params }) => {
        const id = params.id!;
        if (!(await taskExists(id))) throw new HttpProblem(404, `no task ${id}`);
        const status = c.taskMeta.get(id)?.preparedStatus ?? 'none';
        if (status === 'none') {
          const { tasks } = await c.read.pm.listTasks({});
          if (tasks.some((t) => t.id === id)) {
            svc!.startPrepare(id);
            // startPrepare marks it preparing before its first await completes; report that.
            sendJson(res, 200, { ...svc!.response(id), status: 'preparing' });
            return;
          }
        }
        sendJson(res, 200, svc!.response(id));
      });
      c.routes.add('POST', '/api/tasks/:id/prepare', async ({ res, params }) => {
        const id = params.id!;
        const { tasks } = await c.read.pm.listTasks({});
        if (!tasks.some((t) => t.id === id)) throw new HttpProblem(404, `no open task ${id}`);
        svc!.startPrepare(id);
        sendJson(res, 202, { ...svc!.response(id), status: 'preparing', error: null });
      });
    },

    async onSuggestionApplied({ suggestion, result }) {
      if (!svc) return;
      if (suggestion.kind === 'create_task' && result.taskIds?.[0]) {
        await svc.prepare(result.taskIds[0]);
        return;
      }
      if (suggestion.kind === 'send_reply' || suggestion.kind === 'complete_task') await svc.proposeNextStep(suggestion);
    },

    async onTasksChanged({ tasks, reason }) {
      if (!svc || !ctx || reason !== 'startup') return;
      // A run cut off by a restart would otherwise stay "preparing" forever.
      for (const t of tasks) if (ctx.taskMeta.get(t.id)?.preparedStatus === 'preparing') await svc.prepare(t.id);
    },

    idle: () => svc?.idle() ?? Promise.resolve(),
    service: () => svc,
  };
}

export const prepareModule: PrepareModule = createPrepareModule();

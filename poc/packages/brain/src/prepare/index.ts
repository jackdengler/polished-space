/**
 * Phase 2B: prepared work for the four task types plus "other", meeting slots,
 * next step. STUB: its routes answer 501. See src/MODULES.md ("2B").
 */
import { notImplemented } from '../modules/stub';
import type { BrainModule } from '../modules/types';

export const prepareModule: BrainModule = {
  name: 'prepare',
  init(ctx) {
    ctx.routes.add('GET', '/api/tasks/:id/prepared', ({ res }) => notImplemented(res, 'Prepared work'));
    ctx.routes.add('POST', '/api/tasks/:id/prepare', ({ res }) => notImplemented(res, 'Prepared work'));
  },
};

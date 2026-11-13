/**
 * Phase 2C: client profiles (apply edits, change log, shorthand learning,
 * profile endpoints). STUB: its routes answer 501. See src/MODULES.md ("2C").
 */
import { PATHS } from '@poc/contracts';
import { notImplemented } from '../modules/stub';
import type { BrainModule } from '../modules/types';

export const profilesModule: BrainModule = {
  name: 'profiles',
  init(ctx) {
    ctx.routes.add('GET', PATHS.brain.profiles, ({ res }) => notImplemented(res, 'Client profiles'));
    ctx.routes.add('GET', '/api/profiles/:clientId', ({ res }) => notImplemented(res, 'Client profiles'));
  },
};

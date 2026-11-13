/**
 * Phase 2D: streaming chat and live voice. STUB: POST /api/chat answers 501
 * and WS /api/voice is refused with 501. See src/MODULES.md ("2D").
 */
import { PATHS } from '@poc/contracts';
import { notImplemented, upgradeNotImplemented } from '../modules/stub';
import type { BrainModule } from '../modules/types';

export const chatModule: BrainModule = {
  name: 'chat',
  init(ctx) {
    ctx.routes.add('POST', PATHS.brain.chat, ({ res }) => notImplemented(res, 'Chat'));
    ctx.upgrades.add(PATHS.brain.voice, (_req, socket) => upgradeNotImplemented(socket, 'Voice'));
  },
};

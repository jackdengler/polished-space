/**
 * The brain's modules, one per Phase 2 builder. Each lives in its own folder
 * and exports one BrainModule from that folder's index.ts; this list already
 * names all four, so no builder needs to edit it.
 */
import { chatModule } from '../chat';
import { prepareModule } from '../prepare';
import { prioritiseModule } from '../prioritise';
import { profilesModule } from '../profiles';
import type { BrainModule } from './types';

export const MODULES: BrainModule[] = [profilesModule, prioritiseModule, prepareModule, chatModule];

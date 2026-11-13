/**
 * The brain's modules. Module objects keep the context `init` gave them, so
 * one object can serve only one brain: `createModules()` returns FRESH
 * instances every call. The production entry point and every test that
 * starts a brain call it once per brain. There are deliberately no shared
 * module singletons to import.
 */
import { createChatModule } from '../chat';
import { createPrepareModule } from '../prepare';
import { createPrioritiseModule } from '../prioritise';
import { createProfilesModule } from '../profiles';
import type { BrainModule } from './types';

export function createModules(): BrainModule[] {
  return [createProfilesModule(), createPrioritiseModule(), createPrepareModule(), createChatModule()];
}

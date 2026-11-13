import { parseWorkspace, type Workspace } from './model/schema';

/**
 * Optional data built into a hosted copy of the app (see scripts/build-artifact.mjs,
 * SEED=path). The repository never contains real data: the seed is injected only
 * into the generated single-file page.
 */
export interface Seed { workspace: Workspace; logos: Record<string, string> }

declare global { interface Window { __COMPENSIAN_SEED__?: unknown } }

export function readSeed(): Seed | null {
  const raw = window.__COMPENSIAN_SEED__;
  if (!raw || typeof raw !== 'object') return null;
  try {
    const { workspace, logos } = raw as { workspace: unknown; logos?: Record<string, string> };
    return { workspace: parseWorkspace(workspace), logos: logos ?? {} };
  } catch (e) {
    console.error('Built-in data is invalid:', e);
    return null;
  }
}

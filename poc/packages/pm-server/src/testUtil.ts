/** Test helpers: a temporary sandbox data folder holding the real seeded workspace. */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SANDBOX_MARKER } from '@poc/contracts';
import { parseWorkspace, type Workspace } from '../../../../src/model/schema';
import { buildWorkspace } from '../../../seed/src/workspace';

export const TODAY = '2026-11-13';

/** The seed's workspace (with the four client fields), validated by Planr's own schema. */
export function seededWorkspace(): Workspace {
  return parseWorkspace(JSON.parse(JSON.stringify(buildWorkspace(TODAY, `${TODAY}T09:00:00.000Z`))));
}

/** A fresh `<dataDir>/pm` with workspace.json and (unless `marker: false`) the sandbox marker. */
export async function makeDataDir(opts: { marker?: boolean } = {}): Promise<string> {
  const dataDir = await mkdtemp(join(tmpdir(), 'pm-server-test-'));
  const pm = join(dataDir, 'pm');
  await mkdir(pm, { recursive: true });
  await writeFile(join(pm, 'workspace.json'), JSON.stringify(buildWorkspace(TODAY, `${TODAY}T09:00:00.000Z`), null, 2));
  if (opts.marker !== false) await writeFile(join(pm, SANDBOX_MARKER), 'test sandbox\n');
  return dataDir;
}

/**
 * Build the whole seed in memory, then write it to a data folder.
 * `buildSeed` is pure (given now and tz), so tests can check it directly.
 */
import { cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DATA_LAYOUT,
  SANDBOX_MARKER,
  localDate,
  profileSlug,
  type CalEvent,
  type CannedMessage,
  type GraphMessage,
  type SeedInfo,
  type ZoomChatMessage,
} from '@poc/contracts';
import { buildCalendar } from './calendar';
import { buildPdfs, buildProfiles } from './content';
import { buildCanned, buildChat, buildInbox, buildSent } from './messages';
import { INTERNAL, ME } from './people';
import { buildWorkspace, type SeedWorkspace } from './workspace';

export const SEED_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
/** Committed text files for the fake file server. */
export const SEED_FILES_DIR = join(SEED_DIR, 'files');
/** Default output: poc/data. */
export const DEFAULT_DATA_DIR = join(SEED_DIR, '..', 'data');

export interface Seed {
  info: SeedInfo;
  workspace: SeedWorkspace;
  mail: GraphMessage[];
  sent: GraphMessage[];
  calendar: CalEvent[];
  chat: ZoomChatMessage[];
  canned: CannedMessage[];
  pdfs: Record<string, Uint8Array>;
  profiles: { slug: string; markdown: string }[];
}

export function buildSeed(now: Date, tz: string, seededAt: Date = new Date()): Seed {
  const nowIso = now.toISOString();
  return {
    info: {
      seededAt: seededAt.toISOString(),
      now: nowIso,
      tz,
      me: { id: ME.id, name: ME.name, email: ME.email },
      internalClientId: INTERNAL.id,
      intakeCursor: nowIso,
    },
    workspace: buildWorkspace(localDate(now, tz), nowIso),
    mail: buildInbox(now),
    sent: buildSent(now),
    calendar: buildCalendar(now, tz),
    chat: buildChat(now),
    canned: buildCanned(),
    pdfs: buildPdfs(),
    profiles: buildProfiles(nowIso).map((p) => ({ slug: profileSlug(p.client.name), markdown: p.markdown })),
  };
}

const MARKER_TEXT = 'POC sandbox data. Invented test data only. pm-server refuses to start without this file.\n';

/**
 * Refuse to wipe a folder that does not look like ours: it must be missing,
 * empty, or already hold a seed-info.json or the sandbox marker.
 */
async function assertSafeToReplace(dataDir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dataDir);
  } catch {
    return; // does not exist
  }
  if (entries.length === 0) return;
  const ours = async (p: string) => stat(join(dataDir, p)).then(() => true, () => false);
  if ((await ours(DATA_LAYOUT.seedInfo)) || (await ours(DATA_LAYOUT.pmMarker))) return;
  throw new Error(`Refusing to replace ${dataDir}: it is not empty and has no ${DATA_LAYOUT.seedInfo} or pm/${SANDBOX_MARKER}.`);
}

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

/** Replace `dataDir` with a fresh seed. Brain state and logs start empty. */
export async function writeSeed(dataDir: string, seed: Seed): Promise<void> {
  await assertSafeToReplace(dataDir);
  await rm(dataDir, { recursive: true, force: true });
  const p = (rel: string) => join(dataDir, rel);
  const put = async (rel: string, data: string | Uint8Array) => {
    await mkdir(dirname(p(rel)), { recursive: true });
    await writeFile(p(rel), data);
  };

  // Planr test copy
  await put(DATA_LAYOUT.pmWorkspace, json(seed.workspace));
  await put(DATA_LAYOUT.pmMarker, MARKER_TEXT);
  await mkdir(p('pm/logos'), { recursive: true });
  await mkdir(p('pm/personal'), { recursive: true });

  // Mocks: live files, plus pristine copies under mocks/initial/ for /_control/reset.
  const mocks: [string, unknown][] = [
    [DATA_LAYOUT.mocksMail, seed.mail],
    [DATA_LAYOUT.mocksSent, seed.sent],
    [DATA_LAYOUT.mocksCalendar, seed.calendar],
    [DATA_LAYOUT.mocksChat, seed.chat],
  ];
  for (const [rel, data] of mocks) {
    await put(rel, json(data));
    await put(rel.replace('mocks/', 'mocks/initial/'), json(data));
  }
  await put(DATA_LAYOUT.mocksCanned, json(seed.canned));

  // Fake file server
  await cp(SEED_FILES_DIR, p(DATA_LAYOUT.files), { recursive: true });
  for (const [rel, bytes] of Object.entries(seed.pdfs)) await put(join(DATA_LAYOUT.files, rel), bytes);

  // Client profiles
  for (const prof of seed.profiles) await put(join(DATA_LAYOUT.profiles, `${prof.slug}.md`), prof.markdown);

  // Empty brain state and logs
  await mkdir(p('brain'), { recursive: true });
  await mkdir(p('logs'), { recursive: true });

  await put(DATA_LAYOUT.seedInfo, json(seed.info));
}

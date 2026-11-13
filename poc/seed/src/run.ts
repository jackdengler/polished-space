/**
 * `npm --prefix poc run seed` (from the repo root) or `npm run seed` (in poc/).
 *
 * Env:
 *   POC_NOW       fix the clock (ISO 8601), default: the real clock
 *   POC_TZ        IANA zone for the working day, default: UTC
 *   POC_DATA_DIR  output folder, default: poc/data
 *
 * Replaces the data folder with a fresh seed (it refuses to wipe a folder
 * that does not look like a POC data folder).
 */
import { resolve } from 'node:path';
import { DEFAULT_TZ, ENV, resolveNow } from '@poc/contracts';
import { DEFAULT_DATA_DIR, buildSeed, writeSeed } from './build';

const now = resolveNow(process.env[ENV.now]);
const tz = process.env[ENV.tz] || DEFAULT_TZ;
const dataDir = resolve(process.env[ENV.dataDir] || DEFAULT_DATA_DIR);

const seed = buildSeed(now, tz);
await writeSeed(dataDir, seed);
console.log(
  `Seeded ${dataDir}\n  now ${seed.info.now} (${tz})\n  ${seed.workspace.clients.length} clients, ${seed.mail.length} emails, ${seed.chat.length} chats, ${seed.calendar.length} events, ${seed.profiles.length} profiles, ${seed.canned.length} canned demo messages`,
);

/**
 * Start the mocks service on PORTS.mocks (8090).
 *
 *   POC_DATA_DIR  data folder (default poc/data); needs a seed (`npm --prefix poc run seed`)
 *   POC_NOW       fixes the clock (ISO 8601), else the real clock
 *   POC_TZ        IANA zone of the working day (default UTC)
 *   MOCKS_HOST    listen address (default 0.0.0.0, needed inside the container)
 */
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { DEFAULT_TZ, ENV, PORTS, resolveNow } from '@poc/contracts';
import { createApp } from './app';

const DEFAULT_DATA_DIR = fileURLToPath(new URL('../../../data', import.meta.url));

const dataDir = process.env[ENV.dataDir] || DEFAULT_DATA_DIR;
const pocNow = process.env[ENV.now] || undefined;
resolveNow(pocNow); // fail fast on a bad POC_NOW
const tz = process.env[ENV.tz] || DEFAULT_TZ;
const host = process.env.MOCKS_HOST || '0.0.0.0';

const app = createApp({ dataDir, tz, now: () => resolveNow(pocNow) });
createServer(app).listen(PORTS.mocks, host, () => {
  console.log(`mocks: listening on http://${host}:${PORTS.mocks} (data ${dataDir}, now ${pocNow ?? 'real clock'}, tz ${tz})`);
});

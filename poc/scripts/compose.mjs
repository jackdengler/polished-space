// One-command run WITH Docker (the isolated sandbox).
//
//   npm --prefix poc run up      # seed if needed, build the images, start, wait until healthy
//   npm --prefix poc run reset   # stop, fresh seed, start
//   npm --prefix poc run down    # stop and remove the containers (data in poc/data stays)
//
// Options (after `--`): --now=<ISO> fixes the sandbox clock (POC_NOW) for seed, brain and mocks.
// The API key is read by compose from poc/.env and passed to the brain only. Never printed.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, POC_DIR, PORTS, readDotEnv, seedWith } from './dev.mjs';

const COMPOSE_FILE = join(POC_DIR, 'docker-compose.yml');
const [cmd = 'up', ...rest] = process.argv.slice(2);
const now = rest.find((a) => a.startsWith('--now='))?.slice(6);

function compose(args, extraEnv = {}) {
  // Never let a developer shell's ANTHROPIC_* leak into compose's variable interpolation.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('ANTHROPIC_')));
  const r = spawnSync('docker', ['compose', '-f', COMPOSE_FILE, ...args], { stdio: 'inherit', env: { ...env, ...extraEnv } });
  if (r.error) throw new Error(`could not run docker: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`docker compose ${args.join(' ')} failed (exit ${r.status})`);
}

async function waitHealthy(timeoutMs = 300_000) {
  const urls = [`http://127.0.0.1:${PORTS.sidebar}/api/health`, `http://127.0.0.1:${PORTS.pm}/api/health`, `http://127.0.0.1:${PORTS.control}/_control/health`];
  const deadline = Date.now() + timeoutMs;
  const pending = new Set(urls);
  while (pending.size && Date.now() < deadline) {
    for (const u of [...pending]) {
      try {
        if ((await fetch(u, { signal: AbortSignal.timeout(2000) })).ok) pending.delete(u);
      } catch {
        /* not yet */
      }
    }
    if (pending.size) await new Promise((r) => setTimeout(r, 1000));
  }
  if (pending.size) throw new Error(`not healthy: ${[...pending].join(', ')} (see: docker compose -f poc/docker-compose.yml logs)`);
}

try {
  const docker = spawnSync('docker', ['info'], { stdio: 'ignore' });
  if (docker.error || docker.status !== 0) throw new Error('Docker is not running (docker info failed). Start Docker Desktop, or use the no-Docker path: npm --prefix poc run dev:up');
  if (cmd === 'down') {
    compose(['down']);
    process.exit(0);
  }
  if (cmd !== 'up' && cmd !== 'reset') throw new Error(`unknown command ${cmd} (up | reset | down)`);
  const dot = readDotEnv();
  if (!existsSync(join(POC_DIR, '.env')) || !dot.ANTHROPIC_API_KEY) console.warn('[compose] no ANTHROPIC_API_KEY in poc/.env: the sandbox starts, but every Claude call will fail. See poc/README.md.');
  const tz = process.env.POC_TZ ?? dot.POC_TZ ?? 'UTC';
  const fixedNow = now ?? process.env.POC_NOW ?? dot.POC_NOW ?? '';
  if (cmd === 'reset') compose(['down']);
  if (cmd === 'reset' || !existsSync(join(DATA_DIR, 'seed-info.json'))) {
    console.log('[compose] seeding poc/data ...');
    console.log(seedWith(fixedNow || undefined, tz).split('\n')[0]);
  }
  compose(['up', '-d', '--build'], { POC_TZ: tz, ...(fixedNow ? { POC_NOW: fixedNow } : {}) });
  console.log('[compose] waiting for health checks ...');
  await waitHealthy();
  console.log(`
  POC sandbox is running (Docker; only the gateway can reach the internet, and only api.anthropic.com)

    Sidebar          http://localhost:${PORTS.sidebar}
    Planr test copy  http://localhost:${PORTS.pm}/?storage=server
    Control page     http://localhost:${PORTS.control}

  Check the isolation on this laptop:  sh poc/scripts/check-isolation.sh
  Stop:                                npm --prefix poc run down
`);
} catch (err) {
  console.error(`[compose] ${err.message}`);
  process.exit(1);
}

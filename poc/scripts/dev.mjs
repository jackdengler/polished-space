// Run the whole POC as plain local processes, WITHOUT Docker.
//
//   npm --prefix poc run dev:up                  # seed if needed, build, start, wait for health (Ctrl+C stops)
//   npm --prefix poc run dev:up -- --detach      # same, then return; stop with dev:down
//   npm --prefix poc run dev:reset               # stop, fresh seed, start (detached)
//   npm --prefix poc run dev:down                # stop what dev:up started (by PID)
//
// Options (after `--`):
//   --detach            run in the background (PIDs in poc/data/run/pids.json)
//   --reset             fresh seed before starting
//   --now=<ISO>         fix the sandbox clock (POC_NOW) for seed, brain and mocks
//   --skip-build        do not rebuild Planr and the sidebar (they must exist)
//   --claude-standin    use the SCRIPTED TEST STAND-IN for Claude (poc/e2e/claude-standin.mjs)
//                       instead of the real API. Never the default.
//
// Same host ports as Docker, loopback only: 5180 sidebar + /api, 5181 Planr test copy,
// 5182 control page. The services use their internal ports on 127.0.0.1 (pm 8080/8081,
// mocks 8090, speech 7100, brain 7000).
//
// Claude: the brain reads ONLY POC_CLAUDE_BASE_URL (default https://api.anthropic.com)
// and ANTHROPIC_API_KEY, both set here explicitly from poc/.env or the environment.
// Any other ANTHROPIC_* variable in this shell is removed from every service's
// environment, so a value from another tool can never redirect POC traffic.
// The key is never printed. There is NO network isolation in this mode (Docker only).
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const POC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_DIR = resolve(POC_DIR, '..');
export const DATA_DIR = join(POC_DIR, 'data');
const RUN_DIR = join(DATA_DIR, 'run');
const PID_FILE = join(RUN_DIR, 'pids.json');
const SIDEBAR_DIR = join(POC_DIR, 'packages/sidebar');

export const PORTS = { pmApp: 8080, pmMcp: 8081, mocks: 8090, speech: 7100, brain: 7000, sidebar: 5180, pm: 5181, control: 5182 };
export const PUBLIC_CLAUDE_URL = 'https://api.anthropic.com';
/** Where `--claude-standin` runs the scripted stand-in (its own process, loopback only). */
const STANDIN_PORT = 7999;

const HEALTH = [
  ['speech', `http://127.0.0.1:${PORTS.speech}/health`],
  ['pm', `http://127.0.0.1:${PORTS.pmApp}/api/health`],
  ['mocks', `http://127.0.0.1:${PORTS.mocks}/_control/health`],
  ['brain', `http://127.0.0.1:${PORTS.brain}/api/health`],
  ['gateway (sidebar)', `http://127.0.0.1:${PORTS.sidebar}/api/health`],
  ['gateway (Planr)', `http://127.0.0.1:${PORTS.pm}/api/health`],
  ['gateway (control page)', `http://127.0.0.1:${PORTS.control}/_control/health`],
];

/** Read poc/.env (KEY=VALUE lines). Values are never printed. */
export function readDotEnv(file = join(POC_DIR, '.env')) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/** The environment a service starts with: this shell minus every ANTHROPIC_* and NODE_OPTIONS, plus `extra`. */
export function serviceEnv(extra) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('ANTHROPIC_') || k === 'NODE_OPTIONS' || k === 'POC_CLAUDE_BASE_URL') continue;
    env[k] = v;
  }
  return { ...env, ...extra };
}

function portInUse(port) {
  return new Promise((r) => {
    const s = connect(port, '127.0.0.1');
    s.once('connect', () => (s.destroy(), r(true)));
    s.once('error', () => r(false));
  });
}

async function waitHealthy(timeoutMs, procs, extra = []) {
  const deadline = Date.now() + timeoutMs;
  const pending = new Map([...extra, ...HEALTH]);
  while (pending.size && Date.now() < deadline) {
    for (const p of procs) if (p.exitCode !== null) throw new Error(`${p.name} exited early (code ${p.exitCode}); see ${p.logFile}`);
    for (const [name, url] of [...pending]) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
        if (r.ok) pending.delete(name);
      } catch {
        /* not yet */
      }
    }
    if (pending.size) await new Promise((r) => setTimeout(r, 400));
  }
  if (pending.size) throw new Error(`not healthy after ${Math.round(timeoutMs / 1000)} s: ${[...pending.keys()].join(', ')}`);
}

function run(cmd, args, cwd, what) {
  const r = spawnSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: serviceEnv({}), encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${what} failed:\n${(r.stdout ?? '').slice(-2000)}\n${(r.stderr ?? '').slice(-2000)}`);
}

export function seedWith(now, tz) {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'seed/src/run.ts'], {
    cwd: POC_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: serviceEnv({ POC_DATA_DIR: DATA_DIR, ...(now ? { POC_NOW: now } : {}), ...(tz ? { POC_TZ: tz } : {}) }),
  });
  if (r.status !== 0) throw new Error(`seed failed:\n${r.stdout}\n${r.stderr}`);
  return r.stdout.trim();
}

export function build({ log = console.log } = {}) {
  log('building the Planr test copy (vite build at the repo root) ...');
  run(process.execPath, [join(REPO_DIR, 'node_modules/vite/bin/vite.js'), 'build'], REPO_DIR, 'Planr build');
  if (!existsSync(join(REPO_DIR, 'dist/index.html'))) throw new Error('Planr build produced no dist/index.html');
  log('building the sidebar (vite build) ...');
  run(process.execPath, [join(POC_DIR, 'node_modules/vite/bin/vite.js'), 'build'], SIDEBAR_DIR, 'sidebar build');
  const html = readFileSync(join(SIDEBAR_DIR, 'dist/index.html'), 'utf8');
  // Cheap structure guard (tasks/lessons.md): the built page must load its script and stylesheet.
  if (!/<script[^>]+type="module"[^>]+src="\/assets\//.test(html) || !/<link[^>]+rel="stylesheet"[^>]+href="\/assets\//.test(html)) throw new Error('sidebar dist/index.html does not reference its assets as expected');
}

/**
 * Start everything. Returns { procs, stop(), claudeBaseUrl, logDir }.
 * opts: { detach, reset, now, tz, skipBuild, claudeBaseUrl, apiKey, netwatchDir, log, healthTimeoutMs }
 */
export async function startStack(opts = {}) {
  const log = opts.log ?? ((m) => console.log(`[dev] ${m}`));
  const dot = readDotEnv();
  const tz = opts.tz ?? process.env.POC_TZ ?? dot.POC_TZ ?? 'UTC';
  const now = opts.now ?? process.env.POC_NOW ?? dot.POC_NOW ?? '';
  const claudeBaseUrl = opts.claudeBaseUrl ?? dot.POC_CLAUDE_BASE_URL ?? PUBLIC_CLAUDE_URL;
  // The key: explicit option, else poc/.env, else this shell's ANTHROPIC_API_KEY. Never printed.
  const apiKey = opts.apiKey ?? dot.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? '';

  for (const [name, port] of Object.entries(PORTS)) {
    if (await portInUse(port)) throw new Error(`port ${port} (${name}) is already in use. Is the POC already running? Try: npm --prefix poc run dev:down (or down for Docker).`);
  }

  if (opts.reset || !existsSync(join(DATA_DIR, 'seed-info.json'))) {
    log(opts.reset ? 'fresh seed (reset) ...' : 'no seed yet; seeding ...');
    log(seedWith(now || undefined, tz).split('\n')[0]);
  }
  if (!opts.skipBuild) build({ log });
  else if (!existsSync(join(REPO_DIR, 'dist/index.html')) || !existsSync(join(SIDEBAR_DIR, 'dist/index.html'))) throw new Error('--skip-build, but Planr or the sidebar is not built');

  const logDir = join(DATA_DIR, 'logs');
  mkdirSync(logDir, { recursive: true });
  mkdirSync(RUN_DIR, { recursive: true });
  const common = { POC_DATA_DIR: DATA_DIR, POC_TZ: tz, TZ: tz, ...(now ? { POC_NOW: now } : {}) };
  const watch = (name) => (opts.netwatchDir ? { POC_NETWATCH_FILE: join(opts.netwatchDir, `${name}.jsonl`), POC_NETWATCH_NAME: name } : {});
  const preload = opts.netwatchDir ? ['--import', `file://${join(POC_DIR, 'scripts/netwatch.mjs')}`] : [];
  if (opts.netwatchDir) mkdirSync(opts.netwatchDir, { recursive: true });

  const specs = [
    { name: 'speech', args: ['packages/speech/src/main.ts'], env: { SPEECH_HOST: '127.0.0.1', SPEECH_PORT: String(PORTS.speech) } },
    { name: 'pm', args: ['packages/pm-server/src/main.ts'], env: { PM_HOST: '127.0.0.1' } },
    { name: 'mocks', args: ['packages/mocks/src/server.ts'], env: { MOCKS_HOST: '127.0.0.1' } },
    {
      name: 'brain',
      args: ['packages/brain/src/main.ts'],
      env: {
        BRAIN_HOST: '127.0.0.1',
        BRAIN_PORT: String(PORTS.brain),
        PM_MCP_URL: `http://127.0.0.1:${PORTS.pmMcp}/mcp`,
        MOCKS_URL: `http://127.0.0.1:${PORTS.mocks}`,
        SPEECH_URL: `http://127.0.0.1:${PORTS.speech}`,
        POC_CLAUDE_BASE_URL: claudeBaseUrl,
        ...(apiKey ? { ANTHROPIC_API_KEY: apiKey } : {}),
        POC_MAX_USD_PER_DAY: process.env.POC_MAX_USD_PER_DAY ?? dot.POC_MAX_USD_PER_DAY ?? '5',
        ...(opts.brainEnv ?? {}),
      },
    },
    { name: 'gateway', args: ['scripts/gateway.mjs'], env: {}, plain: true },
  ];
  // The scripted stand-in as its own process (only when asked for), so `--claude-standin` works
  // detached too (dev:reset runs in the background like every other reset).
  if (opts.standinPort) specs.unshift({ name: 'claude-standin', args: ['e2e/claude-standin.mjs', String(opts.standinPort)], env: {}, plain: true });

  const procs = [];
  const stop = async () => {
    for (const p of [...procs].reverse()) {
      if (p.exitCode === null) {
        try {
          process.kill(p.pid, 'SIGTERM');
        } catch {
          /* gone */
        }
      }
    }
    const deadline = Date.now() + 8000;
    for (const p of procs) {
      while (p.exitCode === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
      if (p.exitCode === null) {
        try {
          process.kill(p.pid, 'SIGKILL');
        } catch {
          /* gone */
        }
      }
    }
    rmSync(PID_FILE, { force: true });
  };

  try {
    for (const s of specs) {
      const logFile = join(logDir, `${s.name}.log`);
      const fd = openSync(logFile, 'a');
      const nodeArgs = s.plain ? [...preload, ...s.args] : ['--import', 'tsx', ...preload, ...s.args];
      const child = spawn(process.execPath, nodeArgs, {
        cwd: POC_DIR,
        env: serviceEnv({ ...common, ...watch(s.name), ...s.env }),
        stdio: ['ignore', fd, fd],
        detached: !!opts.detach,
      });
      closeSync(fd);
      child.name = s.name;
      child.logFile = logFile;
      child.on('exit', (code) => {
        child.exitCode = code ?? -1;
      });
      if (opts.detach) child.unref();
      procs.push(child);
      log(`started ${s.name} (pid ${child.pid}); log ${logFile}`);
    }
    writeFileSync(PID_FILE, JSON.stringify(procs.map((p) => ({ name: p.name, pid: p.pid })), null, 1));
    await waitHealthy(opts.healthTimeoutMs ?? 120_000, procs, opts.standinPort ? [['claude-standin', `http://127.0.0.1:${opts.standinPort}/health`]] : []);
  } catch (err) {
    await stop();
    throw err;
  }
  log(`all health checks green. Claude: ${claudeBaseUrl === PUBLIC_CLAUDE_URL ? 'the Claude API' : opts.claudeLabel ?? 'POC_CLAUDE_BASE_URL'}${apiKey ? '' : ' (NO API KEY: Claude calls will fail until you add one to poc/.env)'}`);
  return { procs, stop, claudeBaseUrl, logDir };
}

/** Stop the processes listed in the PID file (only those dev:up started). */
export async function stopFromPidFile(log = (m) => console.log(`[dev] ${m}`)) {
  if (!existsSync(PID_FILE)) {
    log('nothing to stop (no PID file).');
    return;
  }
  const list = JSON.parse(readFileSync(PID_FILE, 'utf8'));
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  for (const { name, pid } of [...list].reverse()) {
    if (alive(pid)) {
      process.kill(pid, 'SIGTERM');
      log(`stopping ${name} (pid ${pid})`);
    }
  }
  const deadline = Date.now() + 8000;
  for (const { name, pid } of list) {
    while (alive(pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
    if (alive(pid)) {
      process.kill(pid, 'SIGKILL');
      log(`killed ${name} (pid ${pid})`);
    }
  }
  rmSync(PID_FILE, { force: true });
  log('stopped.');
}

function banner(url) {
  console.log(`
  POC is running (no Docker; no network isolation in this mode)

    Sidebar          http://localhost:${PORTS.sidebar}
    Planr test copy  http://localhost:${PORTS.pm}/?storage=server
    Control page     http://localhost:${PORTS.control}

  Sidebar as a Chrome app window at the right edge (see poc/README.md):
    google-chrome --app=http://localhost:${PORTS.sidebar} --window-size=400,1040 --window-position=<screen width - 400>,0
${url ? `\n  ${url}\n` : ''}`);
}

// ---- CLI -------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd = 'up', ...rest] = process.argv.slice(2);
  const flag = (name) => rest.includes(`--${name}`);
  const value = (name) => rest.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  try {
    if (cmd === 'down') {
      await stopFromPidFile();
      process.exit(0);
    }
    if (cmd !== 'up' && cmd !== 'reset') throw new Error(`unknown command ${cmd} (up | reset | down)`);
    if (cmd === 'reset') await stopFromPidFile();
    const standin = flag('claude-standin');
    if (standin) console.log(`\n  !! Claude is the SCRIPTED TEST STAND-IN (poc/e2e/claude-standin.mjs), not the real API. Answers are canned. !!\n`);
    const detach = flag('detach') || cmd === 'reset';
    const stack = await startStack({
      detach,
      reset: cmd === 'reset' || flag('reset'),
      now: value('now'),
      skipBuild: flag('skip-build'),
      ...(standin ? { standinPort: STANDIN_PORT, claudeBaseUrl: `http://127.0.0.1:${STANDIN_PORT}`, apiKey: 'standin-not-a-real-key', claudeLabel: 'the scripted test stand-in' } : {}),
    });
    banner(standin ? 'Claude: SCRIPTED TEST STAND-IN' : '');
    if (detach) {
      console.log('  Running in the background. Stop with: npm --prefix poc run dev:down\n');
      process.exit(0);
    }
    console.log('  Press Ctrl+C to stop.\n');
    let stopping = false;
    const shutdown = async () => {
      if (stopping) return;
      stopping = true;
      console.log('\n[dev] stopping ...');
      await stack.stop();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    for (const p of stack.procs) p.on('exit', (code) => !stopping && console.log(`[dev] ${p.name} exited (code ${code}); see ${p.logFile}`));
  } catch (err) {
    console.error(`[dev] ${err.message}`);
    process.exit(1);
  }
}

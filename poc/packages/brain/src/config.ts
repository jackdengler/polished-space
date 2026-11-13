/**
 * Brain configuration, read once from the environment at start-up.
 * Ports, URLs and env names come from @poc/contracts so nothing drifts.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_LAYOUT, DEFAULT_TZ, DEFAULT_URLS, ENV, PORTS, SeedInfo, localDate, resolveNow } from '@poc/contracts';

export interface Clock {
  /** Current instant (POC_NOW-based when set, else the real clock). */
  now(): Date;
  /** Local date (`YYYY-MM-DD`) of now() in the configured zone. */
  today(): string;
  /** Local date of any ISO instant. */
  dayOf(iso: string): string;
  tz: string;
}

export interface BrainConfig {
  port: number;
  host: string;
  dataDir: string;
  pmMcpUrl: string;
  mocksUrl: string;
  speechUrl: string;
  /**
   * Where Claude requests go: POC_CLAUDE_BASE_URL, else the public API.
   * Always passed to the SDK explicitly, so an ambient ANTHROPIC_BASE_URL
   * (from another tool in the same shell) can never redirect the brain.
   */
  anthropicBaseUrl: string;
  clock: Clock;
  maxUsdPerDay: number;
  /** Intake poll interval (plan: 2 to 3 seconds). */
  pollMs: number;
  /** Server-side refusal fallbacks on Sonnet/Opus calls (POC_CLAUDE_FALLBACKS=0 turns them off). */
  claudeFallbacks: boolean;
  me: { id: string; name: string; email: string };
  internalClientId: string | null;
  /** Where mail and chat intake start when no cursor is stored yet. */
  intakeCursor: string;
  /**
   * Triage proposes a due date for every task the user owes (a reply someone
   * is waiting on defaults to today). POC_TRIAGE_DUE_DATES=0 switches it off
   * (tasks with no stated date then stay undated, in Inbox). Default on.
   */
  proposeDueDates?: boolean;
}

/** The default Claude endpoint when POC_CLAUDE_BASE_URL is not set. */
export const PUBLIC_CLAUDE_URL = 'https://api.anthropic.com';

/** poc/data, resolved from this file (poc/packages/brain/src/config.ts). */
export const LOCAL_DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data');

/**
 * A clock. With POC_NOW set it starts at that instant and then advances in
 * real time, so a demo started "at 13:47" keeps moving (the seed's calendar is
 * built around that instant). Tests pass a fixed function instead.
 */
export function makeClock(tz: string, pocNow?: string | null, fixed?: () => Date): Clock {
  let now: () => Date;
  if (fixed) now = fixed;
  else if (pocNow) {
    const start = resolveNow(pocNow).getTime();
    const realStart = Date.now();
    now = () => new Date(start + (Date.now() - realStart));
  } else now = () => new Date();
  return {
    now,
    today: () => localDate(now(), tz),
    dayOf: (iso: string) => localDate(new Date(iso), tz),
    tz,
  };
}

function readSeedInfo(dataDir: string): SeedInfo | null {
  try {
    return SeedInfo.parse(JSON.parse(readFileSync(join(dataDir, DATA_LAYOUT.seedInfo), 'utf8')));
  } catch {
    return null;
  }
}

function num(v: string | undefined, fallback: number): number {
  if (v === undefined || v.trim() === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`expected a non-negative number, got ${v}`);
  return n;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BrainConfig {
  const dataDir = resolve(env[ENV.dataDir] || LOCAL_DATA_DIR);
  const seed = readSeedInfo(dataDir);
  const tz = env[ENV.tz] || seed?.tz || DEFAULT_TZ;
  const clock = makeClock(tz, env[ENV.now]);
  return {
    port: num(env.BRAIN_PORT, PORTS.brain),
    host: env.BRAIN_HOST || '0.0.0.0',
    dataDir,
    pmMcpUrl: env[ENV.pmMcpUrl] || DEFAULT_URLS.pmMcp,
    mocksUrl: env[ENV.mocksUrl] || DEFAULT_URLS.mocks,
    speechUrl: env[ENV.speechUrl] || DEFAULT_URLS.speech,
    anthropicBaseUrl: env[ENV.claudeBaseUrl] || PUBLIC_CLAUDE_URL,
    clock,
    maxUsdPerDay: num(env[ENV.maxUsdPerDay], 5),
    pollMs: num(env.POC_POLL_MS, 2500),
    claudeFallbacks: env.POC_CLAUDE_FALLBACKS !== '0',
    proposeDueDates: env.POC_TRIAGE_DUE_DATES !== '0',
    me: seed?.me ?? { id: 'poc-member-alex', name: 'Alex Rivera', email: 'alex.rivera@brightline-advisory.example' },
    internalClientId: seed?.internalClientId ?? null,
    intakeCursor: seed?.intakeCursor ?? clock.now().toISOString(),
  };
}

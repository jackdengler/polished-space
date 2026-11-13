/**
 * The ONLY file that names Claude models (plan section 5), plus the single
 * price table used for the usage log and the daily spend cap.
 *
 * Prices: US dollars per million tokens, Anthropic first-party rates as listed
 * in the claude-api skill (cached 2026-11-03). Re-check against the live
 * pricing page before relying on cost figures.
 */
import type { ClaudeCall } from '@poc/contracts';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ThinkingMode = 'adaptive' | 'disabled' | 'between_tools';

/** Which model each call type uses. */
export const MODELS: Record<ClaudeCall, string> = {
  triage: 'claude-sonnet-5-5',
  prioritise: 'claude-sonnet-5-5',
  profile: 'claude-sonnet-5-5',
  prepare: 'claude-opus-5-5',
  chat: 'claude-haiku-5-5',
};

/** Effort per call type. Always sent explicitly, because defaults differ by model. */
export const DEFAULT_EFFORT: Record<ClaudeCall, Effort> = {
  triage: 'low',
  prioritise: 'low',
  profile: 'low',
  prepare: 'medium',
  chat: 'low',
};

export interface ModelInfo {
  /** Input $/MTok (prompts up to `longPromptThreshold` tokens). */
  input: number;
  output: number;
  /** Cache read $/MTok. */
  cacheRead: number;
  /** Prompts above this many input tokens bill at the long rates (Haiku 5.5 only). */
  longPromptThreshold?: number;
  longInput?: number;
  longOutput?: number;
  /** Supports server-side refusal fallbacks (`fallbacks: "default"`). Haiku 5.5 has none. */
  serverFallbacks: boolean;
  /** Thinking modes the model accepts (`disabled` / `between_tools` only at effort high or below). */
  thinking: readonly ThinkingMode[];
}

/**
 * The price table. Includes the models a server-side fallback may route to, so
 * a fallback response (whose `model` differs from the request) is priced right.
 */
export const MODEL_INFO: Record<string, ModelInfo> = {
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, serverFallbacks: true, thinking: ['adaptive', 'between_tools'] },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, serverFallbacks: true, thinking: ['adaptive'] },
  'claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    longPromptThreshold: 100_000,
    longInput: 0.5,
    longOutput: 2.5,
    serverFallbacks: false,
    thinking: ['adaptive', 'disabled'],
  },
  // Possible server-side fallback targets.
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, serverFallbacks: false, thinking: ['adaptive', 'disabled'] },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, serverFallbacks: false, thinking: ['adaptive', 'disabled'] },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, serverFallbacks: false, thinking: ['adaptive', 'disabled'] },
};

/** Cache write multipliers on the input price, by TTL. */
export const CACHE_WRITE_MULTIPLIER = { '5m': 1.25, '1h': 2 } as const;

/** Beta header for server-side refusal fallbacks (`fallbacks: "default"` form). */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

export function modelInfo(model: string): ModelInfo | undefined {
  return MODEL_INFO[model];
}

export interface UsageNumbers {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  /** Split of cache writes by TTL when the API reports it. */
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } | null;
}

/**
 * Estimated cost of one call in US dollars. `requestedModel` prices a
 * response from a model missing from the table (the conservative choice is
 * the dearer of the two). `defaultTtl` prices cache writes the API did not split.
 */
export function estimateUsd(model: string, u: UsageNumbers, requestedModel = model, defaultTtl: '5m' | '1h' = '5m'): number {
  const a = MODEL_INFO[model];
  const b = MODEL_INFO[requestedModel];
  const info = a && b ? (a.input >= b.input ? a : b) : (a ?? b);
  if (!info) throw new Error(`no price for model ${model}`);
  const promptTokens = u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens;
  const long = info.longPromptThreshold !== undefined && promptTokens > info.longPromptThreshold;
  const inPrice = long ? info.longInput! : info.input;
  const outPrice = long ? info.longOutput! : info.output;
  const readPrice = long ? info.longInput! * 0.1 : info.cacheRead;
  const split = u.cache_creation;
  const w1h = split?.ephemeral_1h_input_tokens ?? (defaultTtl === '1h' && !split ? u.cache_creation_input_tokens : 0);
  const w5m = split ? (split.ephemeral_5m_input_tokens ?? 0) : u.cache_creation_input_tokens - w1h;
  const usd =
    u.input_tokens * inPrice +
    u.output_tokens * outPrice +
    w5m * inPrice * CACHE_WRITE_MULTIPLIER['5m'] +
    w1h * inPrice * CACHE_WRITE_MULTIPLIER['1h'] +
    u.cache_read_input_tokens * readPrice;
  return usd / 1_000_000;
}

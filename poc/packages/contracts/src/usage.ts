import { z } from 'zod';
import { IsoDate, IsoDateTime } from './common';

/**
 * Token and cost logging (plan section 5). One line per Claude call in
 * `poc/data/logs/usage.jsonl`. Field names follow the Anthropic API's
 * `usage` object so they can be copied straight across.
 */

export const ClaudeCall = z.enum(['triage', 'prioritise', 'prepare', 'chat', 'profile']);
export type ClaudeCall = z.infer<typeof ClaudeCall>;

export const UsageLine = z.object({
  ts: IsoDateTime,
  call: ClaudeCall,
  model: z.string().min(1),
  /** The mail/chat/task id the call was about, or null (e.g. a chat turn). */
  sourceId: z.string().nullable(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  cache_creation_input_tokens: z.number().int().nonnegative(),
  cache_read_input_tokens: z.number().int().nonnegative(),
  /** Wall time of the call in milliseconds. */
  ms: z.number().nonnegative(),
  estUsd: z.number().nonnegative(),
});
export type UsageLine = z.infer<typeof UsageLine>;

export const UsageTotals = z.object({
  calls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationInputTokens: z.number().int().nonnegative(),
  cacheReadInputTokens: z.number().int().nonnegative(),
  estUsd: z.number().nonnegative(),
});
export type UsageTotals = z.infer<typeof UsageTotals>;

/** Totals for one local day, overall and by call type. */
export const UsageSummary = UsageTotals.extend({
  day: IsoDate,
  byCall: z.partialRecord(ClaudeCall, UsageTotals),
});
export type UsageSummary = z.infer<typeof UsageSummary>;

/** `GET /api/usage`: today plus every day in the log, newest first. */
export const UsageResponse = z.object({ today: UsageSummary, days: z.array(UsageSummary) });
export type UsageResponse = z.infer<typeof UsageResponse>;

const emptyTotals = (): UsageTotals => ({ calls: 0, inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, estUsd: 0 });

function add(t: UsageTotals, l: UsageLine): void {
  t.calls += 1;
  t.inputTokens += l.input_tokens;
  t.outputTokens += l.output_tokens;
  t.cacheCreationInputTokens += l.cache_creation_input_tokens;
  t.cacheReadInputTokens += l.cache_read_input_tokens;
  t.estUsd += l.estUsd;
}

/** Sum the lines whose local date (via `dayOf`) is `day`. */
export function summariseUsage(lines: UsageLine[], day: string, dayOf: (ts: string) => string): UsageSummary {
  const summary: UsageSummary = { day, ...emptyTotals(), byCall: {} };
  for (const l of lines) {
    if (dayOf(l.ts) !== day) continue;
    add(summary, l);
    add((summary.byCall[l.call] ??= emptyTotals()), l);
  }
  return summary;
}

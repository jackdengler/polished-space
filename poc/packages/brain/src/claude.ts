/**
 * The ONLY file that talks to the Anthropic SDK (plan section 5).
 *
 * Every call:
 * - uses the model `models.ts` names for its call type, and sets effort explicitly;
 * - is refused before it is sent once today's estimated spend reaches the cap;
 * - appends one line to `data/logs/usage.jsonl`;
 * - checks `stop_reason` before content is read (`refusal` and `max_tokens`
 *   become typed errors, never half-read output);
 * - on Sonnet and Opus, opts into server-side refusal fallbacks (`fallbacks: "default"`).
 *
 * Only the SDK surface FakeClaude implements is used: `messages.create`,
 * `messages.parse` (`parsed_output`), `messages.stream` (async iteration,
 * `finalMessage()`, `abort()`), and the `signal` / `headers` request options.
 * No sampling parameters and no `budget_tokens` are ever sent.
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { ClaudeCall, UsageLine } from '@poc/contracts';
import type { z } from 'zod';
import type { BrainConfig, Clock } from './config';
import { DEFAULT_EFFORT, FALLBACK_BETA, MODELS, estimateUsd, modelInfo, type Effort, type ThinkingMode, type UsageNumbers } from './models';
import type { UsageLog } from './usage';

// ---- the client shape (the real SDK client and FakeClaude both fit) --------

export interface StreamLike extends AsyncIterable<unknown> {
  abort(): void;
  finalMessage(): Promise<unknown>;
}

export interface AnthropicLike {
  messages: {
    create(params: never, options?: never): Promise<unknown>;
    parse(params: never, options?: never): Promise<unknown>;
    stream(params: never, options?: never): StreamLike;
  };
}

/**
 * Builds the real SDK client. The key comes only from the environment
 * (ANTHROPIC_API_KEY, read by the SDK); it is never passed, stored or logged
 * here. Returns null when no credentials are configured, so the brain still
 * starts and every call fails with a clear ClaudeUnavailableError.
 */
export function createAnthropicClient(config: Pick<BrainConfig, 'anthropicBaseUrl'>, env: NodeJS.ProcessEnv = process.env): AnthropicLike | null {
  // The SDK constructs fine without credentials and only fails per request, so check up front.
  if (!env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN && !env.ANTHROPIC_PROFILE) return null;
  try {
    return new Anthropic(config.anthropicBaseUrl ? { baseURL: config.anthropicBaseUrl } : {}) as unknown as AnthropicLike;
  } catch {
    return null;
  }
}

// ---- errors ----------------------------------------------------------------

export class ClaudeError extends Error {
  override name = 'ClaudeError';
}
/** The spend cap for today is reached; nothing was sent. */
export class SpendCapError extends ClaudeError {
  override name = 'SpendCapError';
  constructor(
    readonly spentUsd: number,
    readonly capUsd: number,
  ) {
    super(`Daily Claude spend cap reached ($${spentUsd.toFixed(4)} of $${capUsd.toFixed(2)}); no call made.`);
  }
}
/** Claude declined (stop_reason "refusal"). Content must not be used. */
export class ClaudeRefusalError extends ClaudeError {
  override name = 'ClaudeRefusalError';
  constructor(
    readonly category: string | null,
    readonly explanation: string | null,
  ) {
    super(`Claude declined this request${category ? ` (${category})` : ''}.`);
  }
}
/** Output was cut off (stop_reason "max_tokens" or context window exceeded). */
export class ClaudeMaxTokensError extends ClaudeError {
  override name = 'ClaudeMaxTokensError';
  constructor(readonly stopReason: string) {
    super(`Claude's reply was cut off (${stopReason}).`);
  }
}
/** Structured output missing or invalid. */
export class ClaudeOutputError extends ClaudeError {
  override name = 'ClaudeOutputError';
}
/** No API credentials configured. */
export class ClaudeUnavailableError extends ClaudeError {
  override name = 'ClaudeUnavailableError';
  constructor() {
    super('Claude is not configured (no ANTHROPIC_API_KEY in the environment).');
  }
}
/** Bad request shape caught before sending (e.g. forced tool_choice). */
export class ClaudeRequestError extends ClaudeError {
  override name = 'ClaudeRequestError';
}

export function isAbortError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === 'APIUserAbortError' || name === 'AbortError';
}

// ---- request shape ---------------------------------------------------------

export interface CallMeta {
  call: ClaudeCall;
  /** The mail/chat/task id the call is about (for the usage log). */
  sourceId: string | null;
}

export interface ClaudeRequest {
  system?: string | Anthropic.TextBlockParam[];
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.ToolUnion[];
  /** Only `auto` or `none`; forced tool choice is rejected by the 5.5 models. */
  toolChoice?: Anthropic.ToolChoiceAuto | Anthropic.ToolChoiceNone;
  maxTokens?: number;
  /** Defaults to DEFAULT_EFFORT for the call type. Always sent. */
  effort?: Effort;
  /** Omit for adaptive (the default). `disabled` only on models that accept it. */
  thinking?: ThinkingMode;
  /** Price cache writes the API does not split by TTL at this TTL. Default '5m'. */
  cacheTtl?: '5m' | '1h';
  signal?: AbortSignal;
}

export interface ParsedResult<T> {
  data: T;
  message: Anthropic.Message;
}

type RawUsage = Partial<UsageNumbers> | undefined;

interface StopInfo {
  stop_reason: string | null;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
}

const EFFORT_RANK: Record<Effort, number> = { low: 0, medium: 1, high: 2, xhigh: 3, max: 4 };

export interface ClaudeOptions {
  maxUsdPerDay: number;
  fallbacks: boolean;
  clock: Clock;
}

export class Claude {
  constructor(
    private client: AnthropicLike | null,
    private usage: UsageLog,
    private opts: ClaudeOptions,
  ) {}

  /** Today's estimated spend and the cap. */
  budget(): { spentUsd: number; capUsd: number } {
    return { spentUsd: this.usage.spentToday(), capUsd: this.opts.maxUsdPerDay };
  }

  /** Structured output: `messages.parse` with `output_config.format = zodOutputFormat(schema)`. */
  async parse<S extends z.ZodType>(meta: CallMeta, req: ClaudeRequest, schema: S): Promise<ParsedResult<z.infer<S>>> {
    const { client, params, options, model } = await this.prepare(meta, req, { format: zodOutputFormat(schema as never) });
    const started = performance.now();
    const ts = this.opts.clock.now().toISOString();
    let msg: Anthropic.Message & { parsed_output?: unknown };
    try {
      msg = (await client.messages.parse(params as never, options as never)) as typeof msg;
    } catch (err) {
      await this.log(meta, model, model, undefined, ts, started, req.cacheTtl);
      throw err;
    }
    await this.log(meta, msg.model ?? model, model, msg.usage as RawUsage, ts, started, req.cacheTtl);
    this.checkStop(msg as StopInfo);
    if (msg.parsed_output === null || msg.parsed_output === undefined) throw new ClaudeOutputError('Claude returned no structured output.');
    const checked = (schema as z.ZodType).safeParse(msg.parsed_output);
    if (!checked.success) throw new ClaudeOutputError(`Claude's structured output did not validate: ${checked.error.message}`);
    return { data: checked.data as z.infer<S>, message: msg };
  }

  /** Plain request. Resolves with the message once `stop_reason` is known to be usable (end_turn, tool_use, stop_sequence, pause_turn). */
  async create(meta: CallMeta, req: ClaudeRequest): Promise<Anthropic.Message> {
    const { client, params, options, model } = await this.prepare(meta, req, {});
    const started = performance.now();
    const ts = this.opts.clock.now().toISOString();
    let msg: Anthropic.Message;
    try {
      msg = (await client.messages.create(params as never, options as never)) as Anthropic.Message;
    } catch (err) {
      await this.log(meta, model, model, undefined, ts, started, req.cacheTtl);
      throw err;
    }
    await this.log(meta, msg.model ?? model, model, msg.usage as RawUsage, ts, started, req.cacheTtl);
    this.checkStop(msg as StopInfo);
    return msg;
  }

  /**
   * Streaming request. The spend cap is checked before the stream opens
   * (rejects with SpendCapError). The returned ClaudeStream logs usage when it
   * ends (also when aborted: the tokens seen so far) and its `finalMessage()`
   * rejects on refusal / max_tokens.
   */
  async stream(meta: CallMeta, req: ClaudeRequest): Promise<ClaudeStream> {
    const { client, params, options, model } = await this.prepare(meta, req, {});
    const ts = this.opts.clock.now().toISOString();
    const started = performance.now();
    const inner = client.messages.stream(params as never, options as never);
    return new ClaudeStream(inner, (usage, servedModel) => this.log(meta, servedModel ?? model, model, usage, ts, started, req.cacheTtl), (m) => this.checkStop(m));
  }

  // ---- internals -----------------------------------------------------------

  private async prepare(meta: CallMeta, req: ClaudeRequest, outputExtra: Record<string, unknown>) {
    if (!this.client) throw new ClaudeUnavailableError();
    await this.usage.load();
    const spent = this.usage.spentToday();
    if (spent >= this.opts.maxUsdPerDay) throw new SpendCapError(spent, this.opts.maxUsdPerDay);

    const model = MODELS[meta.call];
    const info = modelInfo(model);
    if (!info) throw new ClaudeRequestError(`no model info for ${model}`);
    const effort = req.effort ?? DEFAULT_EFFORT[meta.call];
    const thinking = req.thinking ?? 'adaptive';
    if (!info.thinking.includes(thinking)) throw new ClaudeRequestError(`thinking "${thinking}" is not accepted by ${model}`);
    if (thinking !== 'adaptive' && EFFORT_RANK[effort] > EFFORT_RANK.high) throw new ClaudeRequestError(`thinking "${thinking}" needs effort high or below`);
    const tc = req.toolChoice as { type?: string } | undefined;
    if (tc && tc.type !== 'auto' && tc.type !== 'none') throw new ClaudeRequestError('forced tool_choice is not supported on these models');

    const fallbacks = this.opts.fallbacks && info.serverFallbacks;
    const params: Record<string, unknown> = {
      model,
      max_tokens: req.maxTokens ?? 16000,
      messages: req.messages,
      output_config: { effort, ...outputExtra },
    };
    if (req.system !== undefined) params.system = req.system;
    if (req.tools?.length) params.tools = req.tools;
    if (req.toolChoice) params.tool_choice = req.toolChoice;
    if (thinking !== 'adaptive') params.thinking = { type: thinking };
    if (fallbacks) params.fallbacks = 'default';
    const options: Record<string, unknown> = {};
    if (req.signal) options.signal = req.signal;
    if (fallbacks) options.headers = { 'anthropic-beta': FALLBACK_BETA };
    return { client: this.client, params, options, model };
  }

  private checkStop(m: StopInfo): void {
    if (m.stop_reason === 'refusal') throw new ClaudeRefusalError(m.stop_details?.category ?? null, m.stop_details?.explanation ?? null);
    if (m.stop_reason === 'max_tokens' || m.stop_reason === 'model_context_window_exceeded') throw new ClaudeMaxTokensError(m.stop_reason);
  }

  private async log(meta: CallMeta, servedModel: string, requestedModel: string, raw: RawUsage, ts: string, started: number, ttl: '5m' | '1h' = '5m'): Promise<void> {
    const u: UsageNumbers = {
      input_tokens: raw?.input_tokens ?? 0,
      output_tokens: raw?.output_tokens ?? 0,
      cache_creation_input_tokens: raw?.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: raw?.cache_read_input_tokens ?? 0,
      cache_creation: raw?.cache_creation ?? null,
    };
    const line: UsageLine = {
      ts,
      call: meta.call,
      model: servedModel,
      sourceId: meta.sourceId,
      input_tokens: u.input_tokens,
      output_tokens: u.output_tokens,
      cache_creation_input_tokens: u.cache_creation_input_tokens,
      cache_read_input_tokens: u.cache_read_input_tokens,
      ms: Math.max(0, Math.round(performance.now() - started)),
      estUsd: estimateUsd(servedModel, u, requestedModel, ttl),
    };
    await this.usage.append(line);
  }
}

/**
 * A streamed reply. Consumes the SDK stream once and fans it out:
 * `on('text')` for text deltas, async iteration for raw events (replayed from
 * the start for each iterator), `finalMessage()` for the checked message.
 */
export class ClaudeStream implements AsyncIterable<Anthropic.RawMessageStreamEvent> {
  private events: Anthropic.RawMessageStreamEvent[] = [];
  private ended = false;
  private wakers: (() => void)[] = [];
  private textListeners: ((delta: string, snapshot: string) => void)[] = [];
  private snapshot = '';
  private usage: Partial<UsageNumbers> = {};
  private servedModel: string | undefined;
  private final: Promise<Anthropic.Message>;

  constructor(
    private inner: StreamLike,
    log: (usage: RawUsage, servedModel: string | undefined) => Promise<void>,
    check: (m: StopInfo) => void,
  ) {
    this.final = this.run(log, check);
    this.final.catch(() => {});
  }

  /** Text received so far. */
  get text(): string {
    return this.snapshot;
  }

  on(event: 'text', listener: (delta: string, snapshot: string) => void): this {
    if (event === 'text') this.textListeners.push(listener);
    return this;
  }

  abort(): void {
    this.inner.abort();
  }

  /** The full message, after usage is logged. Rejects on refusal, max_tokens, abort or API error. */
  finalMessage(): Promise<Anthropic.Message> {
    return this.final;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Anthropic.RawMessageStreamEvent> {
    let i = 0;
    while (true) {
      if (i < this.events.length) {
        yield this.events[i++]!;
        continue;
      }
      if (this.ended) return;
      await new Promise<void>((r) => this.wakers.push(r));
    }
  }

  private wake() {
    const w = this.wakers;
    this.wakers = [];
    for (const f of w) f();
  }

  private record(ev: Anthropic.RawMessageStreamEvent) {
    if (ev.type === 'message_start') {
      this.servedModel = ev.message.model;
      const u = ev.message.usage as Partial<UsageNumbers>;
      this.usage = { ...u, output_tokens: u.output_tokens ?? 0 };
    } else if (ev.type === 'message_delta') {
      const u = ev.usage as Partial<UsageNumbers>;
      if (typeof u.output_tokens === 'number') this.usage.output_tokens = u.output_tokens;
    } else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
      this.snapshot += ev.delta.text;
      for (const l of this.textListeners) l(ev.delta.text, this.snapshot);
    }
    this.events.push(ev);
    this.wake();
  }

  private async run(log: (usage: RawUsage, servedModel: string | undefined) => Promise<void>, check: (m: StopInfo) => void): Promise<Anthropic.Message> {
    let msg: Anthropic.Message;
    try {
      for await (const ev of this.inner) this.record(ev as Anthropic.RawMessageStreamEvent);
      msg = (await this.inner.finalMessage()) as Anthropic.Message;
    } catch (err) {
      this.ended = true;
      this.wake();
      await log(this.usage, this.servedModel).catch(() => {});
      throw err;
    }
    this.ended = true;
    this.wake();
    await log(msg.usage as RawUsage, msg.model ?? this.servedModel);
    check(msg as StopInfo);
    return msg;
  }
}

/**
 * FakeClaude: a scriptable stand-in for the parts of the Anthropic SDK client
 * the brain uses: `messages.create`, `messages.parse` and `messages.stream`.
 * No network. Every call is recorded with its params, and every reply carries
 * usage numbers so the usage log can be tested.
 *
 *   const claude = new FakeClaude();
 *   claude.enqueue({ parsed: { clientId: 'poc-client-acme', ... } });   // next call
 *   claude.enqueue({ text: 'Sure, here is the plan.', chunkDelayMs: 5 }); // the one after
 *   claude.setDefault((params) => ({ text: 'ok' }));                  // when the queue is empty
 *   // pass `claude` wherever the brain takes an Anthropic client
 *   expect(claude.calls).toHaveLength(2);
 *
 * Shapes follow the Messages API (message object, raw stream events) closely
 * enough for a thin wrapper. The brain's `claude.ts` wrapper should only use
 * what is here: create/parse/stream, `stop_reason`, `content`, `usage`,
 * `parsed_output`, stream async iteration, `on('text')`, `finalMessage()`,
 * `abort()` and the `signal` request option.
 */

export interface FakeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export type FakeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

export type FakeStopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'stop_sequence' | 'pause_turn';

export interface FakeReply {
  /** Shortcut for one text block. */
  text?: string;
  /** Full content. Overrides `text`. */
  content?: FakeContentBlock[];
  /** For `messages.parse`: returned as `parsed_output`; content defaults to its JSON. */
  parsed?: unknown;
  /** Default: 'tool_use' if content has a tool_use block, else 'end_turn'. */
  stop_reason?: FakeStopReason;
  usage?: Partial<FakeUsage>;
  /** Streaming only: delay between text deltas, so tests can abort mid-reply. Default 0. */
  chunkDelayMs?: number;
  /** Make the call fail with this error. */
  error?: Error;
}

export type FakeResponder = FakeReply | ((params: FakeParams, callIndex: number) => FakeReply | Promise<FakeReply>);

/** Request params as the brain sends them. Only `model` is required by the fake. */
export interface FakeParams {
  model: string;
  [key: string]: unknown;
}

export interface FakeRequestOptions {
  signal?: AbortSignal;
  [key: string]: unknown;
}

export interface FakeCall {
  method: 'create' | 'parse' | 'stream';
  params: FakeParams;
  options: FakeRequestOptions | undefined;
  /** Streams only: true once the stream was aborted (by `abort()` or the signal). */
  aborted: boolean;
}

export interface FakeMessage {
  id: string;
  type: 'message';
  role: 'assistant';
  model: string;
  content: FakeContentBlock[];
  stop_reason: FakeStopReason;
  stop_sequence: null;
  usage: FakeUsage;
}

export interface FakeParsedMessage<T = unknown> extends FakeMessage {
  parsed_output: T | null;
}

export type FakeStreamEvent =
  | { type: 'message_start'; message: FakeMessage }
  | { type: 'content_block_start'; index: number; content_block: FakeContentBlock }
  | { type: 'content_block_delta'; index: number; delta: { type: 'text_delta'; text: string } | { type: 'input_json_delta'; partial_json: string } }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason: FakeStopReason; stop_sequence: null }; usage: { output_tokens: number } }
  | { type: 'message_stop' };

export const DEFAULT_FAKE_USAGE: FakeUsage = {
  input_tokens: 1000,
  output_tokens: 200,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

/** Thrown (or rejected) when a stream is aborted. Same name as the SDK's error. */
export class FakeAbortError extends Error {
  override name = 'APIUserAbortError';
  constructor() {
    super('Request was aborted.');
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Split text into word-sized deltas (each keeps its trailing space). */
function chunks(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

export class FakeClaude {
  readonly calls: FakeCall[] = [];
  private queue: FakeResponder[] = [];
  private fallback: FakeResponder | null = null;
  private seq = 0;

  /** Replies for the next calls, in order (any method). */
  enqueue(...replies: FakeResponder[]): this {
    this.queue.push(...replies);
    return this;
  }

  /** Reply used when the queue is empty. Without one, an empty queue throws. */
  setDefault(responder: FakeResponder): this {
    this.fallback = responder;
    return this;
  }

  /** Sum of usage over every call so far. */
  get totalUsage(): FakeUsage {
    return this.usages.reduce(
      (t, u) => ({
        input_tokens: t.input_tokens + u.input_tokens,
        output_tokens: t.output_tokens + u.output_tokens,
        cache_creation_input_tokens: t.cache_creation_input_tokens + u.cache_creation_input_tokens,
        cache_read_input_tokens: t.cache_read_input_tokens + u.cache_read_input_tokens,
      }),
      { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    );
  }
  private usages: FakeUsage[] = [];

  readonly messages = {
    create: async (params: FakeParams, options?: FakeRequestOptions): Promise<FakeMessage> => {
      const call = this.record('create', params, options);
      const reply = await this.next(call);
      return this.toMessage(params, reply);
    },
    parse: async <T = unknown>(params: FakeParams, options?: FakeRequestOptions): Promise<FakeParsedMessage<T>> => {
      const call = this.record('parse', params, options);
      const reply = await this.next(call);
      const msg = this.toMessage(params, reply);
      return { ...msg, parsed_output: (reply.parsed ?? null) as T | null };
    },
    stream: (params: FakeParams, options?: FakeRequestOptions): FakeMessageStream => {
      const call = this.record('stream', params, options);
      return new FakeMessageStream(call, this.next(call).then((r) => ({ reply: r, message: this.toMessage(params, r) })));
    },
  };

  private record(method: FakeCall['method'], params: FakeParams, options?: FakeRequestOptions): FakeCall {
    const call: FakeCall = { method, params, options, aborted: false };
    this.calls.push(call);
    return call;
  }

  private async next(call: FakeCall): Promise<FakeReply> {
    const responder = this.queue.length ? this.queue.shift()! : this.fallback;
    if (!responder) throw new Error(`FakeClaude: no reply scripted for call #${this.calls.length} (${call.method} ${call.params.model})`);
    const reply = typeof responder === 'function' ? await responder(call.params, this.calls.length - 1) : responder;
    if (reply.error) throw reply.error;
    return reply;
  }

  private toMessage(params: FakeParams, reply: FakeReply): FakeMessage {
    const content: FakeContentBlock[] =
      reply.content ?? (reply.text !== undefined ? [{ type: 'text', text: reply.text }] : reply.parsed !== undefined ? [{ type: 'text', text: JSON.stringify(reply.parsed) }] : []);
    const usage = { ...DEFAULT_FAKE_USAGE, ...reply.usage };
    this.usages.push(usage);
    return {
      id: `msg_fake_${++this.seq}`,
      type: 'message',
      role: 'assistant',
      model: params.model,
      content,
      stop_reason: reply.stop_reason ?? (content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'),
      stop_sequence: null,
      usage,
    };
  }
}

/**
 * A minimal MessageStream. Produces events as soon as it is created (like the
 * SDK). Iterate it for raw events, use `on('text')` for text deltas, or await
 * `finalMessage()`. `abort()` or the request `signal` stops it: iteration
 * ends, `finalMessage()` rejects with FakeAbortError, and `call.aborted` is true.
 */
export class FakeMessageStream implements AsyncIterable<FakeStreamEvent> {
  readonly controller = new AbortController();
  private events: FakeStreamEvent[] = [];
  private done = false;
  private wake: (() => void) | null = null;
  private textListeners: ((delta: string, snapshot: string) => void)[] = [];
  private final: Promise<FakeMessage>;

  constructor(
    private call: FakeCall,
    start: Promise<{ reply: FakeReply; message: FakeMessage }>,
  ) {
    const outer = call.options?.signal;
    if (outer) {
      if (outer.aborted) this.abort();
      else outer.addEventListener('abort', () => this.abort(), { once: true });
    }
    this.final = this.run(start);
    this.final.catch(() => {}); // avoid unhandled rejection if nobody awaits it
  }

  abort(): void {
    if (this.controller.signal.aborted) return;
    this.call.aborted = true;
    this.controller.abort();
    this.finish();
  }

  on(event: 'text', listener: (delta: string, snapshot: string) => void): this {
    if (event === 'text') this.textListeners.push(listener);
    return this;
  }

  finalMessage(): Promise<FakeMessage> {
    return this.final;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<FakeStreamEvent> {
    let i = 0;
    while (true) {
      if (i < this.events.length) {
        yield this.events[i++]!;
        continue;
      }
      if (this.done) return;
      await new Promise<void>((r) => (this.wake = r));
    }
  }

  private push(e: FakeStreamEvent) {
    if (this.done) return;
    this.events.push(e);
    this.wake?.();
    this.wake = null;
  }

  private finish() {
    this.done = true;
    this.wake?.();
    this.wake = null;
  }

  private async run(start: Promise<{ reply: FakeReply; message: FakeMessage }>): Promise<FakeMessage> {
    const signal = this.controller.signal;
    let reply: FakeReply;
    let message: FakeMessage;
    try {
      ({ reply, message } = await start);
    } catch (err) {
      this.finish();
      throw err;
    }
    const check = () => {
      if (signal.aborted) throw new FakeAbortError();
    };
    check();
    this.push({ type: 'message_start', message: { ...message, content: [], stop_reason: message.stop_reason, usage: { ...message.usage, output_tokens: 1 } } });
    let snapshot = '';
    for (const [index, block] of message.content.entries()) {
      if (block.type === 'text') {
        this.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
        for (const piece of chunks(block.text)) {
          if (reply.chunkDelayMs) await sleep(reply.chunkDelayMs);
          check();
          snapshot += piece;
          this.push({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: piece } });
          for (const l of this.textListeners) l(piece, snapshot);
        }
      } else {
        this.push({ type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } });
        if (reply.chunkDelayMs) await sleep(reply.chunkDelayMs);
        check();
        this.push({ type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } });
      }
      this.push({ type: 'content_block_stop', index });
    }
    check();
    this.push({ type: 'message_delta', delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: message.usage.output_tokens } });
    this.push({ type: 'message_stop' });
    this.finish();
    return message;
  }
}

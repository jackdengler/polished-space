/**
 * One chat turn, shared by `POST /api/chat` (typed) and `WS /api/voice`
 * (spoken): build the prompt, stream Claude's reply, run tool calls, loop
 * until the model stops, then append the turn to the conversation.
 *
 * The tool loop is manual around the streaming wrapper (`ctx.claude.stream`).
 * Turns run one at a time, so typed and spoken turns interleave cleanly in
 * the one history.
 *
 * Abort (barge-in, closed connection): the Claude stream is aborted at once.
 * A tool already running finishes, so its call and result stay paired. Only
 * the reply text the caller says to keep (for voice: what was spoken) goes
 * into history.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { DATA_LAYOUT, addDaysIso, zonedTime, type CalEvent, type SourceRef, type Suggestion } from '@poc/contracts';
import { ClaudeError, ClaudeMaxTokensError, ClaudeRefusalError, ClaudeUnavailableError, SpendCapError, isAbortError } from '../claude';
import { MODELS, modelInfo, type ThinkingMode } from '../models';
import type { ModuleContext } from '../modules/types';
import { Conversation, type Via } from './conversation';
import { contextText, systemBlocks, userMessage, withHistoryBreakpoint } from './prompt';
import { TOOL_DEFS, runTool } from './tools';

export interface TurnHandlers {
  /** Next piece of reply text (also separators between tool rounds). */
  onDelta?(text: string): void;
  onSuggestion?(s: Suggestion): void;
  /** The first reply token arrived. */
  onFirstToken?(): void;
}

export interface TurnInput {
  text: string;
  via: Via;
  signal?: AbortSignal;
  handlers?: TurnHandlers;
  /**
   * When the turn is aborted: how much of the streamed reply to keep in
   * history (a prefix of the full text). Default: all of it.
   */
  keep?: (fullText: string) => string;
  /** Note for the model at the start of this user message (e.g. "you were interrupted"). */
  note?: string | null;
}

export interface TurnResult {
  id: string;
  /** The reply text kept in history. */
  text: string;
  /** Everything that was streamed. */
  fullText: string;
  suggestions: Suggestion[];
  aborted: boolean;
  /** Set when the turn failed (user-facing message). */
  error: string | null;
}

export interface PipelineOptions {
  /** How many past turns to send (default 30). */
  maxTurns?: number;
  /** Tool rounds per turn (default 6). */
  maxRounds?: number;
  /** Thinking for the chat model; default 'disabled' where the model accepts it (lowest latency). */
  thinking?: ThinkingMode;
  maxTokens?: number;
}

/** A text block's place in the turn's full reply text. */
interface Span {
  start: number;
  end: number;
}

interface Round {
  /** The assistant message (complete when the round finished). */
  content: Anthropic.ContentBlockParam[];
  spans: (Span | null)[];
  toolResults: Anthropic.ToolResultBlockParam[] | null;
  complete: boolean;
}

export function userFacingError(err: unknown): string {
  if (err instanceof SpendCapError) return "I've hit today's Claude budget, so I can't answer right now.";
  if (err instanceof ClaudeUnavailableError) return "I can't reach Claude: it isn't configured.";
  if (err instanceof ClaudeRefusalError) return "Sorry, I can't help with that one.";
  if (err instanceof ClaudeMaxTokensError) return 'My reply ran too long and was cut off. Could you ask again more narrowly?';
  if (err instanceof ClaudeError) return `Something went wrong talking to Claude: ${err.message}`;
  return `Something went wrong: ${(err as Error).message ?? String(err)}`;
}

export class ChatPipeline {
  readonly conversation: Conversation;
  private lock: Promise<void> = Promise.resolve();
  private readonly maxTurns: number;
  private readonly maxRounds: number;
  private readonly thinking: ThinkingMode | undefined;
  private readonly maxTokens: number;

  constructor(
    private ctx: ModuleContext,
    opts: PipelineOptions = {},
  ) {
    this.conversation = new Conversation(join(ctx.config.dataDir, DATA_LAYOUT.brainConversation));
    this.maxTurns = opts.maxTurns ?? 30;
    this.maxRounds = opts.maxRounds ?? 6;
    const accepts = modelInfo(MODELS.chat)?.thinking ?? ['adaptive'];
    const want = opts.thinking ?? 'disabled';
    this.thinking = want === 'adaptive' || !accepts.includes(want) ? undefined : want;
    this.maxTokens = opts.maxTokens ?? 8000;
  }

  /** Run one turn (waits for any turn in progress to finish first). */
  run(input: TurnInput): Promise<TurnResult> {
    const prev = this.lock;
    let release!: () => void;
    this.lock = new Promise<void>((r) => (release = r));
    return prev.then(() => this.runLocked(input)).finally(release);
  }

  private async calendarToday(): Promise<CalEvent[]> {
    const { clock } = this.ctx;
    const today = clock.today();
    try {
      return await this.ctx.read.calendar.view(zonedTime(today, 0, clock.tz).toISOString(), zonedTime(addDaysIso(today, 1), 0, clock.tz).toISOString());
    } catch {
      return [];
    }
  }

  private async runLocked(input: TurnInput): Promise<TurnResult> {
    const { ctx } = this;
    const h = input.handlers ?? {};
    const id = `${input.via === 'voice' ? 'voice' : 'manual'}-chat-${randomUUID()}`;
    const signal = input.signal ?? new AbortController().signal;
    const suggestions: Suggestion[] = [];
    let fullText = '';
    let first = true;
    const rounds: Round[] = [];
    let error: string | null = null;
    let aborted = false;

    await this.conversation.load();
    const clients = (await ctx.clients()).filter((c) => !c.archived);
    const aliases: Record<string, string[]> = {};
    for (const c of clients) aliases[c.id] = await ctx.profiles.aliases(c.name);
    const [tasks, calendarToday] = await Promise.all([ctx.myTasks(), this.calendarToday()]);
    const context = contextText({
      now: ctx.clock.now(),
      today: ctx.clock.today(),
      tz: ctx.clock.tz,
      via: input.via,
      me: ctx.config.me,
      clients,
      tasks,
      suggestions: ctx.suggestions.list(),
      nudges: (await ctx.state.build().then((s) => s.nudges).catch(() => [])) ?? [],
      calendarToday,
    });
    const user = userMessage(input.text, input.via, context, context === this.conversation.lastContext, input.note ?? null);
    const history = this.conversation.history(this.maxTurns);
    const system = systemBlocks(ctx.config.me, clients, aliases);
    const source: SourceRef = { connector: input.via === 'voice' ? 'voice' : 'manual', id, label: `${input.via === 'voice' ? 'Said' : 'Typed'} in chat: "${snippet(input.text)}"` };
    const toolEnv = { ctx, via: input.via, source, onSuggestion: (s: Suggestion) => (suggestions.push(s), h.onSuggestion?.(s)) };

    const emit = (t: string) => {
      fullText += t;
      h.onDelta?.(t);
    };

    try {
      for (let r = 0; r < this.maxRounds && !signal.aborted; r++) {
        const turnMsgs = this.turnMessages(user, rounds, false);
        const messages = [...withHistoryBreakpoint(history), ...turnMsgs];
        const stream = await ctx.claude.stream(
          { call: 'chat', sourceId: id },
          { system, messages, tools: TOOL_DEFS, maxTokens: this.maxTokens, ...(this.thinking ? { thinking: this.thinking } : {}), signal },
        );
        const onAbort = () => stream.abort();
        signal.addEventListener('abort', onAbort, { once: true });
        const round: Round = { content: [], spans: [], toolResults: null, complete: false };
        rounds.push(round);
        const partial = new Map<number, Span>();
        try {
          for await (const ev of stream) {
            if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta' && ev.delta.text) {
              let span = partial.get(ev.index);
              if (!span) {
                // Separate this text from text of an earlier round or block.
                if (fullText && !/\s$/.test(fullText)) emit(input.via === 'voice' ? ' ' : '\n\n');
                span = { start: fullText.length, end: fullText.length };
                partial.set(ev.index, span);
              }
              if (first) {
                first = false;
                h.onFirstToken?.();
              }
              emit(ev.delta.text);
              span.end = fullText.length;
            }
          }
          const msg = await stream.finalMessage();
          round.content = msg.content as Anthropic.ContentBlockParam[];
          round.spans = msg.content.map((_, i) => partial.get(i) ?? null);
          const uses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
          if (msg.stop_reason !== 'tool_use' || !uses.length) {
            round.complete = true;
            break;
          }
          // Run all tool calls of this round; their results go back in one user message.
          round.toolResults = await Promise.all(
            uses.map(async (u): Promise<Anthropic.ToolResultBlockParam> => {
              const out = await runTool(u.name, u.input, toolEnv);
              return { type: 'tool_result', tool_use_id: u.id, content: out.content, ...(out.isError ? { is_error: true } : {}) };
            }),
          );
          round.complete = true;
          if (r === this.maxRounds - 1) error = 'I took too many steps on that one. Could you ask again more simply?';
        } catch (e) {
          if (!(signal.aborted || isAbortError(e))) throw e;
          // Aborted mid-stream: keep only its streamed text.
          round.content = [];
          round.spans = [];
          for (const span of partial.values()) {
            round.content.push({ type: 'text', text: fullText.slice(span.start, span.end) });
            round.spans.push(span);
          }
        } finally {
          signal.removeEventListener('abort', onAbort);
        }
      }
    } catch (e) {
      error = userFacingError(e);
      ctx.log(`chat turn ${id} failed: ${(e as Error).message}`);
    }
    aborted = signal.aborted;

    const kept = aborted && input.keep ? input.keep(fullText) : fullText;
    const keepLen = fullText.startsWith(kept) ? kept.length : Math.min(kept.length, fullText.length);
    const turnMsgs = this.turnMessages(user, rounds, true, keepLen);
    const keptText = kept.trim();
    await this.conversation.append(
      { id, at: ctx.clock.now().toISOString(), via: input.via, user: input.text, assistant: keptText, interrupted: aborted, suggestionIds: suggestions.map((s) => s.id) },
      turnMsgs,
      context,
    );
    return { id, text: keptText, fullText, suggestions, aborted, error };
  }

  /**
   * The turn's messages: the user message, then each round's assistant
   * message and tool results. For the stored copy (`final`), text blocks are
   * cut to `keepLen` characters of the full reply, empty text is dropped,
   * and tool calls are kept only where their results exist.
   */
  private turnMessages(user: Anthropic.MessageParam, rounds: Round[], final: boolean, keepLen = Infinity): Anthropic.MessageParam[] {
    const out: Anthropic.MessageParam[] = [user];
    for (const round of rounds) {
      if (!final && !round.complete) continue;
      const blocks: Anthropic.ContentBlockParam[] = [];
      round.content.forEach((b, i) => {
        if (b.type === 'text') {
          const span = round.spans[i];
          const text = span && final ? b.text.slice(0, Math.max(0, keepLen - span.start)) : b.text;
          if (text.trim()) blocks.push({ ...b, text });
        } else if (b.type === 'tool_use') {
          if (round.toolResults) blocks.push(b);
        } else blocks.push(b);
      });
      if (!blocks.some((b) => b.type === 'text' || b.type === 'tool_use')) continue;
      out.push({ role: 'assistant', content: blocks });
      if (round.toolResults && blocks.some((b) => b.type === 'tool_use')) out.push({ role: 'user', content: round.toolResults });
    }
    return out;
  }
}

function snippet(s: string, n = 60): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

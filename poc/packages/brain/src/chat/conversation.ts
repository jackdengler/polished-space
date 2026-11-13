/**
 * The one conversation (typed and spoken turns alike), kept append-only in
 * `data/brain/conversation.json` (DATA_LAYOUT.brainConversation).
 *
 * It stores the exact Messages API messages each turn produced (user text
 * with that turn's context, assistant text and tool calls, tool results) and
 * replays them unchanged on the next turn. Replaying unchanged keeps the
 * prompt cache warm and never edits history. Alongside, `turns` keeps a
 * human-readable record (what was said or typed, what was answered or
 * spoken, which suggestions came out of it).
 */
import type Anthropic from '@anthropic-ai/sdk';
import { JsonFile } from '../store/jsonFile';

export type Via = 'text' | 'voice';

export interface TurnRecord {
  id: string;
  at: string;
  via: Via;
  user: string;
  /** What the assistant said (for an interrupted voice turn: only what was spoken). */
  assistant: string;
  interrupted: boolean;
  suggestionIds: string[];
  /** Index range of this turn in `messages`. */
  messageStart: number;
  messageEnd: number;
}

export interface ConversationFile {
  version: 1;
  messages: Anthropic.MessageParam[];
  turns: TurnRecord[];
  /** The context block sent with the latest turn (to say "unchanged" next time). */
  lastContext: string | null;
}

const EMPTY: ConversationFile = { version: 1, messages: [], turns: [], lastContext: null };

export class Conversation {
  private data: ConversationFile = structuredClone(EMPTY);
  private file: JsonFile<ConversationFile>;
  private loaded: Promise<void> | null = null;

  constructor(path: string) {
    this.file = new JsonFile(path);
  }

  load(): Promise<void> {
    this.loaded ??= this.file.load(structuredClone(EMPTY)).then((raw) => {
      if (raw && raw.version === 1 && Array.isArray(raw.messages) && Array.isArray(raw.turns)) this.data = raw;
    });
    return this.loaded;
  }

  get turns(): TurnRecord[] {
    return structuredClone(this.data.turns);
  }

  get lastContext(): string | null {
    return this.data.lastContext;
  }

  /** The messages of the last `maxTurns` turns, unchanged (a copy). */
  history(maxTurns: number): Anthropic.MessageParam[] {
    const turns = this.data.turns;
    const from = turns.length > maxTurns ? turns[turns.length - maxTurns]!.messageStart : 0;
    return structuredClone(this.data.messages.slice(from));
  }

  /** Append one finished turn. */
  async append(turn: Omit<TurnRecord, 'messageStart' | 'messageEnd'>, messages: Anthropic.MessageParam[], context: string): Promise<TurnRecord> {
    await this.load();
    const start = this.data.messages.length;
    this.data.messages.push(...structuredClone(messages));
    const rec: TurnRecord = { ...turn, messageStart: start, messageEnd: this.data.messages.length };
    this.data.turns.push(rec);
    this.data.lastContext = context;
    await this.file.save(this.data);
    return structuredClone(rec);
  }
}

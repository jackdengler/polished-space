/**
 * Suggestion store (`data/brain/suggestions.json`). Every suggestion is
 * validated against the contract on every write. The only way to move one out
 * of `pending` is `claim()` (approve) or `deny()`, both used by approve.ts.
 */
import { randomUUID } from 'node:crypto';
import { Suggestion, type SuggestionStatus } from '@poc/contracts';
import type { Clock } from '../config';
import { JsonFile } from './jsonFile';

type Distribute<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** What a caller supplies to create a suggestion; the store fills id, status, timestamps and error. */
export type NewSuggestion = Distribute<Suggestion, 'id' | 'status' | 'createdAt' | 'decidedAt' | 'error'>;

export class SuggestionConflictError extends Error {
  override name = 'SuggestionConflictError';
}

export class SuggestionStore {
  private items: Suggestion[] = [];
  private file: JsonFile<Suggestion[]>;
  private listeners: (() => void)[] = [];
  private addListeners: ((made: Suggestion[]) => void)[] = [];

  constructor(path: string, private clock: Clock) {
    this.file = new JsonFile(path);
  }

  async load(): Promise<void> {
    const raw = await this.file.load([]);
    this.items = (Array.isArray(raw) ? raw : []).flatMap((s) => {
      const p = Suggestion.safeParse(s);
      return p.success ? [p.data] : [];
    });
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  /** Called after new suggestions are stored (any caller of add/addMany). */
  onAdded(fn: (made: Suggestion[]) => void): void {
    this.addListeners.push(fn);
  }

  private async persist(): Promise<void> {
    await this.file.save(this.items);
    for (const l of this.listeners) l();
  }

  list(): Suggestion[] {
    return structuredClone(this.items);
  }

  get(id: string): Suggestion | null {
    const s = this.items.find((x) => x.id === id);
    return s ? structuredClone(s) : null;
  }

  async add(input: NewSuggestion): Promise<Suggestion> {
    return (await this.addMany([input]))[0]!;
  }

  async addMany(inputs: NewSuggestion[]): Promise<Suggestion[]> {
    const now = this.clock.now().toISOString();
    const made = inputs.map((input) => Suggestion.parse({ ...input, id: `sug-${randomUUID()}`, status: 'pending', createdAt: now, decidedAt: null, error: null }));
    this.items.push(...made);
    await this.persist();
    for (const l of this.addListeners) l(structuredClone(made));
    return structuredClone(made);
  }

  /** Replace one suggestion with `fn(current)`; the result is validated. */
  async update(id: string, fn: (s: Suggestion) => Suggestion): Promise<Suggestion> {
    const i = this.items.findIndex((x) => x.id === id);
    if (i < 0) throw new Error(`no suggestion ${id}`);
    const next = Suggestion.parse(fn(structuredClone(this.items[i]!)));
    if (next.id !== id) throw new Error('suggestion id cannot change');
    this.items[i] = next;
    await this.persist();
    return structuredClone(next);
  }

  /**
   * Check-and-set, synchronously in memory before any await, so two approvals
   * of the same suggestion can never both run its action.
   */
  claim(id: string, from: readonly SuggestionStatus[], to: SuggestionStatus): Suggestion {
    const s = this.items.find((x) => x.id === id);
    if (!s) throw new Error(`no suggestion ${id}`);
    if (!from.includes(s.status)) throw new SuggestionConflictError(`suggestion ${id} is ${s.status}`);
    s.status = to;
    return structuredClone(s);
  }
}

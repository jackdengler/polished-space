/**
 * Nudges: plain-English taps on the shoulder. Newest first, at most 20, kept in
 * `data/brain/nudges.json` like the other stores, so a brain restart keeps
 * them and their "Review N" groupings (D8).
 */
import { randomUUID } from 'node:crypto';
import { Nudge } from '@poc/contracts';
import type { Clock } from '../config';
import { JsonFile } from './jsonFile';

export type NewNudge = Omit<Nudge, 'id' | 'createdAt' | 'suggestionIds' | 'taskId'> & { suggestionIds?: string[]; taskId?: string | null };

const MAX = 20;

export class NudgeStore {
  private items: Nudge[] = [];
  private listeners: ((n: Nudge) => void)[] = [];
  private changeListeners: (() => void)[] = [];
  private file: JsonFile<Nudge[]> | null;

  /** `path` null keeps them in memory only (tests that do not care). */
  constructor(
    private clock: Clock,
    path: string | null = null,
  ) {
    this.file = path ? new JsonFile(path) : null;
  }

  async load(): Promise<void> {
    if (!this.file) return;
    const raw = await this.file.load([]);
    this.items = (Array.isArray(raw) ? raw : []).flatMap((n) => {
      const p = Nudge.safeParse(n);
      return p.success ? [p.data] : [];
    });
  }

  onNudge(fn: (n: Nudge) => void): void {
    this.listeners.push(fn);
  }

  /** A nudge was removed or changed (not added). */
  onChange(fn: () => void): void {
    this.changeListeners.push(fn);
  }

  private save(): void {
    void this.file?.save(this.items).catch(() => {});
  }

  add(n: NewNudge): Nudge {
    const nudge = Nudge.parse({ suggestionIds: [], taskId: null, ...n, id: `nudge-${randomUUID()}`, createdAt: this.clock.now().toISOString() });
    this.items.unshift(nudge);
    this.items.length = Math.min(this.items.length, MAX);
    this.save();
    for (const l of this.listeners) l(nudge);
    return nudge;
  }

  /** Drop the nudges that match (e.g. a stale fit-now). Returns how many went. */
  remove(match: (n: Nudge) => boolean): number {
    const before = this.items.length;
    this.items = this.items.filter((n) => !match(n));
    const gone = before - this.items.length;
    if (gone) {
      this.save();
      for (const l of this.changeListeners) l();
    }
    return gone;
  }

  /** Change one nudge's text in place (same id, so the sidebar keeps its place). */
  retext(id: string, text: string): void {
    const n = this.items.find((x) => x.id === id);
    if (!n || n.text === text) return;
    n.text = text;
    this.save();
    for (const l of this.changeListeners) l();
  }

  list(): Nudge[] {
    return structuredClone(this.items);
  }
}

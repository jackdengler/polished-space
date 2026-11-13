/** Nudges: plain-English taps on the shoulder. Kept in memory, newest first, at most 20. */
import { randomUUID } from 'node:crypto';
import { Nudge } from '@poc/contracts';
import type { Clock } from '../config';

export type NewNudge = Omit<Nudge, 'id' | 'createdAt' | 'suggestionIds' | 'taskId'> & { suggestionIds?: string[]; taskId?: string | null };

const MAX = 20;

export class NudgeStore {
  private items: Nudge[] = [];
  private listeners: ((n: Nudge) => void)[] = [];

  constructor(private clock: Clock) {}

  onNudge(fn: (n: Nudge) => void): void {
    this.listeners.push(fn);
  }

  add(n: NewNudge): Nudge {
    const nudge = Nudge.parse({ suggestionIds: [], taskId: null, ...n, id: `nudge-${randomUUID()}`, createdAt: this.clock.now().toISOString() });
    this.items.unshift(nudge);
    this.items.length = Math.min(this.items.length, MAX);
    for (const l of this.listeners) l(nudge);
    return nudge;
  }

  list(): Nudge[] {
    return structuredClone(this.items);
  }
}

/**
 * The usage log (`data/logs/usage.jsonl`): one line per Claude call, and the
 * running total behind the daily spend cap. Written only by claude.ts.
 */
import { readFile } from 'node:fs/promises';
import { UsageLine, summariseUsage, type UsageResponse, type UsageSummary } from '@poc/contracts';
import type { Clock } from './config';
import { appendLine } from './store/jsonFile';

export class UsageLog {
  private lines: UsageLine[] = [];
  private loaded = false;

  constructor(
    readonly path: string,
    private clock: Clock,
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    let text = '';
    try {
      text = await readFile(this.path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    for (const raw of text.split('\n')) {
      if (!raw.trim()) continue;
      const parsed = UsageLine.safeParse(JSON.parse(raw));
      if (parsed.success) this.lines.push(parsed.data);
    }
  }

  async append(line: UsageLine): Promise<void> {
    const valid = UsageLine.parse(line);
    this.lines.push(valid);
    await appendLine(this.path, JSON.stringify(valid));
  }

  /** Estimated spend so far on the clock's local day. */
  spentToday(): number {
    const day = this.clock.today();
    return this.lines.reduce((t, l) => (this.clock.dayOf(l.ts) === day ? t + l.estUsd : t), 0);
  }

  today(): UsageSummary {
    return summariseUsage(this.lines, this.clock.today(), this.clock.dayOf);
  }

  response(): UsageResponse {
    const days = [...new Set(this.lines.map((l) => this.clock.dayOf(l.ts)))].sort().reverse();
    return { today: this.today(), days: days.map((d) => summariseUsage(this.lines, d, this.clock.dayOf)) };
  }

  all(): readonly UsageLine[] {
    return this.lines;
  }
}

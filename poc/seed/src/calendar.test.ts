import { describe, expect, it } from 'vitest';
import { eventSpanMs, localDate, resolveNow, weekdayIndex } from '@poc/contracts';
import { buildCalendar } from './calendar';

const CASES: [string, string][] = [
  ['2026-11-13T13:47:00Z', 'UTC'],
  ['2026-11-13T09:00:00Z', 'UTC'],
  ['2026-11-13T11:31:00Z', 'UTC'],
  ['2026-11-13T23:59:00Z', 'UTC'],
  ['2026-11-16T08:00:00Z', 'America/New_York'],
  ['2026-11-13T14:10:00Z', 'Europe/London'],
  ['2026-11-13T05:15:00Z', 'Asia/Tokyo'],
];

describe('seeded calendar', () => {
  it.each(CASES)('POC_NOW=%s (%s): a free gap of at least 60 minutes before the next meeting', (nowIso, tz) => {
    const now = resolveNow(nowIso);
    const spans = buildCalendar(now, tz).map(eventSpanMs);
    const ongoing = spans.filter((s) => s.start <= now.getTime() && s.end > now.getTime());
    expect(ongoing).toEqual([]);
    const next = spans.filter((s) => s.start > now.getTime()).sort((a, b) => a.start - b.start)[0]!;
    expect(next).toBeDefined();
    const gapMin = (next.start - now.getTime()) / 60_000;
    expect(gapMin).toBeGreaterThanOrEqual(60);
  });

  it('has no lunch block, has a meeting earlier today, and events on later days', () => {
    const now = resolveNow('2026-11-13T13:47:00Z');
    const events = buildCalendar(now, 'UTC');
    expect(events.some((e) => /lunch/i.test(e.subject))).toBe(false);
    expect(events.some((e) => eventSpanMs(e).end <= now.getTime())).toBe(true);
    const days = new Set(events.map((e) => localDate(new Date(eventSpanMs(e).start), 'UTC')));
    expect(days.size).toBeGreaterThanOrEqual(6);
    // Events on later days fall on weekdays only.
    for (const e of events.slice(3)) expect(weekdayIndex(localDate(new Date(eventSpanMs(e).start), 'UTC'))).toBeLessThan(5);
    const ids = events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no two events overlap', () => {
    for (const [nowIso, tz] of CASES) {
      const spans = buildCalendar(resolveNow(nowIso), tz).map(eventSpanMs).sort((a, b) => a.start - b.start);
      for (let i = 1; i < spans.length; i++) expect(spans[i]!.start).toBeGreaterThanOrEqual(spans[i - 1]!.end);
    }
  });
});

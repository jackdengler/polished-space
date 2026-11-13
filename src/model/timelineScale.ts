/**
 * Maps calendar days to x positions on the meeting timeline.
 *
 * Time is proportional (pxPerDay), except that consecutive meeting tiles are
 * pushed at least `minGap` apart so they never overlap. Every other date
 * (today, planned-through, task dots, month ticks) is interpolated between the
 * tile anchors, so it always sits in the right place relative to the meetings.
 */
export interface ScaleOptions {
  pxPerDay: number;
  minGap: number;
  /** Space before the first date / after the last. */
  padStart: number;
  padEnd: number;
}

export interface Scale {
  /** x for a calendar day number. */
  x(day: number): number;
  /** x for the i-th tile (tiles may share a day; each still gets its own slot). */
  tileX(i: number): number;
  startDay: number;
  endDay: number;
  width: number;
}

/**
 * @param tileDays day numbers of the tiles, sorted ascending (duplicates allowed)
 * @param extraDays other days that must be in range (today, planned-through, dots…)
 */
export function buildScale(tileDays: number[], extraDays: number[], o: ScaleOptions): Scale {
  const all = [...tileDays, ...extraDays];
  const startDay = (all.length ? Math.min(...all) : 0) - 14;
  const endDay = (all.length ? Math.max(...all) : 0) + 14;

  // Anchors: domain start, each tile, domain end.
  const days: number[] = [startDay];
  const xs: number[] = [o.padStart];
  for (const [i, day] of tileDays.entries()) {
    const prevDay = days[days.length - 1]!;
    const prevX = xs[xs.length - 1]!;
    const gap = (day - prevDay) * o.pxPerDay;
    xs.push(prevX + (i === 0 ? gap : Math.max(o.minGap, gap)));
    days.push(day);
  }
  const lastX = xs[xs.length - 1]!;
  const lastDay = days[days.length - 1]!;
  // Leave room for the last tile's width before the domain ends.
  const endX = Math.max(lastX + (endDay - lastDay) * o.pxPerDay, tileDays.length ? lastX + o.minGap : 0);
  days.push(endDay);
  xs.push(endX);

  function x(day: number): number {
    if (day <= days[0]!) return xs[0]! - (days[0]! - day) * o.pxPerDay;
    for (let i = 1; i < days.length; i++) {
      const d0 = days[i - 1]!, d1 = days[i]!;
      if (day <= d1) {
        if (d1 === d0) return xs[i - 1]!;
        // A same-day pair of anchors means a tile stack; dates between land after the last of them.
        return xs[i - 1]! + ((day - d0) / (d1 - d0)) * (xs[i]! - xs[i - 1]!);
      }
    }
    return endX + (day - endDay) * o.pxPerDay;
  }

  return { x, tileX: (i) => xs[i + 1]!, startDay, endDay, width: endX + o.padEnd };
}

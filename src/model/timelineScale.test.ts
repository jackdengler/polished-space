import { describe, expect, it } from 'vitest';
import { buildScale } from './timelineScale';

const opts = { pxPerDay: 4, minGap: 160, padStart: 20, padEnd: 20 };

describe('buildScale', () => {
  it('is proportional when tiles are far apart', () => {
    const s = buildScale([100, 200], [], opts);
    expect(s.tileX(1) - s.tileX(0)).toBe(400);
    expect(s.x(150)).toBe(s.tileX(0) + 200);
  });

  it('pushes close tiles apart and keeps other dates in order', () => {
    const s = buildScale([100, 102, 102], [101], opts);
    expect(s.tileX(1) - s.tileX(0)).toBe(160);
    expect(s.tileX(2) - s.tileX(1)).toBe(160);
    const mid = s.x(101);
    expect(mid).toBeGreaterThan(s.tileX(0));
    expect(mid).toBeLessThan(s.tileX(1));
  });

  it('covers extra days with padding and works with no tiles', () => {
    const s = buildScale([], [50], opts);
    expect(s.x(50)).toBeGreaterThan(0);
    expect(s.width).toBeGreaterThan(s.x(50));
  });
});

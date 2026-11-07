import { describe, expect, it } from 'vitest';
import { compareFlex, flexToInput, formatFlex, parseFlexDate } from './flexDate';

describe('parseFlexDate', () => {
  it.each([
    ['10/28/26', '2026-10-28'],
    ['10/28/2026', '2026-10-28'],
    ['1-5-27', '2027-01-05'],
    ['2026-10-28', '2026-10-28'],
    ['Oct 28 2026', '2026-10-28'],
    ['October 28th, 2026', '2026-10-28'],
    ['sept 3 26', '2026-09-03'],
  ])('exact: %s', (input, iso) => {
    expect(parseFlexDate(input)).toEqual({ kind: 'exact', date: iso });
  });

  it.each([
    ['Fall 2026', 'Fall 2026', '2026-09-01', '2026-11-30'],
    ['autumn 26', 'Fall 2026', '2026-09-01', '2026-11-30'],
    ['Winter 2026', 'Winter 2026', '2026-12-01', '2027-02-28'],
    ['Spring 2028', 'Spring 2028', '2028-03-01', '2028-05-31'],
    ['Q4 2026', 'Q4 2026', '2026-10-01', '2026-12-31'],
    ["q1 '27", 'Q1 2027', '2027-01-01', '2027-03-31'],
    ['H2 2026', 'H2 2026', '2026-07-01', '2026-12-31'],
    ['Nov 2026', 'Nov 2026', '2026-11-01', '2026-11-30'],
    ['february 2028', 'Feb 2028', '2028-02-01', '2028-02-29'],
    ['11/2026', 'Nov 2026', '2026-11-01', '2026-11-30'],
    ['Early 2027', 'Early 2027', '2027-01-01', '2027-04-30'],
    ['mid-2026', 'Mid 2026', '2026-05-01', '2026-08-31'],
    ['late nov 2026', 'Late Nov 2026', '2026-11-21', '2026-11-30'],
    ['2026', '2026', '2026-01-01', '2026-12-31'],
  ])('range: %s', (input, label, start, end) => {
    expect(parseFlexDate(input)).toEqual({ kind: 'range', label, start, end });
  });

  it.each(['', 'soon', '13/40/26', '2/30/26', 'Q5 2026', 'Smarch 2026', 'ma 2026'])('rejects %j', (input) => {
    expect(parseFlexDate(input)).toBeNull();
  });
});

describe('smart year snapping', () => {
  const nov7 = '2026-11-07';
  it.each([
    ['11/2', '2026-11-02'],   // 5 days ago: stays this year
    ['10/10', '2026-10-10'],  // 28 days ago: within the grace
    ['10/1', '2027-10-01'],   // 37 days ago: next year
    ['12/1', '2026-12-01'],   // ahead this year
    ['1/15', '2027-01-15'],   // January → next year
    ['Nov 30', '2026-11-30'],
    ['Mar 3', '2027-03-03'],
    ['march 3rd', '2027-03-03'],
    ['2/29', '2028-02-29'],   // next leap day
  ])('%s → %s', (input, iso) => {
    expect(parseFlexDate(input, nov7)).toEqual({ kind: 'exact', date: iso });
  });
  it('rejects impossible yearless dates', () => {
    expect(parseFlexDate('2/30', nov7)).toBeNull();
    expect(parseFlexDate('13/2', nov7)).toBeNull();
  });
  it("still reads Jan '27 and Fall 26 as periods", () => {
    expect(parseFlexDate("Jan '27", nov7)).toMatchObject({ kind: 'range', label: 'Jan 2027' });
    expect(parseFlexDate('Fall 26', nov7)).toMatchObject({ kind: 'range', label: 'Fall 2026' });
  });
});

describe('ordering and formatting', () => {
  it('sorts by start, exact before a period starting the same day', () => {
    const items = ['Fall 2026', '9/1/26', '8/15/26', 'Q4 2026'].map((s) => parseFlexDate(s)!);
    expect(items.sort(compareFlex).map(formatFlex)).toEqual(['Aug 15, 2026', 'Sep 1, 2026', 'Fall 2026', 'Q4 2026']);
  });

  it('round-trips through the input format', () => {
    for (const s of ['10/28/26', 'Fall 2026', 'Q1 2027']) {
      const f = parseFlexDate(s)!;
      expect(parseFlexDate(flexToInput(f))).toEqual(f);
    }
  });
});

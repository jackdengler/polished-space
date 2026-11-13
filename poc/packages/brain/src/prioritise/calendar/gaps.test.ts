import { describe, expect, it } from 'vitest';
import { FakeCalendarConnector } from '@poc/contracts/testing';
import { findFocusSlot, findLunchSlot, formatTime, freeGapsToday, gapBeforeNextMeeting, hasLunch } from './gaps';

const ev = FakeCalendarConnector.event;
const at = (hhmm: string, day = '2026-11-13') => new Date(`${day}T${hhmm}:00.000Z`); // 2026-11-13 is a Friday
const iso = (d: Date | number) => new Date(d).toISOString();
const checkin = ev('evt-1', 'Acme Tooling check-in', '2026-11-13T15:30:00.000Z', '2026-11-13T16:00:00.000Z');

describe('gapBeforeNextMeeting (fixed clock)', () => {
  it('finds the free time before the next meeting', () => {
    const g = gapBeforeNextMeeting([checkin], at('13:47'), 'UTC');
    expect(g).toEqual({ start: iso(at('13:47')), end: iso(at('15:30')), minutes: 103, nextMeeting: { id: 'evt-1', subject: 'Acme Tooling check-in', start: iso(at('15:30')) } });
  });

  it('is null while a meeting is in progress', () => {
    expect(gapBeforeNextMeeting([checkin], at('15:40'), 'UTC')).toBeNull();
    expect(gapBeforeNextMeeting([checkin], at('15:30'), 'UTC')).toBeNull(); // starts right now
  });

  it('runs to the end of the working day when there are no more meetings', () => {
    const g = gapBeforeNextMeeting([checkin], at('16:10'), 'UTC');
    expect(g).toMatchObject({ end: iso(at('17:30')), minutes: 80, nextMeeting: null });
  });

  it('is null when the gap is shorter than the minimum', () => {
    expect(gapBeforeNextMeeting([checkin], at('15:05'), 'UTC')).toBeNull(); // 25 minutes
    expect(gapBeforeNextMeeting([checkin], at('15:05'), 'UTC', { minMinutes: 20 })).toMatchObject({ minutes: 25 });
  });

  it('ignores free events and treats touching meetings as one busy block', () => {
    const free = { ...ev('evt-f', 'Optional webinar', '2026-11-13T14:00:00.000Z', '2026-11-13T15:00:00.000Z'), showAs: 'free' as const };
    const back = ev('evt-2', 'Back to back', '2026-11-13T16:00:00.000Z', '2026-11-13T16:30:00.000Z');
    expect(gapBeforeNextMeeting([free, checkin], at('13:47'), 'UTC')).toMatchObject({ minutes: 103 });
    expect(freeGapsToday([checkin, back], at('15:40'), 'UTC').map((g) => [g.start, g.end])).toEqual([[iso(at('16:30')), iso(at('17:30'))]]);
  });

  it('splits the day around a lunch block', () => {
    const lunch = ev('evt-l', 'Lunch', '2026-11-13T12:00:00.000Z', '2026-11-13T12:30:00.000Z');
    const pm = ev('evt-3', 'Quillon Robotics sync', '2026-11-13T15:00:00.000Z', '2026-11-13T15:30:00.000Z');
    expect(gapBeforeNextMeeting([lunch, pm], at('11:00'), 'UTC')).toMatchObject({ minutes: 60, nextMeeting: { id: 'evt-l' } });
    expect(freeGapsToday([lunch, pm], at('11:00'), 'UTC').map((g) => [g.start.slice(11, 16), g.end.slice(11, 16), g.nextMeeting?.id ?? null])).toEqual([
      ['11:00', '12:00', 'evt-l'],
      ['12:30', '15:00', 'evt-3'],
      ['15:30', '17:30', null],
    ]);
  });

  it('is null outside working hours and at weekends', () => {
    expect(gapBeforeNextMeeting([], at('07:30'), 'UTC')).toBeNull();
    expect(gapBeforeNextMeeting([], at('18:00'), 'UTC')).toBeNull();
    expect(gapBeforeNextMeeting([], at('11:00', '2026-11-14'), 'UTC')).toBeNull(); // Saturday
  });

  it('uses working hours in POC_TZ, with events stored in UTC', () => {
    const tz = 'America/New_York'; // UTC-5 in November
    const call = ev('evt-ny', 'Harborlight Freight call', '2026-11-13T20:00:00.000Z', '2026-11-13T20:30:00.000Z'); // 3pm local
    const g = gapBeforeNextMeeting([call], new Date('2026-11-13T19:00:00.000Z'), tz);
    expect(g).toMatchObject({ minutes: 60, nextMeeting: { id: 'evt-ny' } });
    expect(formatTime(g!.nextMeeting!.start, tz)).toBe('3pm');
    // 13:00 UTC is 8am in New York: before the working day starts.
    expect(gapBeforeNextMeeting([call], new Date('2026-11-13T13:00:00.000Z'), tz)).toBeNull();
    // 22:00 UTC is 5pm: 30 minutes left of the day.
    expect(gapBeforeNextMeeting([], new Date('2026-11-13T22:00:00.000Z'), tz)).toMatchObject({ minutes: 30, end: '2026-11-13T22:30:00.000Z' });
    // Late Friday UTC is still Friday in New York, but 01:00 UTC Saturday is Friday 8pm: after hours.
    expect(gapBeforeNextMeeting([], new Date('2026-11-14T01:00:00.000Z'), tz)).toBeNull();
  });
});

describe('findLunchSlot', () => {
  it('offers the next quarter hour inside the lunch window', () => {
    expect(findLunchSlot([checkin], at('13:47'), 'UTC')).toEqual({ start: at('14:00').getTime(), end: at('14:30').getTime() });
  });

  it('prefers 12:00 and steps around busy time', () => {
    expect(findLunchSlot([], at('10:00'), 'UTC')).toEqual({ start: at('12:00').getTime(), end: at('12:30').getTime() });
    const busy = ev('evt-b', 'Tessera Foods call', '2026-11-13T12:00:00.000Z', '2026-11-13T13:00:00.000Z');
    expect(findLunchSlot([busy], at('10:00'), 'UTC')!.start).toBe(at('11:30').getTime());
    expect(findLunchSlot([], at('10:00'), 'UTC', [{ start: at('12:00').getTime(), end: at('12:30').getTime() }])!.start).toBe(at('11:30').getTime());
  });

  it('is null when lunch is already blocked, the window has passed, or at weekends', () => {
    const lunch = ev('evt-l', 'Lunch with Priya', '2026-11-13T12:00:00.000Z', '2026-11-13T13:00:00.000Z');
    expect(hasLunch([lunch])).toBe(true);
    expect(findLunchSlot([lunch], at('10:00'), 'UTC')).toBeNull();
    expect(findLunchSlot([], at('14:10'), 'UTC')).toBeNull();
    expect(findLunchSlot([], at('10:00', '2026-11-15'), 'UTC')).toBeNull();
  });

  it('works in local time', () => {
    expect(findLunchSlot([], new Date('2026-11-13T14:00:00.000Z'), 'America/New_York')!.start).toBe(Date.parse('2026-11-13T17:00:00.000Z'));
  });
});

describe('findFocusSlot', () => {
  const lunchHold = { start: at('14:00').getTime(), end: at('14:30').getTime() };
  it('finds the first free run of the requested length, today first', () => {
    expect(findFocusSlot([checkin], at('13:47'), 'UTC', 60, { extraBusy: [lunchHold] })).toEqual({ start: at('14:30').getTime(), end: at('15:30').getTime() });
  });

  it('moves to the next working day (skipping the weekend) when today is full', () => {
    expect(findFocusSlot([checkin], at('13:47'), 'UTC', 120, { extraBusy: [lunchHold] })).toEqual({ start: Date.parse('2026-11-16T09:00:00.000Z'), end: Date.parse('2026-11-16T11:00:00.000Z') });
  });
});

describe('formatTime', () => {
  it('writes times like an assistant would', () => {
    expect(formatTime(at('15:00'), 'UTC')).toBe('3pm');
    expect(formatTime(at('15:30'), 'UTC')).toBe('3:30pm');
    expect(formatTime(at('00:05'), 'UTC')).toBe('12:05am');
    expect(formatTime(at('12:00'), 'UTC')).toBe('12pm');
  });
});

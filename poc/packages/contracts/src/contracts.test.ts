import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as c from './index';
import { SAMPLES } from './testing';

describe('every schema has a valid and an invalid sample', () => {
  const schemas = Object.entries(c).filter(([, v]) => v instanceof z.ZodType) as [string, z.ZodType][];
  const covered = new Set(Object.values(SAMPLES).map((s) => s.schema));

  it('finds the exported schemas', () => {
    expect(schemas.length).toBeGreaterThan(50);
  });

  it.each(schemas.map(([name, schema]) => [name, schema] as const))('%s is covered by SAMPLES', (_name, schema) => {
    expect(covered.has(schema)).toBe(true);
  });

  for (const [name, s] of Object.entries(SAMPLES)) {
    it(`${name}: valid sample parses`, () => {
      const r = s.schema.safeParse(s.valid);
      expect(r.error?.issues ?? []).toEqual([]);
    });
    it(`${name}: invalid sample is rejected`, () => {
      expect(s.schema.safeParse(s.invalid).success).toBe(false);
    });
  }
});

describe('constants', () => {
  it('has the five MCP tools and nothing else', () => {
    expect([...c.MCP_TOOL_NAMES].sort()).toEqual(['complete_task', 'create_task', 'list_clients', 'list_tasks', 'reschedule_task']);
    expect(Object.keys(c.MCP_TOOLS).sort()).toEqual([...c.MCP_TOOL_NAMES].sort());
    expect([...c.MCP_WRITE_TOOLS].sort()).toEqual(['complete_task', 'create_task', 'reschedule_task']);
  });
  it('builds id paths with encoding', () => {
    expect(c.PATHS.brain.approve('a b')).toBe('/api/suggestions/a%20b/approve');
    expect(c.PATHS.graph.message('x/y')).toBe('/v1.0/me/messages/x%2Fy');
  });
  it('profile headings are the fixed list from the plan', () => {
    expect(c.PROFILE_HEADINGS).toEqual([
      '# <Client>',
      '## Also known as',
      '## Key contacts',
      '## Active projects',
      '## Commitments: we owe',
      '## Commitments: they owe',
      '## Preferences and quirks',
      '## Recent decisions',
      '## Change log',
    ]);
  });
});

describe('time helpers', () => {
  it('resolveNow honours POC_NOW and rejects junk', () => {
    expect(c.resolveNow('2026-11-13T09:00:00Z').toISOString()).toBe('2026-11-13T09:00:00.000Z');
    expect(() => c.resolveNow('soon')).toThrow(/POC_NOW/);
    expect(c.resolveNow(undefined)).toBeInstanceOf(Date);
  });
  it('localDate and zonedTime respect the time zone', () => {
    const d = new Date('2026-11-13T23:30:00Z');
    expect(c.localDate(d, 'UTC')).toBe('2026-11-13');
    expect(c.localDate(d, 'Asia/Tokyo')).toBe('2026-11-14');
    expect(c.zonedTime('2026-11-13', 9 * 60, 'America/New_York').toISOString()).toBe('2026-11-13T14:00:00.000Z');
    expect(c.zonedTime('2026-07-13', 9 * 60, 'America/New_York').toISOString()).toBe('2026-07-13T13:00:00.000Z');
    expect(c.localMinutes(new Date('2026-11-13T14:05:00Z'), 'America/New_York')).toBe(9 * 60 + 5);
  });
  it('weekday maths (Mon=0)', () => {
    expect(c.weekdayIndex('2026-11-13')).toBe(4); // a Friday
    expect(c.weekStart('2026-11-13')).toBe('2026-11-09');
    expect(c.nextWeekday('2026-11-11', 4)).toBe('2026-11-13');
    expect(c.nextWeekday('2026-11-13', 4)).toBe('2026-11-20');
    expect(c.addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('sections', () => {
  const today = '2026-11-11'; // Wednesday
  const at = (dueDate: string | null, extra: Partial<c.SectionInput> = {}) =>
    c.sectionKeyFor({ dueDate, onHold: false, clientId: 'acme', ...extra }, today, 'internal');

  it('places tasks by date', () => {
    expect(at(null)).toBe('inbox');
    expect(at('2026-11-01')).toBe('overdue');
    expect(at('2026-11-11')).toBe('today');
    expect(at('2026-11-12')).toBe('tomorrow');
    expect(at('2026-11-13')).toBe('day-2026-11-13');
    expect(at('2026-11-15')).toBe('day-2026-11-15');
    expect(at('2026-11-16')).toBe('next_week');
    expect(at('2026-11-23')).toBe('next_week_1');
    expect(at('2026-11-30')).toBe('next_week_2');
    expect(at('2026-12-07')).toBe('later');
  });
  it('on hold and internal win over dates', () => {
    expect(at('2026-11-01', { onHold: true })).toBe('on_hold');
    expect(at('2026-11-01', { clientId: 'internal' })).toBe('internal');
  });
  it('lists keys in display order with labels', () => {
    const keys = c.sectionKeys(today);
    expect(keys).toEqual(['inbox', 'on_hold', 'overdue', 'today', 'tomorrow', 'day-2026-11-13', 'day-2026-11-14', 'day-2026-11-15', 'next_week', 'next_week_1', 'next_week_2', 'later', 'internal']);
    expect(keys.map(c.sectionLabel)).toContain('Friday');
    expect(c.sectionKeys('2026-11-14')).not.toContain('day-2026-11-16'); // Saturday: tomorrow is Sunday, no day keys
  });
});

describe('calendar and mail helpers', () => {
  it('round-trips Graph date-times', () => {
    const g = c.toGraphDateTime('2026-11-13T15:00:00+01:00');
    expect(g).toEqual({ dateTime: '2026-11-13T14:00:00.0000000', timeZone: 'UTC' });
    expect(c.fromGraphDateTime(g)).toBe('2026-11-13T14:00:00.000Z');
    expect(() => c.fromGraphDateTime({ dateTime: '2026-11-13T14:00:00', timeZone: 'Pacific Standard Time' })).toThrow();
  });
  it('draftToSendMail produces a valid Graph body', () => {
    const body = c.draftToSendMail(c.MailDraft.parse({ to: [{ name: 'Lena Hartwell', address: 'lena.hartwell@acmetooling.example' }], subject: 'Notes', body: 'Hi' }));
    expect(c.GraphSendMailRequest.parse(body).message.toRecipients[0]!.emailAddress.address).toBe('lena.hartwell@acmetooling.example');
  });
  it('mimeTypeFor knows only the four POC types', () => {
    expect(c.mimeTypeFor('a.PDF')).toBe('application/pdf');
    expect(c.mimeTypeFor('a.docx')).toBeNull();
  });
});

describe('profiles', () => {
  it('slugs, renders and parses', () => {
    expect(c.profileSlug('Acme Tooling Co.')).toBe('acme-tooling-co');
    expect(c.profileSlug('Harbor & Pine')).toBe('harbor-and-pine');
    const md = c.renderProfile('Quillon Robotics', { 'Also known as': ['Quill'] });
    for (const h of c.PROFILE_HEADINGS.slice(1)) expect(md).toContain(`\n${h}\n`);
    const parsed = c.parseProfile(`${md}\n## Notes from Dana\n\n- keep this\n`);
    expect(parsed.title).toBe('Quillon Robotics');
    expect(parsed.sections['Also known as']).toBe('- Quill');
    expect(parsed.sections['Recent decisions']).toBe('- (none yet)');
    expect(parsed.extra['Notes from Dana']).toBe('- keep this');
  });
});

describe('usage', () => {
  it('summarises one day by call type', () => {
    const line = (ts: string, call: c.ClaudeCall, usd: number): c.UsageLine => ({ ts, call, model: 'm', sourceId: null, input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 2, ms: 1, estUsd: usd });
    const s = c.summariseUsage([line('2026-11-13T09:00:00Z', 'triage', 0.5), line('2026-11-13T10:00:00Z', 'chat', 0.25), line('2026-11-12T10:00:00Z', 'chat', 9)], '2026-11-13', (ts) => ts.slice(0, 10));
    expect(s.calls).toBe(2);
    expect(s.estUsd).toBeCloseTo(0.75);
    expect(s.byCall.triage?.calls).toBe(1);
    expect(c.UsageSummary.parse(s)).toEqual(s);
  });
});

describe('D1: IsoDate is a real calendar date (every user of the contract benefits)', () => {
  it('rejects impossible dates and keeps real ones, leap years included', async () => {
    const { IsoDate, CreateTaskPayload, RescheduleTaskInput, humanIssues } = await import('./index');
    for (const bad of ['2026-02-30', '2026-13-45', '2026-02-29', '2026-04-31', '2026-00-10', '2026-11-00']) expect(IsoDate.safeParse(bad).success, bad).toBe(false);
    for (const ok of ['2026-11-13', '2028-02-29', '2000-02-29', '2026-12-31']) expect(IsoDate.safeParse(ok).success, ok).toBe(true);
    expect(RescheduleTaskInput.safeParse({ taskId: 't', dueDate: '2026-13-45' }).success).toBe(false);
    const r = CreateTaskPayload.safeParse({ title: 'x', dueDate: '2026-02-30' });
    expect(r.success).toBe(false);
    if (!r.success) expect(humanIssues(r.error, { title: 'x', dueDate: '2026-02-30' })).toBe('The due date (2026-02-30) is not a real calendar date.');
  });
});

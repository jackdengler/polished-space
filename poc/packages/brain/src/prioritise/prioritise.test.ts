import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SidebarState, UsageLine, type Suggestion } from '@poc/contracts';
import type { FakeParams } from '@poc/contracts/testing';
import { makeHarness, task, TODAY, type Harness } from '../testing/harness';
import { createPrioritiseModule } from './index';
import type { PrioritiseOutput } from './prompt';

const TASKS = [
  task('t-reply', 'poc-client-acme', 'Reply to Michael with a pricing update', TODAY),
  task('t-review', 'poc-client-harborlight', 'Review the HLF driver pay structure draft', TODAY),
  task('t-later', 'poc-client-acme', 'Prepare benchmark QA notes', '2026-11-20'),
];

const answer = (over: Partial<PrioritiseOutput> = {}): PrioritiseOutput => ({
  order: [
    { taskId: 't-reply', quickWin: true, reason: 'Quick reply, Michael is waiting' },
    { taskId: 't-review', quickWin: false, reason: 'Needs a proper run before Monday' },
  ],
  fitNow: { taskId: 't-reply', sentence: "Let's get Michael his pricing update." },
  focusBlock: null,
  ...over,
});

const harnesses: Harness[] = [];
async function setup(reply: PrioritiseOutput | ((p: FakeParams) => PrioritiseOutput) = answer()) {
  const mod = createPrioritiseModule({ debounceMs: 0 });
  const h = await makeHarness({ tasks: structuredClone(TASKS), modules: [mod] });
  harnesses.push(h);
  h.claude.setDefault((p) => ({ parsed: typeof reply === 'function' ? reply(p) : reply }));
  await h.brain.tick();
  await h.brain.idle();
  return { h, mod };
}
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.brain.stop().catch(() => h.brain.idle());
});

const blocks = (h: Harness) => h.brain.suggestions.list().filter((s): s is Extract<Suggestion, { kind: 'calendar_block' }> => s.kind === 'calendar_block');
const usage = async (h: Harness) =>
  (await readFile(join(h.dataDir, 'logs/usage.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .map((l) => UsageLine.parse(JSON.parse(l)));

describe('prioritise', () => {
  it("orders Today by Claude's answer, flags quick wins, and shows both in SidebarState", async () => {
    const { h } = await setup(answer({ order: [answer().order[1]!, answer().order[0]!] }));
    expect(h.claude.calls).toHaveLength(1); // startup's task + calendar events made one debounced call
    const call = h.claude.calls[0]!;
    expect(call.method).toBe('parse');
    expect((call.params.output_config as { effort: string }).effort).toBe('low');
    const user = JSON.stringify(call.params.messages);
    expect(user).toContain('103 minutes');
    expect(user).toContain('Acme Tooling check-in');
    expect(user.split('Coming up')[0]).not.toContain('t-later'); // only Today tasks are ordered
    expect(user).toMatch(/Coming up[^]*t-later/); // later work is listed for a focus block only

    const state = SidebarState.parse(await h.brain.buildState());
    const today = state.sections.find((s) => s.key === 'today')!;
    expect(today.items.map((i) => [i.taskId, i.order, i.quickWin, i.reason])).toEqual([
      ['t-review', 0, false, 'Needs a proper run before Monday'],
      ['t-reply', 1, true, 'Quick reply, Michael is waiting'],
    ]);
    const later = state.sections.flatMap((s) => s.items).find((i) => i.taskId === 't-later')!;
    expect(later.order).toBeNull();

    const lines = await usage(h);
    expect(lines.filter((l) => l.call === 'prioritise')).toHaveLength(1);
    expect(lines[0]!.input_tokens).toBeGreaterThan(0);
  });

  it('nudges with the task that fits the gap before the next meeting, once', async () => {
    const { h, mod } = await setup();
    const fit = h.brain.nudges.list().filter((n) => n.kind === 'fit_now');
    expect(fit).toHaveLength(1);
    expect(fit[0]).toMatchObject({ taskId: 't-reply', source: { connector: 'calendar', id: 'evt-1' } });
    expect(fit[0]!.text).toMatch(/3:30pm/);
    // A forced re-run with a changed input but the same advice for the same gap does not repeat it.
    h.pm.tasks.push(task('t-new', 'poc-client-quillon', 'Confirm the job architecture call', TODAY));
    await h.brain.tick();
    await h.brain.idle();
    expect(h.claude.calls).toHaveLength(2);
    expect(h.brain.nudges.list().filter((n) => n.kind === 'fit_now')).toHaveLength(1);
    expect(mod.prioritiser()!.calls).toBe(2);
  });

  it('offers a focus block for big work due in the next few days (not only Today)', async () => {
    const { h } = await setup(answer({ focusBlock: { taskId: 't-later', minutes: 60 } }));
    const focus = blocks(h).filter((b) => b.payload.purpose === 'focus');
    expect(focus).toHaveLength(1);
    expect(focus[0]!.payload.taskId).toBe('t-later');
    expect(Date.parse(focus[0]!.payload.end) - Date.parse(focus[0]!.payload.start)).toBe(60 * 60_000);
  });

  it('D11: the gap wording comes from code, and a calendar change replaces the stale fit-now nudge', async () => {
    const { h } = await setup();
    let fit = h.brain.nudges.list().filter((n) => n.kind === 'fit_now');
    expect(fit.map((n) => n.text)).toEqual(["You've got 1 hour 43 minutes before your 3:30pm Acme Tooling check-in. Let's get Michael his pricing update."]);
    // A block approved into the gap (14:00-14:30) makes the gap 13 minutes: under the minimum, so the nudge goes.
    h.calendar.events.push({ ...h.calendar.events[0]!, id: 'evt-lunch', subject: 'Lunch', start: { dateTime: '2026-11-13T14:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-13T14:30:00.0000000', timeZone: 'UTC' } });
    await h.brain.tick();
    await h.brain.idle();
    await new Promise((r) => setTimeout(r, 20));
    await h.brain.idle();
    fit = h.brain.nudges.list().filter((n) => n.kind === 'fit_now');
    expect(fit).toEqual([]);
  });

  it('D11: when the gap shrinks but stays, the nudge is re-worded in place with the new duration', async () => {
    const { h } = await setup();
    const first = h.brain.nudges.list().find((n) => n.kind === 'fit_now')!;
    h.calendar.events.push({ ...h.calendar.events[0]!, id: 'evt-x', subject: 'Staffing sync', start: { dateTime: '2026-11-13T14:47:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-13T15:00:00.0000000', timeZone: 'UTC' } });
    await h.brain.tick();
    await h.brain.idle();
    await new Promise((r) => setTimeout(r, 20));
    await h.brain.idle();
    const fit = h.brain.nudges.list().filter((n) => n.kind === 'fit_now');
    expect(fit).toHaveLength(1);
    expect(fit[0]!.id).not.toBe(first.id); // a new meeting ends the gap: new advice replaces the old
    expect(fit[0]!.text).toBe("You've got an hour before your 2:47pm Staffing sync. Let's get Michael his pricing update.");
  });

  it('does not call Claude again when the input is unchanged', async () => {
    const { h, mod } = await setup();
    expect(h.claude.calls).toHaveLength(1);
    await mod.prioritiser()!.schedule();
    await h.brain.tick();
    await h.brain.idle();
    expect(h.claude.calls).toHaveLength(1);
    // New pending work arriving changes the input.
    await h.brain.suggestions.add({ kind: 'create_task', title: 'Send Dmitri the census checklist', nudge: 'Dmitri asked for the checklist.', clientId: 'poc-client-harborlight', clientConfidence: 'high', source: null, payload: { title: 'Send Dmitri the census checklist', dueDate: TODAY, assigneeIds: [] } });
    await mod.prioritiser()!.schedule();
    expect(h.claude.calls).toHaveLength(2);
    expect(JSON.stringify(h.claude.calls[1]!.params.messages)).toContain('Send Dmitri the census checklist');
  });

  it('repairs an order with unknown, repeated or missing ids', async () => {
    const { h } = await setup(answer({ order: [{ taskId: 't-ghost', quickWin: true, reason: 'x' }, { taskId: 't-review', quickWin: false, reason: 'first' }, { taskId: 't-review', quickWin: true, reason: 'dup' }], fitNow: { taskId: 't-ghost', sentence: 'Do the ghost task.' } }));
    expect(h.brain.taskMeta.get('t-review')).toMatchObject({ order: 0, reason: 'first', quickWin: false });
    expect(h.brain.taskMeta.get('t-reply')).toMatchObject({ order: 1, quickWin: false });
    expect(h.brain.taskMeta.get('t-ghost')).toBeNull();
    expect(h.brain.nudges.list().filter((n) => n.kind === 'fit_now')).toHaveLength(0);
  });
});

describe('time blocks', () => {
  it('offers a 30-minute lunch block, and approving it calls createEvent exactly once, in UTC', async () => {
    const { h } = await setup();
    const [lunch, ...rest] = blocks(h);
    expect(rest).toHaveLength(0);
    expect(lunch).toMatchObject({ status: 'pending', payload: { purpose: 'lunch', start: '2026-11-13T14:00:00.000Z', end: '2026-11-13T14:30:00.000Z' } });
    expect(Date.parse(lunch!.payload.end) - Date.parse(lunch!.payload.start)).toBe(30 * 60_000);
    expect(h.writes).toEqual([]); // nothing written before approval

    const done = await h.brain.approve(lunch!.id, {});
    expect(done.status).toBe('applied');
    await h.brain.idle();
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]).toMatchObject({ method: 'createEvent', approval: lunch!.id });
    expect(h.calendar.created).toHaveLength(1);
    expect(h.calendar.created[0]).toMatchObject({ subject: 'Lunch', start: { dateTime: '2026-11-13T14:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-13T14:30:00.0000000', timeZone: 'UTC' } });

    // The calendar change re-runs prioritise; lunch now exists, so nothing new is offered.
    await h.brain.tick();
    await h.brain.idle();
    expect(blocks(h)).toHaveLength(1);
    expect(h.writes).toHaveLength(1);
  });

  it('does not re-suggest a lunch block denied today', async () => {
    const { h, mod } = await setup();
    const lunch = blocks(h)[0]!;
    await h.brain.deny(lunch.id);
    await h.brain.idle();
    h.pm.tasks.push(task('t-new', 'poc-client-quillon', 'Confirm the job architecture call', TODAY));
    await h.brain.tick();
    await h.brain.idle();
    await mod.prioritiser()!.run();
    expect(blocks(h)).toHaveLength(1);
    expect(blocks(h)[0]!.status).toBe('denied');
    expect(h.writes).toEqual([]);
  });

  it('does not offer lunch when it is already on the calendar', async () => {
    const mod = createPrioritiseModule({ debounceMs: 0 });
    const h = await makeHarness({ tasks: structuredClone(TASKS), modules: [mod] });
    harnesses.push(h);
    h.calendar.events.push({ ...h.calendar.events[0]!, id: 'evt-lunch', subject: 'Lunch', start: { dateTime: '2026-11-13T12:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-13T12:30:00.0000000', timeZone: 'UTC' } });
    h.claude.setDefault({ parsed: answer() });
    await h.brain.tick();
    await h.brain.idle();
    expect(blocks(h)).toHaveLength(0);
  });

  it('proposes focus time for the big task, after the pending lunch hold, and not twice', async () => {
    const { h, mod } = await setup(answer({ focusBlock: { taskId: 't-review', minutes: 60 } }));
    const focus = blocks(h).filter((b) => b.payload.purpose === 'focus');
    expect(focus).toHaveLength(1);
    expect(focus[0]).toMatchObject({ clientId: 'poc-client-harborlight', payload: { taskId: 't-review', start: '2026-11-13T14:30:00.000Z', end: '2026-11-13T15:30:00.000Z', subject: 'Focus: Review the HLF driver pay structure draft' } });

    await h.brain.deny(focus[0]!.id);
    await h.brain.idle();
    h.pm.tasks.push(task('t-new', 'poc-client-quillon', 'Confirm the job architecture call', TODAY));
    await h.brain.tick();
    await h.brain.idle();
    expect(h.claude.calls.length).toBeGreaterThanOrEqual(2);
    expect(blocks(h).filter((b) => b.payload.purpose === 'focus')).toHaveLength(1); // denied today: not re-suggested
    await mod.prioritiser()!.run();
    expect(h.writes).toEqual([]);
  });

  it('still offers lunch when Claude is unavailable, and writes nothing', async () => {
    const mod = createPrioritiseModule({ debounceMs: 0 });
    const h = await makeHarness({ tasks: structuredClone(TASKS), modules: [mod] });
    harnesses.push(h);
    h.claude.setDefault({ stop_reason: 'refusal', parsed: null });
    await h.brain.tick();
    await h.brain.idle();
    expect(blocks(h)).toHaveLength(1);
    expect(h.brain.taskMeta.get('t-reply')?.order ?? null).toBeNull();
    expect(h.logs.some((l) => l.includes('prioritise skipped'))).toBe(true);
    expect(h.writes).toEqual([]);
  });
});

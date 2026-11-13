import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SidebarState, Suggestion, UsageLine } from '@poc/contracts';
import { WriteOutsideApprovalError } from './guard';
import type { BrainModule, MessageTriagedEvent } from './modules/types';
import { makeHarness, michaelMail, MARCUS, PRIYA, task, triage, type Harness } from './testing/harness';

const harnesses: Harness[] = [];
async function harness(...args: Parameters<typeof makeHarness>) {
  const h = await makeHarness(...args);
  harnesses.push(h);
  return h;
}
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.brain.idle();
});

async function usageLines(h: Harness): Promise<UsageLine[]> {
  try {
    const text = await readFile(join(h.dataDir, 'logs/usage.jsonl'), 'utf8');
    return text.trim().split('\n').filter(Boolean).map((l) => UsageLine.parse(JSON.parse(l)));
  } catch {
    return [];
  }
}

const pending = (h: Harness) => h.brain.suggestions.list().filter((s) => s.status === 'pending');

describe('intake -> suggestions -> approve', () => {
  it('turns new mail into client-tagged suggestions, and approve calls create_task exactly once', async () => {
    const h = await harness();
    h.claude.enqueue({ parsed: triage() });
    const msg = h.mail.deliver(michaelMail);
    await h.brain.tick();

    const sugs = pending(h);
    expect(sugs).toHaveLength(2);
    for (const s of sugs) {
      expect(s.kind).toBe('create_task');
      expect(s.clientId).toBe('poc-client-acme');
      expect(s.clientConfidence).toBe('high');
      expect(s.source).toMatchObject({ connector: 'mail', id: msg.id, threadId: msg.conversationId });
      expect(s.nudge).not.toBe(msg.subject);
    }
    expect(sugs.map((s) => s.taskType).sort()).toEqual(['reply_email', 'schedule_meeting']);
    expect(h.brain.nudges.list()[0]).toMatchObject({ kind: 'new_item', suggestionIds: sugs.map((s) => s.id) });
    expect(h.writes).toEqual([]);

    const reply = sugs.find((s) => s.taskType === 'reply_email')!;
    const done = await h.brain.approve(reply.id, {});
    expect(done.status).toBe('applied');
    const creates = h.writes.filter((w) => w.method === 'createTask');
    expect(creates).toHaveLength(1);
    expect(creates[0]!.args).toEqual({ clientId: 'poc-client-acme', title: 'Reply to Michael with a pricing update', dueDate: '2026-11-16', assigneeIds: ['poc-member-alex'] });
    expect(h.pm.writeCalls.map((c) => c.tool)).toEqual(['create_task']);

    const newTask = h.pm.tasks[0]!;
    expect(h.brain.taskMeta.get(newTask.id)).toMatchObject({ source: { connector: 'mail', id: msg.id }, direction: 'i_owe', taskType: 'reply_email' });

    // Approving again is refused and does not write again.
    await expect(h.brain.approve(reply.id, {})).rejects.toMatchObject({ status: 409 });
    expect(h.pm.writeCalls).toHaveLength(1);
  });

  it('deny calls nothing', async () => {
    const h = await harness();
    h.claude.enqueue({ parsed: triage() });
    h.mail.deliver(michaelMail);
    await h.brain.tick();
    const [a, b] = pending(h);
    expect((await h.brain.deny(a!.id)).status).toBe('denied');
    expect((await h.brain.deny(b!.id)).status).toBe('denied');
    await h.brain.idle();
    expect(h.writes).toEqual([]);
    expect(h.pm.writeCalls).toEqual([]);
    expect(h.mail.sent).toEqual([]);
    expect(h.calendar.created).toEqual([]);
  });

  it('the same message id twice yields one set of suggestions (also across a restart and a re-drop)', async () => {
    const h = await harness();
    h.claude.setDefault({ parsed: triage() });
    const msg = h.mail.deliver(michaelMail);
    // A mail source that ignores the cursor, so the same id is seen on every poll.
    const sloppy = h.mail.listSince.bind(h.mail);
    h.mail.listSince = async () => sloppy('');
    await h.brain.tick();
    await h.brain.tick();
    expect(h.claude.calls).toHaveLength(1);
    expect(pending(h)).toHaveLength(2);
    await h.brain.intake.handleMail(msg); // handled again directly: fingerprint/processed check
    expect(h.claude.calls).toHaveLength(1);

    // Restart on the same data dir: processed ids persist.
    const h2 = await harness({ dataDir: h.dataDir });
    h2.claude.setDefault({ parsed: triage() });
    h2.mail.messages.push(msg);
    h2.mail.listSince = async () => ({ items: [msg], cursor: msg.receivedDateTime });
    await h2.brain.tick();
    expect(h2.claude.calls).toHaveLength(0);

    // The same email dropped in again under a new id is recognised by content.
    h.mail.deliver(michaelMail);
    await h.brain.tick();
    expect(h.claude.calls).toHaveLength(1);
    expect(h.brain.suggestions.list()).toHaveLength(2);
  });

  it('skips messages sent by me, and seeded history before the intake cursor', async () => {
    const h = await harness();
    h.mail.deliver({ ...michaelMail, receivedDateTime: '2026-11-12T10:00:00.000Z' });
    h.chat.deliver({ sender: 'alex.rivera@brightline-advisory.example', sender_display_name: 'Alex Rivera', message: 'Thanks Priya!' });
    await h.brain.tick();
    expect(h.claude.calls).toHaveLength(0);
  });
});

describe('approval is the only write path', () => {
  it('a spy sees no write outside an approved suggestion, across a whole session', async () => {
    const triaged: MessageTriagedEvent[] = [];
    const sneaky: BrainModule = {
      name: 'sneaky',
      onMessageTriaged: (e) => void triaged.push(e),
      onTick: () => {},
    };
    const h = await harness({ modules: [sneaky], tasks: [task('t-1', 'poc-client-acme', 'Revise the SOW', '2026-11-13')] });
    h.claude.setDefault((params) => {
      const text = JSON.stringify(params.messages);
      if (text.includes('Harbor')) return { parsed: triage({ clientId: 'poc-client-harborlight', tasks: [{ title: 'Review the HLF driver pay draft', direction: 'i_owe', taskType: 'review_file', dueDate: '2026-11-19', duplicateOf: null }] }) };
      if (text.includes('robo team')) return { parsed: triage({ clientId: 'poc-client-quillon', confidence: 'low', alias: 'the robo team', tasks: [{ title: 'Check on the revised levels', direction: 'i_owe', taskType: 'follow_up', dueDate: null, duplicateOf: null }] }) };
      return { parsed: triage() };
    });
    h.mail.deliver(michaelMail);
    h.chat.deliver({ ...PRIYA, message: 'Harbor sent over "HLF Driver Pay Structure Draft.pdf". Can you read it before Thursday?' });
    h.chat.deliver({ ...MARCUS, message: 'The robo team asked again whether the revised levels are coming.' });
    for (let i = 0; i < 3; i++) await h.brain.tick();
    await h.brain.intake.submitText('add a task to chase Michael on Friday', 'manual');
    await h.brain.buildState();
    await h.brain.setHold('t-1', true);
    await h.brain.idle();
    expect(triaged.length).toBe(4);
    expect(h.writes).toEqual([]); // nothing has been approved yet: nothing written

    const sugs = pending(h);
    const toDeny = sugs.find((s) => s.kind === 'create_task' && s.taskType === 'schedule_meeting')!;
    await h.brain.deny(toDeny.id);
    const approved: string[] = [];
    for (const s of pending(h).filter((x) => x.kind === 'create_task' && x.clientId)) {
      await h.brain.approve(s.id, {});
      approved.push(s.id);
    }
    // Manually added suggestions of the other write kinds, approved too.
    const more = await Promise.all([
      h.brain.suggestions.add({ kind: 'complete_task', title: 'Close the SOW task', nudge: 'Done?', clientId: 'poc-client-acme', clientConfidence: 'high', source: null, payload: { taskId: 't-1' } }),
      h.brain.suggestions.add({ kind: 'reschedule_task', title: 'Move it', nudge: 'Move?', clientId: 'poc-client-acme', clientConfidence: 'high', source: null, payload: { taskId: 't-1', dueDate: '2026-11-20' } }),
      h.brain.suggestions.add({ kind: 'calendar_block', title: 'Lunch', nudge: 'Lunch?', clientId: null, clientConfidence: 'high', source: null, payload: { subject: 'Lunch', start: '2026-11-13T12:00:00.000Z', end: '2026-11-13T12:30:00.000Z', purpose: 'lunch', taskId: null } }),
      h.brain.suggestions.add({ kind: 'send_reply', title: 'Reply', nudge: 'Send?', clientId: 'poc-client-acme', clientConfidence: 'high', source: null, payload: { draft: { to: [{ name: 'Michael Okafor', address: 'michael.okafor@acmetooling.example' }], cc: [], subject: 'Re: pricing', body: 'Hi Michael', replyToMessageId: null }, taskId: null } }),
    ]);
    for (const s of more) {
      await h.brain.approve(s.id, {});
      approved.push(s.id);
    }
    for (let i = 0; i < 3; i++) await h.brain.tick();
    await h.brain.idle();

    expect(h.writes.length).toBeGreaterThan(0);
    for (const w of h.writes) expect(approved).toContain(w.approval);
    expect(new Set(h.writes.map((w) => w.method))).toEqual(new Set(['createTask', 'completeTask', 'rescheduleTask', 'createEvent', 'sendMail']));
    expect(h.writes.filter((w) => w.approval === toDeny.id)).toEqual([]);
  });

  it('the guard refuses a write made outside an approval', async () => {
    const h = await harness();
    const writes = (h.brain as unknown as { writes: import('./guard').Connectors }).writes;
    await expect(writes.pm.createTask({ clientId: 'poc-client-acme', title: 'x' })).rejects.toBeInstanceOf(WriteOutsideApprovalError);
    await expect(writes.mail.send({ to: [{ name: 'A', address: 'a@acmetooling.example' }], cc: [], subject: 's', body: 'b', replyToMessageId: null })).rejects.toBeInstanceOf(WriteOutsideApprovalError);
    await expect(writes.calendar.createEvent({ subject: 's', start: { dateTime: '2026-11-13T12:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-13T12:30:00.0000000', timeZone: 'UTC' }, attendees: [], showAs: 'busy', categories: [] })).rejects.toBeInstanceOf(WriteOutsideApprovalError);
    await expect(writes.pm.completeTask('t')).rejects.toBeInstanceOf(WriteOutsideApprovalError);
    await expect(writes.pm.rescheduleTask('t', null)).rejects.toBeInstanceOf(WriteOutsideApprovalError);
    expect(h.writes).toEqual([]);
  });

  it('module hooks fired after an approval do not inherit its permission', async () => {
    let hookError: unknown = null;
    const h0 = { writes: null as null | import('./guard').Connectors };
    const mod: BrainModule = {
      name: 'tries-to-write',
      async onSuggestionApplied() {
        try {
          await h0.writes!.pm.createTask({ clientId: 'poc-client-acme', title: 'sneaky' });
        } catch (err) {
          hookError = err;
        }
      },
    };
    const h = await harness({ modules: [mod] });
    h0.writes = (h.brain as unknown as { writes: import('./guard').Connectors }).writes;
    const s = await h.brain.suggestions.add({ kind: 'create_task', title: 'Real one', nudge: 'n', clientId: 'poc-client-acme', clientConfidence: 'high', source: null, payload: { title: 'Real one', dueDate: null, assigneeIds: [] } });
    await h.brain.approve(s.id, {});
    await h.brain.idle();
    expect(hookError).toBeInstanceOf(WriteOutsideApprovalError);
    expect(h.writes.map((w) => w.args)).toEqual([{ clientId: 'poc-client-acme', title: 'Real one', dueDate: null, assigneeIds: ['poc-member-alex'] }]);
  });
});

describe('usage log and spend cap', () => {
  it('writes one usage line per Claude call', async () => {
    const h = await harness();
    h.claude.setDefault({ parsed: triage(), usage: { input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 2000, cache_read_input_tokens: 0 } });
    h.mail.deliver(michaelMail);
    h.chat.deliver({ ...PRIYA, message: 'Acme wants the matches by Monday.' });
    await h.brain.tick();
    await h.brain.intake.submitText('chase Michael on Friday', 'manual');
    const lines = await usageLines(h);
    expect(lines).toHaveLength(h.claude.calls.length);
    expect(lines).toHaveLength(3);
    for (const l of lines) {
      expect(l).toMatchObject({ call: 'triage', model: 'claude-sonnet-5-5', input_tokens: 1200, output_tokens: 300, cache_creation_input_tokens: 2000, cache_read_input_tokens: 0 });
      // 1200*2 + 300*10 + 2000*2*2 (1h write) = 13400 per million
      expect(l.estUsd).toBeCloseTo(0.0134, 6);
    }
    expect(lines.map((l) => l.sourceId)).toEqual([expect.stringMatching(/^fake-mail-/), expect.stringMatching(/^fake-chat-/), expect.stringMatching(/^manual-/)]);
    const res = h.brain.usage.response();
    expect(res.today.calls).toBe(3);
    expect(res.today.byCall.triage?.calls).toBe(3);
  });

  it('halts calls once the daily cap is reached, without losing the message', async () => {
    const h = await harness({ maxUsdPerDay: 0.005 });
    h.claude.setDefault({ parsed: triage() }); // default usage: 1000 in / 200 out = $0.004 on Sonnet
    h.mail.deliver(michaelMail);
    h.mail.deliver({ ...michaelMail, subject: 'Second', body: 'Another one about pricing.' });
    h.mail.deliver({ ...michaelMail, subject: 'Third', body: 'And another about pricing.' });
    await h.brain.tick();
    expect(h.claude.calls).toHaveLength(2); // $0.004 < cap, $0.008 >= cap -> third refused
    expect(await usageLines(h)).toHaveLength(2);
    expect(h.brain.nudges.list().some((n) => n.kind === 'info' && /budget/.test(n.text))).toBe(true);
    const third = h.mail.messages[2]!;
    expect(h.brain.cursors.isProcessed('mail', third.id)).toBe(false);
    await expect(h.brain.intake.submitText('chase Michael', 'manual')).rejects.toMatchObject({ name: 'SpendCapError' });
    expect(h.claude.calls).toHaveLength(2);
  });
});

describe('stop reasons', () => {
  it('a refusal yields no suggestions, is logged, and the item is not retried', async () => {
    const h = await harness();
    h.claude.enqueue({ stop_reason: 'refusal', content: [] });
    h.mail.deliver(michaelMail);
    await h.brain.tick();
    await h.brain.tick();
    expect(h.claude.calls).toHaveLength(1);
    expect(h.brain.suggestions.list()).toEqual([]);
    expect(await usageLines(h)).toHaveLength(1);
    expect(h.brain.nudges.list()[0]).toMatchObject({ kind: 'info' });
  });

  it('max_tokens yields no half-read output', async () => {
    const h = await harness();
    h.claude.enqueue({ stop_reason: 'max_tokens', parsed: triage() });
    h.mail.deliver(michaelMail);
    await h.brain.tick();
    expect(h.brain.suggestions.list()).toEqual([]);
    expect(h.brain.nudges.list()[0]!.text).toMatch(/cut off/);
    h.claude.enqueue({ stop_reason: 'max_tokens', parsed: triage() });
    await expect(h.brain.intake.submitText('chase Michael', 'manual')).rejects.toMatchObject({ name: 'ClaudeMaxTokensError' });
  });

  it('a transport error leaves the message for the next poll', async () => {
    const h = await harness();
    h.claude.enqueue({ error: new Error('connection reset') });
    const m = h.mail.deliver(michaelMail);
    await h.brain.tick();
    expect(h.brain.cursors.isProcessed('mail', m.id)).toBe(false);
    expect(await usageLines(h)).toHaveLength(1); // the attempt is logged, with zero tokens
  });
});

describe('client confidence', () => {
  it('a low-confidence match goes to the Inbox as confirm_client, and approving it sets the client', async () => {
    const h = await harness();
    h.claude.enqueue({ parsed: triage({ clientId: null, confidence: 'high', alias: 'the robo crew', tasks: [{ title: 'Answer the levels question', direction: 'i_owe', taskType: 'other', dueDate: null, duplicateOf: null }], profileEdits: [{ section: 'Recent decisions', op: 'add', text: 'x' }] }) });
    h.chat.deliver({ ...MARCUS, message: 'The robo crew asked whether the levels are coming. Quill wants to know too.' });
    await h.brain.tick();
    const sugs = pending(h);
    const confirm = sugs.find((s) => s.kind === 'confirm_client')!;
    const related = sugs.find((s) => s.kind === 'create_task')!;
    expect(related.clientConfidence).toBe('low');
    expect(confirm).toMatchObject({ clientConfidence: 'low', payload: { alias: 'the robo crew', relatedSuggestionIds: [related.id], candidateClientIds: ['poc-client-quillon'] } });

    const state = await h.brain.buildState();
    expect(state.suggestions.map((s) => s.id)).toContain(confirm.id);

    // Approving the task first is refused: it has no client yet.
    await expect(h.brain.approve(related.id, {})).rejects.toMatchObject({ status: 400 });
    // Exactly one candidate: approve without picking uses it.
    expect((await h.brain.approve(confirm.id, {})).status).toBe('applied');
    expect(h.brain.suggestions.get(related.id)).toMatchObject({ clientId: 'poc-client-quillon', clientConfidence: 'high', status: 'pending' });
    expect(h.writes).toEqual([]);
  });

  it('confirm_client with several candidates needs edits.clientId', async () => {
    const h = await harness();
    h.claude.enqueue({ parsed: triage({ clientId: 'poc-client-acme', confidence: 'low', tasks: [{ title: 'Send the matches', direction: 'i_owe', taskType: 'other', dueDate: null, duplicateOf: null }] }) });
    h.chat.deliver({ ...PRIYA, message: 'Acme or Harbor wants the matches, not sure which.' });
    await h.brain.tick();
    const confirm = pending(h).find((s) => s.kind === 'confirm_client')!;
    expect(confirm.kind === 'confirm_client' && confirm.payload.candidateClientIds.length).toBeGreaterThan(1);
    await expect(h.brain.approve(confirm.id, {})).rejects.toMatchObject({ status: 400 });
    await expect(h.brain.approve(confirm.id, { edits: { clientId: 'poc-client-nope' } })).rejects.toMatchObject({ status: 400 });
    expect((await h.brain.approve(confirm.id, { edits: { clientId: 'poc-client-harborlight' } })).clientId).toBe('poc-client-harborlight');
  });
});

describe('edits, failures, typed input', () => {
  it('applies edits and re-validates them', async () => {
    const h = await harness();
    h.claude.enqueue({ parsed: triage() });
    h.mail.deliver(michaelMail);
    await h.brain.tick();
    const s = pending(h)[0]!;
    await expect(h.brain.approve(s.id, { edits: { payload: { dueDate: 'Friday' } } })).rejects.toMatchObject({ status: 400 });
    await expect(h.brain.approve(s.id, { edits: { title: '' } })).rejects.toMatchObject({ status: 400 });
    expect(h.brain.suggestions.get(s.id)!.status).toBe('pending');
    expect(h.writes).toEqual([]);

    const done = await h.brain.approve(s.id, { edits: { title: 'Send Michael the pricing status', clientId: 'poc-client-harborlight', payload: { dueDate: '2026-11-20' } } });
    expect(done).toMatchObject({ status: 'applied', title: 'Send Michael the pricing status', clientId: 'poc-client-harborlight', payload: { title: 'Send Michael the pricing status', dueDate: '2026-11-20' } });
    expect(h.writes[0]!.args).toMatchObject({ clientId: 'poc-client-harborlight', title: 'Send Michael the pricing status', dueDate: '2026-11-20' });
  });

  it('edits a send_reply draft and sends exactly the edited text', async () => {
    const h = await harness({ tasks: [task('t-9', 'poc-client-acme', 'Reply to Michael', '2026-11-13')] });
    const draft = { to: [{ name: 'Michael Okafor', address: 'michael.okafor@acmetooling.example' }], cc: [], subject: 'Re: pricing', body: 'Draft body', replyToMessageId: null };
    const s = await h.brain.suggestions.add({ kind: 'send_reply', title: 'Reply', nudge: 'Send?', clientId: 'poc-client-acme', clientConfidence: 'high', source: null, payload: { draft, taskId: 't-9' } });
    await h.brain.approve(s.id, { edits: { payload: { draft: { ...draft, body: 'Edited body' } } } });
    expect(h.mail.sent.map((x) => x.draft.body)).toEqual(['Edited body']);
    expect(h.pm.writeCalls).toEqual([{ tool: 'complete_task', args: { taskId: 't-9' } }]);
  });

  it('marks a failed action failed, surfaces it, and never retries it', async () => {
    const h = await harness({ fail: { createTask: new Error('pm-server unavailable') } });
    h.claude.enqueue({ parsed: triage() });
    h.mail.deliver(michaelMail);
    await h.brain.tick();
    const s = pending(h)[0]!;
    const failed = await h.brain.approve(s.id, {});
    expect(failed).toMatchObject({ status: 'failed', error: 'pm-server unavailable' });
    expect(h.brain.nudges.list()[0]).toMatchObject({ kind: 'info', suggestionIds: [s.id] });
    const state = await h.brain.buildState();
    expect(state.suggestions.find((x) => x.id === s.id)).toMatchObject({ status: 'failed', error: 'pm-server unavailable' });
    for (let i = 0; i < 3; i++) await h.brain.tick();
    await h.brain.idle();
    expect(h.writes.filter((w) => w.method === 'createTask')).toHaveLength(1);
    expect(Suggestion.parse(h.brain.suggestions.get(s.id)).status).toBe('failed');
  });

  it('typed input goes through the same triage with source manual', async () => {
    const h = await harness();
    h.claude.enqueue({ parsed: triage({ nudge: 'Got it.', tasks: [{ title: 'Chase Michael', direction: 'i_owe', taskType: 'follow_up', dueDate: '2026-11-20', duplicateOf: null }] }) });
    const out = await h.brain.intake.submitText('add a task to chase Michael on Friday', 'manual');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'create_task', taskType: 'follow_up', clientId: 'poc-client-acme', source: { connector: 'manual' }, payload: { dueDate: '2026-11-20' } });
    const call = h.claude.calls[0]!;
    expect(call.method).toBe('parse');
    expect(JSON.stringify(call.params.messages)).toContain('add a task to chase Michael on Friday');
  });
});

describe('triage sanity checks', () => {
  it('drops unknown client ids, bad dates and dangling duplicate refs', async () => {
    const h = await harness({ tasks: [task('t-1', 'poc-client-acme', 'Reply to Michael', '2026-11-14')] });
    h.claude.enqueue({
      parsed: triage({
        clientId: 'poc-client-made-up',
        tasks: [
          { title: 'Reply to Michael', direction: 'i_owe', taskType: 'reply_email', dueDate: '2026-13-45', duplicateOf: { kind: 'task', id: 't-1' } },
          { title: 'Something', direction: 'owed_to_me', taskType: 'other', dueDate: 'next week', duplicateOf: { kind: 'suggestion', id: 'nope' } },
        ],
      }),
    });
    h.mail.deliver(michaelMail);
    await h.brain.tick();
    const tasks = pending(h).filter((s) => s.kind === 'create_task');
    expect(tasks.map((t) => [t.clientId, t.clientConfidence, t.kind === 'create_task' && t.payload.dueDate, t.duplicateOf])).toEqual([
      [null, 'low', null, { kind: 'task', id: 't-1' }],
      [null, 'low', null, null],
    ]);
    expect(pending(h).some((s) => s.kind === 'confirm_client')).toBe(true);
  });
});

describe('state', () => {
  it('builds every section from list_tasks + overlay, with hold and Internal', async () => {
    const h = await harness({
      tasks: [
        task('t-over', 'poc-client-acme', 'Overdue thing', '2026-11-10'),
        task('t-today', 'poc-client-acme', 'Today thing', '2026-11-13'),
        task('t-today2', 'poc-client-harborlight', 'Another today', '2026-11-13'),
        task('t-tom', 'poc-client-quillon', 'Tomorrow thing', '2026-11-14'),
        task('t-next', 'poc-client-acme', 'Next week thing', '2026-11-18'),
        task('t-undated', 'poc-client-acme', 'No date', null),
        task('t-int', 'poc-client-internal', 'Timesheet', '2026-11-13'),
        task('t-held', 'poc-client-acme', 'Held', '2026-11-13'),
        task('t-other', 'poc-client-acme', 'Someone else', '2026-11-13', 'poc-member-priya'),
      ],
    });
    await h.brain.taskMeta.upsert('t-today2', { order: 0, quickWin: true, reason: 'quick' });
    await h.brain.taskMeta.upsert('t-today', { order: 1 });
    await h.brain.setHold('t-held', true);
    const s = SidebarState.parse(await h.brain.buildState());
    const sec = Object.fromEntries(s.sections.map((x) => [x.key, x.items.map((i) => i.taskId)]));
    expect(s.sections.map((x) => x.key)).toEqual(['inbox', 'on_hold', 'overdue', 'today', 'tomorrow', 'day-2026-11-15', 'next_week', 'next_week_1', 'next_week_2', 'later', 'internal']);
    expect(sec).toMatchObject({ inbox: ['t-undated'], on_hold: ['t-held'], overdue: ['t-over'], today: ['t-today2', 't-today'], tomorrow: ['t-tom'], next_week: ['t-next'], internal: ['t-int'] });
    expect(s.sections.find((x) => x.key === 'today')!.items[0]).toMatchObject({ quickWin: true, order: 0 });
    expect(s.calendarToday.map((e) => e.id)).toEqual(['evt-1']);
    expect(s.today).toBe('2026-11-13');
    expect(JSON.stringify(s)).not.toContain('t-other');
    await expect(h.brain.setHold('t-missing', true)).rejects.toMatchObject({ status: 404 });
  });
});

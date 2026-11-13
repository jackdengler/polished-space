import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PATHS, ProfileDoc, ProfileListResponse } from '@poc/contracts';
import type { BrainModule, MessageTriagedEvent } from '../modules/types';
import { makeHarness, MARCUS, michaelMail, NOW, PRIYA, triage, type Harness } from '../testing/harness';
import { sectionBullets } from './edit';
import { createProfilesModule } from './index';

const harnesses: Harness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.brain.idle();
});

async function setup(extra: BrainModule[] = []) {
  const mod = createProfilesModule();
  const h = await makeHarness({ modules: [mod, ...extra] });
  harnesses.push(h);
  const file = (slug: string) => join(h.dataDir, 'profiles', `${slug}.md`);
  const read = (slug: string) => readFile(file(slug), 'utf8');
  return { h, mod, file, read };
}

const pending = (h: Harness) => h.brain.suggestions.list().filter((s) => s.status === 'pending');

describe('profiles module', () => {
  it('applies triage profileEdits under the right heading, keeps a hand-added line, logs with the fixed clock', async () => {
    const { h, file, read } = await setup();
    await writeFile(file('acme-tooling-co'), (await read('acme-tooling-co')).replace('- Michael Okafor (VP HR): sponsor\n', '- Michael Okafor (VP HR): sponsor\n- Lena Hartwell: added by hand, keep me\n'));

    h.claude.enqueue({ parsed: triage({ profileEdits: [{ section: 'Commitments: we owe', op: 'add', text: 'Pricing update to Michael' }, { section: 'Preferences and quirks', op: 'add', text: 'Michael wants 45-minute meetings' }] }) });
    h.mail.deliver(michaelMail);
    await h.brain.tick();
    await h.brain.idle();

    const md = await read('acme-tooling-co');
    expect(sectionBullets(md, 'Commitments: we owe')).toEqual(['Pricing update to Michael']);
    expect(sectionBullets(md, 'Preferences and quirks')).toEqual(['Michael wants 45-minute meetings']);
    expect(md).toContain('- Lena Hartwell: added by hand, keep me');
    const log = sectionBullets(md, 'Change log');
    expect(log).toHaveLength(2);
    expect(log[0]).toMatch(new RegExp(`^${NOW.replace(/[.]/g, '\\.')}: added to Commitments: we owe: "Pricing update to Michael" \\(source: Email from Michael Okafor: `));

    // A hand edit made now survives the next update too.
    await writeFile(file('acme-tooling-co'), md.replace('## Recent decisions\n\n- (none yet)', '## Recent decisions\n\n- Hand-written decision'));
    h.claude.enqueue({ parsed: triage({ tasks: [], profileEdits: [{ section: 'Recent decisions', op: 'add', text: 'Effective date stays 1 January' }] }) });
    h.mail.deliver({ ...michaelMail, subject: 'Effective date', body: 'Let us keep 1 January.' });
    await h.brain.tick();
    await h.brain.idle();
    const md2 = await read('acme-tooling-co');
    expect(sectionBullets(md2, 'Recent decisions')).toEqual(['Hand-written decision', 'Effective date stays 1 January']);
    expect(md2).toContain('- Lena Hartwell: added by hand, keep me');
  });

  it('ignores edits for a low-confidence or Internal match', async () => {
    const { h, read } = await setup();
    const before = await read('acme-tooling-co');
    h.claude.enqueue({ parsed: triage({ confidence: 'low', profileEdits: [{ section: 'Recent decisions', op: 'add', text: 'Should not land' }] }) });
    h.chat.deliver({ ...PRIYA, message: 'Acme maybe wants something?' });
    await h.brain.tick();
    await h.brain.idle();
    expect(await read('acme-tooling-co')).toBe(before);
  });

  it('a confirmed nickname lands under "Also known as" in the right file, and the NEXT pre-match finds the client by it', async () => {
    const seen: MessageTriagedEvent[] = [];
    const spy: BrainModule = { name: 'spy', onMessageTriaged: (e) => void seen.push(e) };
    const { h, read } = await setup([spy]);

    // 1. Only an unfamiliar nickname: no pre-match signal, so Claude is unsure.
    h.claude.enqueue({
      parsed: triage({ clientId: null, confidence: 'low', alias: 'the gearbox crew', profileEdits: [], tasks: [{ title: 'Review the driver pay file', direction: 'i_owe', taskType: 'review_file', dueDate: null, duplicateOf: null }] }),
    });
    h.chat.deliver({ ...MARCUS, message: 'The gearbox crew sent the driver pay file. Can you look at it?' });
    await h.brain.tick();
    await h.brain.idle();
    expect(seen[0]!.candidates).toEqual([]);
    const confirm = pending(h).find((s) => s.kind === 'confirm_client')!;
    expect(confirm.payload).toMatchObject({ alias: 'the gearbox crew' });

    // 2. The user picks Harborlight. It had no profile file yet: one is started.
    await h.brain.approve(confirm.id, { edits: { clientId: 'poc-client-harborlight' } });
    await h.brain.idle();
    const hl = await read('harborlight-freight');
    expect(hl.startsWith('# Harborlight Freight\n')).toBe(true);
    expect(sectionBullets(hl, 'Also known as')).toEqual(['the gearbox crew']);
    expect(sectionBullets(hl, 'Change log')[0]).toContain('You confirmed "the gearbox crew" means Harborlight Freight');
    expect(sectionBullets(await read('acme-tooling-co'), 'Also known as')).toEqual(['Acme', 'ATC']);
    expect(sectionBullets(await read('quillon-robotics'), 'Also known as')).toEqual(['Quill', 'the robo team']);
    expect(h.writes).toEqual([]); // learning shorthand writes nothing outside

    // 3. The next message uses only the nickname: the real intake pre-match now finds Harborlight.
    h.claude.enqueue({ parsed: triage({ clientId: 'poc-client-harborlight', tasks: [], profileEdits: [] }) });
    h.chat.deliver({ ...PRIYA, message: 'the gearbox crew want a call on Tuesday' });
    await h.brain.tick();
    await h.brain.idle();
    const next = seen[1]!;
    expect(next.candidates[0]).toMatchObject({ clientId: 'poc-client-harborlight' });
    expect(next.candidates[0]!.reasons).toContain('learned shorthand "the gearbox crew"');
    // ...and Claude was shown Harborlight's profile and the learned shorthand in the roster.
    const sent = JSON.stringify(h.claude.calls[1]!.params);
    expect(sent).toContain('<profile clientId=\\"poc-client-harborlight\\">');
    expect(sent).toContain('learnedShorthand');
    expect(sent).toContain('the gearbox crew');

    // Approving the same alias again (another message) adds no duplicate line.
    h.claude.enqueue({ parsed: triage({ clientId: null, confidence: 'low', alias: 'The Gearbox Crew', profileEdits: [] }) });
    h.chat.deliver({ ...MARCUS, message: 'Something from The Gearbox Crew and maybe Acme' });
    await h.brain.tick();
    await h.brain.idle();
    const again = pending(h).find((s) => s.kind === 'confirm_client')!;
    await h.brain.approve(again.id, { edits: { clientId: 'poc-client-harborlight' } });
    await h.brain.idle();
    expect(sectionBullets(await read('harborlight-freight'), 'Also known as')).toEqual(['the gearbox crew']);
  });

  it('after approvals: a task becomes a commitment; reschedule, focus time and the sent reply update that line; one profile call reads the reply', async () => {
    const { h, read } = await setup();
    h.claude.enqueue({ parsed: triage({ profileEdits: [] }) });
    h.mail.deliver(michaelMail);
    await h.brain.tick();
    const [reply, meeting] = ['reply_email', 'schedule_meeting'].map((t) => pending(h).find((s) => s.taskType === t)!);
    await h.brain.approve(reply!.id, {});
    await h.brain.approve(meeting!.id, {});
    await h.brain.idle();
    let md = await read('acme-tooling-co');
    expect(sectionBullets(md, 'Commitments: we owe')).toEqual(['Reply to Michael with a pricing update (due 2026-11-16)', 'Set up a 45-minute call with Michael']);
    const taskId = h.pm.tasks.find((t) => t.title.startsWith('Reply to Michael'))!.id;

    const resched = await h.brain.suggestions.add({ kind: 'reschedule_task', title: 'Move the reply to Tuesday', nudge: '', clientId: 'poc-client-acme', clientConfidence: 'high', source: null, payload: { taskId, dueDate: '2026-11-17' } });
    await h.brain.approve(resched.id, {});
    const block = await h.brain.suggestions.add({
      kind: 'calendar_block',
      title: 'Focus on the reply',
      nudge: '',
      clientId: 'poc-client-acme',
      clientConfidence: 'high',
      source: null,
      payload: { subject: 'Focus: pricing update', start: '2026-11-13T14:00:00.000Z', end: '2026-11-13T15:00:00.000Z', purpose: 'focus', taskId },
    });
    await h.brain.approve(block.id, {});
    await h.brain.idle();
    md = await read('acme-tooling-co');
    expect(sectionBullets(md, 'Commitments: we owe')[0]).toBe('Reply to Michael with a pricing update (due 2026-11-17; focus time booked 2026-11-13 14:00-15:00)');

    // Sending the reply marks it done (code) and makes ONE small profile call for what the email promised.
    h.claude.enqueue({ parsed: { edits: [{ section: 'Commitments: we owe', op: 'add', text: 'Send the full pricing deck by 2026-11-20' }, { section: 'Bogus', op: 'add', text: 'x' }] } });
    const send = await h.brain.suggestions.add({
      kind: 'send_reply',
      title: 'Reply to Michael',
      nudge: '',
      clientId: 'poc-client-acme',
      clientConfidence: 'high',
      source: null,
      payload: { taskId, draft: { to: [{ name: 'Michael Okafor', address: 'michael.okafor@acmetooling.example' }], cc: [], subject: 'Re: Market pricing', body: 'Hi Michael, the summary is attached. I will send the full deck by 20 November.', replyToMessageId: null } },
    });
    const callsBefore = h.claude.calls.length;
    await h.brain.approve(send.id, {});
    await h.brain.idle();
    expect(h.claude.calls.length).toBe(callsBefore + 1);
    const call = h.claude.calls[callsBefore]!;
    expect(call.method).toBe('parse');
    expect(JSON.stringify(call.params)).toContain('I will send the full deck by 20 November.');
    const usage = await readFile(join(h.dataDir, 'logs/usage.jsonl'), 'utf8');
    expect(usage.trim().split('\n').map((l) => JSON.parse(l).call)).toContain('profile');

    md = await read('acme-tooling-co');
    expect(sectionBullets(md, 'Commitments: we owe')).toEqual(['Reply to Michael with a pricing update (done 2026-11-13)', 'Set up a 45-minute call with Michael', 'Send the full pricing deck by 2026-11-20']);
    expect(md).not.toContain('Bogus');
    const log = sectionBullets(md, 'Change log');
    expect(log.filter((l) => l.startsWith(NOW))).toHaveLength(6);
    // Only the approved actions wrote outside: never the profile updates.
    expect(h.writes.map((w) => w.method)).toEqual(['createTask', 'createTask', 'rescheduleTask', 'createEvent', 'sendMail', 'completeTask']);
    expect(h.writes.every((w) => w.approval !== null)).toBe(true);
  });

  it('a person editing the commitment line by hand wins: later updates skip it rather than overwrite', async () => {
    const { h, file, read } = await setup();
    h.claude.enqueue({ parsed: triage({ profileEdits: [] }) });
    h.mail.deliver(michaelMail);
    await h.brain.tick();
    const reply = pending(h).find((s) => s.taskType === 'reply_email')!;
    await h.brain.approve(reply.id, {});
    await h.brain.idle();
    const md = await read('acme-tooling-co');
    await writeFile(file('acme-tooling-co'), md.replace('- Reply to Michael with a pricing update (due 2026-11-16)', '- Reply to Michael: he only wants headline numbers'));
    const taskId = h.pm.tasks[0]!.id;
    const done = await h.brain.suggestions.add({ kind: 'complete_task', title: 'Done', nudge: '', clientId: 'poc-client-acme', clientConfidence: 'high', source: null, payload: { taskId } });
    await h.brain.approve(done.id, {});
    await h.brain.idle();
    expect(sectionBullets(await read('acme-tooling-co'), 'Commitments: we owe')).toEqual(['Reply to Michael: he only wants headline numbers']);
  });

  it('concurrent edits to one file lose nothing', async () => {
    const { mod, read } = await setup();
    const f = mod.feature()!;
    await Promise.all(Array.from({ length: 25 }, (_, i) => f.writer.apply('Acme Tooling Co.', [{ section: 'Recent decisions', op: 'add', text: `Decision number ${i}` }], 'test')));
    const md = await read('acme-tooling-co');
    expect(sectionBullets(md, 'Recent decisions')).toHaveLength(25);
    expect(sectionBullets(md, 'Change log').filter((l) => l.includes('Decision number'))).toHaveLength(25);
  });

  it('GET /api/profiles and /api/profiles/:clientId return the contract shapes', async () => {
    const { h } = await setup();
    const base = await (async () => {
      await h.brain.start();
      const addr = (h.brain as unknown as { server: import('node:http').Server }).server.address() as import('node:net').AddressInfo;
      return `http://127.0.0.1:${addr.port}`;
    })();
    try {
      const list = ProfileListResponse.parse(await (await fetch(base + PATHS.brain.profiles)).json());
      expect(list.profiles.map((p) => p.clientId)).toEqual(['poc-client-acme', 'poc-client-quillon']);
      expect(list.profiles[0]).toMatchObject({ clientName: 'Acme Tooling Co.', slug: 'acme-tooling-co' });
      const r = await fetch(base + PATHS.brain.profile('poc-client-acme'));
      expect(r.status).toBe(200);
      const doc = ProfileDoc.parse(await r.json());
      expect(doc.markdown).toContain('# Acme Tooling Co.');
      for (const id of ['poc-client-harborlight', 'poc-client-internal', 'nope']) {
        const miss = await fetch(base + PATHS.brain.profile(id));
        expect(miss.status, id).toBe(404);
        expect((await miss.json()).error).toBeTruthy();
      }
    } finally {
      await h.brain.stop();
    }
  });
});

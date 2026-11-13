import { describe, expect, it } from 'vitest';
import { CalEvent, GraphMessage, ListTasksOutput, ZoomChatMessage, type PmClient } from '../index';
import {
  FakeAbortError,
  FakeCalendarConnector,
  FakeChatConnector,
  FakeClaude,
  FakeFilesConnector,
  FakeMailConnector,
  FakePmConnector,
  FakeSpeechToText,
  FakeTextToSpeech,
  type FakeStreamEvent,
} from './index';

describe('FakeClaude', () => {
  it('replies in order, records calls and reports usage', async () => {
    const claude = new FakeClaude().enqueue({ parsed: { clientId: 'poc-client-acme' }, usage: { cache_read_input_tokens: 500 } }, { text: 'hello' });
    const a = await claude.messages.parse({ model: 'claude-sonnet-5-5', messages: [] });
    expect(a.parsed_output).toEqual({ clientId: 'poc-client-acme' });
    expect(a.stop_reason).toBe('end_turn');
    expect(a.usage.cache_read_input_tokens).toBe(500);
    const b = await claude.messages.create({ model: 'claude-haiku-5-5' });
    expect(b.content).toEqual([{ type: 'text', text: 'hello' }]);
    expect(claude.calls.map((x) => [x.method, x.params.model])).toEqual([
      ['parse', 'claude-sonnet-5-5'],
      ['create', 'claude-haiku-5-5'],
    ]);
    expect(claude.totalUsage.input_tokens).toBe(2000);
  });

  it('throws when nothing is scripted, uses the default otherwise, and can fail on purpose', async () => {
    const claude = new FakeClaude();
    await expect(claude.messages.create({ model: 'm' })).rejects.toThrow(/no reply scripted/);
    claude.setDefault((_p, i) => ({ text: `call ${i}` }));
    expect((await claude.messages.create({ model: 'm' })).content[0]).toEqual({ type: 'text', text: 'call 1' });
    claude.enqueue({ error: new Error('overloaded') });
    await expect(claude.messages.create({ model: 'm' })).rejects.toThrow('overloaded');
  });

  it('streams text and tool calls as raw events', async () => {
    const claude = new FakeClaude().enqueue({
      content: [
        { type: 'text', text: 'Adding that now.' },
        { type: 'tool_use', id: 'tu_1', name: 'propose_create_task', input: { title: 'Chase Michael' } },
      ],
    });
    const stream = claude.messages.stream({ model: 'claude-haiku-5-5' });
    const texts: string[] = [];
    stream.on('text', (d) => texts.push(d));
    const events: FakeStreamEvent[] = [];
    for await (const e of stream) events.push(e);
    expect(texts.join('')).toBe('Adding that now.');
    expect(events[0]!.type).toBe('message_start');
    expect(events.at(-1)!.type).toBe('message_stop');
    expect(events.some((e) => e.type === 'content_block_delta' && e.delta.type === 'input_json_delta')).toBe(true);
    expect((await stream.finalMessage()).stop_reason).toBe('tool_use');
  });

  it('stops a stream on abort (barge-in)', async () => {
    const claude = new FakeClaude().enqueue({ text: 'one two three four five six seven eight', chunkDelayMs: 5 });
    const ac = new AbortController();
    const stream = claude.messages.stream({ model: 'claude-haiku-5-5' }, { signal: ac.signal });
    const texts: string[] = [];
    stream.on('text', (d) => {
      texts.push(d);
      if (texts.length === 2) ac.abort();
    });
    await expect(stream.finalMessage()).rejects.toBeInstanceOf(FakeAbortError);
    expect(texts.length).toBe(2);
    expect(claude.calls[0]!.aborted).toBe(true);
  });
});

describe('fake connectors', () => {
  it('mail: deliver, listSince with cursor, send', async () => {
    const mail = new FakeMailConnector();
    const m1 = mail.deliver({ from: { name: 'Michael Okafor', address: 'michael.okafor@acmetooling.example' }, subject: 'Update?', body: 'Any news?' });
    expect(GraphMessage.parse(m1)).toBeTruthy();
    const first = await mail.listSince('');
    expect(first.items.map((m) => m.id)).toEqual([m1.id]);
    expect((await mail.listSince(first.cursor)).items).toEqual([]);
    const m2 = mail.deliver({ from: { name: 'Lena Hartwell', address: 'lena.hartwell@acmetooling.example' }, subject: 'Also', body: 'x' });
    expect((await mail.listSince(first.cursor)).items.map((m) => m.id)).toEqual([m2.id]);
    await mail.send({ to: [{ name: 'Michael Okafor', address: 'michael.okafor@acmetooling.example' }], cc: [], subject: 'Re: Update?', body: 'Soon.', replyToMessageId: m1.id });
    expect(mail.sent).toHaveLength(1);
  });

  it('calendar: view overlaps and createEvent', async () => {
    const cal = new FakeCalendarConnector([FakeCalendarConnector.event('e1', 'Check-in', '2026-11-13T15:00:00Z', '2026-11-13T15:30:00Z')]);
    expect(await cal.view('2026-11-13T14:00:00Z', '2026-11-13T15:10:00Z')).toHaveLength(1);
    expect(await cal.view('2026-11-13T15:30:00Z', '2026-11-13T16:00:00Z')).toHaveLength(0);
    const ev = await cal.createEvent({ subject: 'Lunch', start: { dateTime: '2026-11-13T12:00:00', timeZone: 'UTC' }, end: { dateTime: '2026-11-13T12:30:00', timeZone: 'UTC' }, attendees: [], showAs: 'busy', categories: [] });
    expect(CalEvent.parse(ev)).toBeTruthy();
    expect(cal.created).toHaveLength(1);
  });

  it('chat: personal messages by default', async () => {
    const chat = new FakeChatConnector();
    const m = chat.deliver({ sender: 'priya.shah@brightline-advisory.example', sender_display_name: 'Priya Shah', message: 'Harbor needs the draft' });
    expect(ZoomChatMessage.parse(m).to_contact).toBeDefined();
    expect((await chat.listSince('')).items).toHaveLength(1);
  });

  it('files: list, read text and binary, refuse escapes', async () => {
    const files = new FakeFilesConnector({ 'Acme Tooling/a.md': '# A', 'Acme Tooling/b.pdf': new Uint8Array([37, 80, 68, 70]), 'Quillon Robotics/c.txt': 'c' });
    expect((await files.list('Acme Tooling')).map((f) => f.name)).toEqual(['a.md', 'b.pdf']);
    expect((await files.read('Acme Tooling/b.pdf')).encoding).toBe('base64');
    expect((await files.read('Acme Tooling/a.md')).content).toBe('# A');
    await expect(files.read('../secrets.txt')).rejects.toThrow(/outside/);
  });

  it('pm: the five tools with pm-server defaults, and a write-call log', async () => {
    const client: PmClient = { id: 'acme', name: 'Acme Tooling Co.', archived: false, nicknames: [], emailDomains: [], contacts: [], fileFolder: null, projects: [] };
    const pm = new FakePmConnector({ clients: [client] });
    await pm.listClients();
    const { task } = await pm.createTask({ clientId: 'acme', title: 'Reply to Michael', dueDate: '2026-11-13' });
    expect(task.deliverableTitle).toBe('General');
    await pm.rescheduleTask(task.id, '2026-11-14');
    await pm.completeTask(task.id);
    await pm.completeTask(task.id); // idempotent
    expect(ListTasksOutput.parse(await pm.listTasks({ includeDone: true })).tasks[0]!.done).toBe(true);
    expect((await pm.listTasks()).tasks).toEqual([]);
    expect(pm.writeCalls.map((c) => c.tool)).toEqual(['create_task', 'reschedule_task', 'complete_task', 'complete_task']);
  });

  it('speech: scripted STT events and abortable TTS', async () => {
    const stt = new FakeSpeechToText();
    const s = stt.open();
    s.write(new Uint8Array(640));
    s.emit({ type: 'speech_start' });
    s.emit({ type: 'final', text: 'add a task to chase Michael Friday' });
    s.close();
    const got = [];
    for await (const e of s.events) got.push(e.type);
    expect(got).toEqual(['speech_start', 'final']);
    expect(s.bytesWritten).toBe(640);

    const tts = new FakeTextToSpeech({ chunksPerText: 5, chunkDelayMs: 2 });
    const ac = new AbortController();
    let n = 0;
    for await (const _chunk of tts.speak('Hello there.', ac.signal)) {
      if (++n === 2) ac.abort();
    }
    expect(tts.spoken[0]).toMatchObject({ chunks: 2, aborted: true });
  });
});

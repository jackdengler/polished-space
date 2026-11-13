/** WS /api/voice with FakeClaude, a fake speech-to-text and a fake text-to-speech. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DATA_LAYOUT, VoiceServerMessage } from '@poc/contracts';
import { FakeTextToSpeech, type FakeParams, type FakeSttStream } from '@poc/contracts/testing';
import { triage } from '../testing/harness';
import type { ConversationFile } from './conversation';
import { postChat, sleep, upChat, VoiceTestClient, type ChatRig } from './testHelpers';
import { VOICE_TIMINGS_FILE, isEcho, type VoiceTimings } from './voice';

const rigs: ChatRig[] = [];
const clients: VoiceTestClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  for (const r of rigs.splice(0)) await r.h.brain.stop();
});

async function setup(opts: Parameters<typeof upChat>[0] = {}) {
  const r = await upChat(opts);
  rigs.push(r);
  const c = await VoiceTestClient.connect(r.base);
  clients.push(c);
  c.send({ type: 'start' });
  const deadline = Date.now() + 2000;
  while (!r.stt.streams.length && Date.now() < deadline) await sleep(5);
  const stt = r.stt.streams[0]! as FakeSttStream;
  return { ...r, c, stt };
}

async function conversation(dataDir: string): Promise<ConversationFile> {
  return JSON.parse(await readFile(join(dataDir, DATA_LAYOUT.brainConversation), 'utf8')) as ConversationFile;
}

function lastUserText(p: FakeParams): string {
  const msgs = p.messages as { role: string; content: { type: string; text?: string }[] }[];
  const m = [...msgs].reverse().find((x) => x.role === 'user' && x.content.some((b) => b.type === 'text'))!;
  return m.content.map((b) => b.text ?? '').join('\n');
}

const has = (c: VoiceTestClient, type: string) => () => c.json().some((m) => m.type === type);
const indexOfType = (c: VoiceTestClient, type: string) => c.got.findIndex((g) => g.kind === 'json' && g.m.type === type);

const LONG_REPLY = 'Okay, here is your afternoon. You have the Acme check-in at half past three, then nothing until five. I would use the gap for the pricing summary, which is due on Monday.';
/** TTS whose audio lasts long enough to interrupt: 2 chunks of 0.5 s per piece. */
const slowTts = () => new FakeTextToSpeech({ chunksPerText: 2, chunkDelayMs: 5, chunkBytes: 16000 });

describe('WS /api/voice', () => {
  it('relays the transcript, streams the reply as text and audio in contract order, and shares history with typed chat', async () => {
    const { h, c, stt, base, tts } = await setup();
    h.claude.enqueue({ text: 'You have the Acme check-in at half past three. Nothing else is booked today.' });
    stt.emit({ type: 'speech_start' });
    stt.emit({ type: 'partial', text: 'what is' });
    stt.emit({ type: 'partial', text: 'what is on today' });
    stt.emit({ type: 'final', text: 'what is on today' });
    await c.waitFor(has(c, 'assistant.done'), 4000, 'assistant.done');

    for (const m of c.json()) expect(VoiceServerMessage.safeParse(m).success, JSON.stringify(m)).toBe(true);
    const types = c.types();
    expect(types.slice(0, 3)).toEqual(['stt.partial', 'stt.partial', 'stt.final']);
    const audioStart = types.indexOf('assistant.audio.start');
    expect(audioStart).toBeGreaterThan(2);
    expect(types.indexOf('bin')).toBe(audioStart + 1);
    expect(types.lastIndexOf('bin')).toBeLessThan(types.indexOf('assistant.done'));
    expect(c.json().find((m) => m.type === 'assistant.audio.start')).toEqual({ type: 'assistant.audio.start', sampleRate: 16000 });
    const deltas = c.json().flatMap((m) => (m.type === 'assistant.delta' ? [m.text] : [])).join('');
    expect(deltas).toBe('You have the Acme check-in at half past three. Nothing else is booked today.');
    expect(c.json().find((m) => m.type === 'assistant.done')).toEqual({ type: 'assistant.done', text: deltas });
    // Cut at sentence ends, each piece sent to TTS.
    expect(tts.spoken.map((s) => s.text)).toEqual(['You have the Acme check-in at half past three.', 'Nothing else is booked today.']);
    expect(c.got.filter((g) => g.kind === 'bin')).toHaveLength(6);
    expect(lastUserText(h.claude.calls[0]!.params)).toContain('Reply mode: voice');

    // A typed turn right after continues the same conversation.
    h.claude.enqueue({ text: 'Yes, at half past three.' });
    await postChat(base, 'is that the 3:30 one?');
    const typed = h.claude.calls[1]!.params.messages as { role: string; content: { text?: string }[] }[];
    expect(typed.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(typed[0]!.content.map((b) => b.text).join('')).toContain('(spoken, transcribed by speech recognition) what is on today');
    expect(typed[1]!.content[0]!.text).toBe('You have the Acme check-in at half past three. Nothing else is booked today.');
    expect((await conversation(h.dataDir)).turns.map((t) => t.via)).toEqual(['voice', 'text']);
  });

  it('ignores an empty final', async () => {
    const { h, c, stt } = await setup();
    stt.emit({ type: 'speech_start' });
    stt.emit({ type: 'final', text: '' });
    stt.emit({ type: 'final', text: '   ' });
    await sleep(150);
    expect(c.types()).toEqual([]);
    expect(h.claude.calls).toHaveLength(0);
  });

  it('the misheard "At the task to chase michael on friday" still becomes the Friday follow-up task for Acme', async () => {
    const { h, c, stt } = await setup();
    // A scripted model that reads the transcript charitably, as the prompt asks.
    h.claude.enqueue(
      (p) => {
        const said = lastUserText(p).toLowerCase();
        expect(said).toContain('(spoken, transcribed by speech recognition) at the task to chase michael on friday');
        return { content: [{ type: 'tool_use', id: 'tu1', name: 'propose_create_task', input: { request: 'Chase Michael on Friday' } }] };
      },
      { parsed: triage({ tasks: [{ title: 'Chase Michael Okafor', direction: 'owed_to_me', taskType: 'follow_up', dueDate: null, duplicateOf: null }], meetingRequest: false, profileEdits: [] }) },
      { text: "I've suggested a task to chase Michael on Friday." },
    );
    stt.emit({ type: 'speech_start' });
    stt.emit({ type: 'final', text: 'At the task to chase michael on friday' });
    await c.waitFor(has(c, 'assistant.done'), 4000, 'assistant.done');
    const created = h.brain.suggestions.list().filter((s) => s.kind === 'create_task');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ clientId: 'poc-client-acme', taskType: 'follow_up', payload: { dueDate: '2026-11-20' }, source: { connector: 'voice' } });
    expect(JSON.stringify(h.claude.calls[1]!.params.messages)).toContain('Said by the user');
    await h.brain.idle();
    expect(h.writes).toEqual([]);
  });

  it('barge-in during playback: interrupted, no audio after it, Claude stream and TTS aborted, history keeps only the spoken text', async () => {
    const { h, c, stt, tts } = await setup({ tts: slowTts() });
    h.claude.enqueue({ text: LONG_REPLY, chunkDelayMs: 40 });
    stt.emit({ type: 'speech_start' });
    stt.emit({ type: 'final', text: 'what about this afternoon' });
    await c.waitFor(() => c.types().includes('bin'), 4000, 'first audio');
    await sleep(600); // about 0.6 s of the first piece has played
    stt.emit({ type: 'speech_start' });
    await c.waitFor(has(c, 'interrupted'), 2000, 'interrupted');
    const at = indexOfType(c, 'interrupted');
    await sleep(400);
    expect(c.got.slice(at + 1).filter((g) => g.kind === 'bin')).toEqual([]);
    expect(c.types()).not.toContain('assistant.done');

    expect(h.claude.calls[0]!.aborted).toBe(true);
    expect(tts.spoken.some((s) => s.aborted) || tts.spoken.every((s) => s.chunks === 2)).toBe(true);
    const spoken = (c.json().find((m) => m.type === 'interrupted') as { spokenText: string }).spokenText;
    expect(spoken.length).toBeGreaterThan(0);
    expect(LONG_REPLY.startsWith(spoken)).toBe(true);
    expect(spoken.length).toBeLessThan('Okay, here is your afternoon.'.length);

    await h.brain.idle();
    await sleep(50);
    const conv = await conversation(h.dataDir);
    expect(conv.turns).toHaveLength(1);
    expect(conv.turns[0]).toMatchObject({ via: 'voice', interrupted: true, assistant: spoken });
    expect(conv.messages.at(-1)).toEqual({ role: 'assistant', content: [expect.objectContaining({ type: 'text', text: spoken })] });

    // Still listening: the next utterance is a new turn, told about the interruption.
    h.claude.enqueue({ text: 'Sure, stopping there.' });
    stt.emit({ type: 'final', text: 'actually never mind' });
    await c.waitFor(has(c, 'assistant.done'), 4000, 'next turn');
    expect(lastUserText(h.claude.calls[1]!.params)).toContain('the user interrupted your previous reply');
  });

  it('barge-in while thinking aborts the stream before any audio and keeps no reply text', async () => {
    const { h, c, stt } = await setup({ tts: slowTts() });
    h.claude.enqueue({ text: LONG_REPLY, chunkDelayMs: 150 });
    stt.emit({ type: 'speech_start' });
    stt.emit({ type: 'final', text: 'what about this afternoon' });
    await c.waitFor(has(c, 'stt.final'));
    await sleep(60);
    stt.emit({ type: 'speech_start' });
    await c.waitFor(has(c, 'interrupted'));
    expect(c.json().find((m) => m.type === 'interrupted')).toEqual({ type: 'interrupted', spokenText: '' });
    await sleep(300);
    expect(c.types()).not.toContain('bin');
    expect(h.claude.calls[0]!.aborted).toBe(true);
    await h.brain.idle();
    await sleep(50);
    const conv = await conversation(h.dataDir);
    expect(conv.turns[0]).toMatchObject({ interrupted: true, assistant: '' });
    expect(conv.messages.map((m) => m.role)).toEqual(['user']);
  });

  it('with a barge-in threshold, the assistant\'s own echo does not interrupt it, but real speech does', async () => {
    const { h, c, stt } = await setup({ tts: slowTts(), module: { bargeInMs: 120 } });
    h.claude.enqueue({ text: LONG_REPLY });
    stt.emit({ type: 'speech_start' });
    stt.emit({ type: 'final', text: 'what about this afternoon' });
    await c.waitFor(() => c.types().includes('bin'));
    // Echo of its own voice: words from the reply.
    stt.emit({ type: 'speech_start' });
    stt.emit({ type: 'partial', text: 'here is your afternoon' });
    await sleep(250);
    stt.emit({ type: 'final', text: 'here is your afternoon' });
    await sleep(50);
    expect(c.types()).not.toContain('interrupted');
    expect(c.json().filter((m) => m.type === 'stt.final')).toHaveLength(1);
    // Real speech: interrupts on the first non-echo words, before the threshold.
    stt.emit({ type: 'speech_start' });
    stt.emit({ type: 'partial', text: 'hang on' });
    await c.waitFor(has(c, 'interrupted'), 100, 'interrupted');
    expect(h.claude.calls).toHaveLength(1);
    expect(isEcho('here is your afternoon', LONG_REPLY)).toBe(true);
    expect(isEcho('hang on', LONG_REPLY)).toBe(false);
    expect(isEcho('add a task for lena on monday', LONG_REPLY)).toBe(false);
  });

  it('"stop" from the client stops a reply in progress', async () => {
    const { h, c, stt } = await setup({ tts: slowTts() });
    h.claude.enqueue({ text: LONG_REPLY, chunkDelayMs: 40 });
    stt.emit({ type: 'speech_start' });
    stt.emit({ type: 'final', text: 'what about this afternoon' });
    await c.waitFor(() => c.types().includes('bin'));
    c.send({ type: 'stop' });
    await c.waitFor(has(c, 'interrupted'));
    expect(stt.closed).toBe(true);
    expect(h.claude.calls[0]!.aborted).toBe(true);
  });

  it('logs per-turn stage timings to logs/voice-turns.jsonl', async () => {
    const { h, c, stt } = await setup();
    h.claude.enqueue({ text: 'Two things today. The pricing summary and the Acme call.' });
    stt.emit({ type: 'speech_start' });
    stt.emit({ type: 'partial', text: 'what is' });
    await sleep(30);
    stt.emit({ type: 'partial', text: 'what is left' });
    await sleep(40);
    stt.emit({ type: 'final', text: 'what is left' });
    await c.waitFor(has(c, 'assistant.done'));
    const file = join(h.dataDir, VOICE_TIMINGS_FILE);
    const deadline = Date.now() + 3000;
    let text = '';
    while (!text && Date.now() < deadline) {
      text = await readFile(file, 'utf8').catch(() => '');
      if (!text) await sleep(25);
    }
    const lines = text.trim().split('\n').map((l) => JSON.parse(l) as VoiceTimings);
    expect(lines).toHaveLength(1);
    const t = lines[0]!;
    expect(t.transcript).toBe('what is left');
    expect(t.turnId).toMatch(/^voice-chat-/);
    expect(t.interrupted).toBe(false);
    expect(t.pieces).toBe(2);
    for (const k of ['speechEndToFinal', 'finalToFirstToken', 'firstTokenToFirstAudio', 'finalToFirstAudio', 'speechEndToFirstAudio'] as const) {
      expect(t.ms[k], k).toEqual(expect.any(Number));
      expect(t.ms[k]!, k).toBeGreaterThanOrEqual(0);
    }
    expect(t.ms.speechEndToFinal).toBe(400);
    expect(t.lastPartialAt! < t.finalAt).toBe(true);
  });
});

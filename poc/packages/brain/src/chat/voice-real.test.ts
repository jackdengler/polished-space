/**
 * Integration: the REAL speech service (local sherpa-onnx models) behind
 * WS /api/voice, with FakeClaude. The fixture WAV ("add a task to chase
 * Michael on Friday", invented) is streamed in real time, 20 ms frames,
 * then silence, like an open microphone.
 *
 * Skipped cleanly when the models are not installed
 * (`npm --prefix poc run models -w @poc/speech`).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FakeParams } from '@poc/contracts/testing';
import { triage } from '../testing/harness';
import { sleep, upChat, VoiceTestClient, type ChatRig } from './testHelpers';
import { VOICE_TIMINGS_FILE, type VoiceTimings } from './voice';

const HERE = dirname(fileURLToPath(import.meta.url));
const POC = resolve(HERE, '..', '..', '..', '..');
const SPEECH = join(POC, 'packages', 'speech');
const MODELS = join(SPEECH, 'models');
const FIXTURE = join(SPEECH, 'fixtures', 'chase-michael-friday.wav');
const TSX = join(POC, 'node_modules', '.bin', 'tsx');
const haveModels =
  existsSync(join(MODELS, 'asr', 'tokens.txt')) && existsSync(join(MODELS, 'asr', 'encoder.int8.onnx')) && existsSync(join(MODELS, 'vad', 'silero_vad.onnx')) && existsSync(join(MODELS, 'tts-en_GB-cori-medium', 'model.onnx')) && existsSync(TSX);

/** PCM16 data of a 16 kHz mono WAV. */
function wavPcm(buf: Buffer): Buffer {
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'data') return buf.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  throw new Error('no data chunk');
}

function lastUserText(p: FakeParams): string {
  const msgs = p.messages as { role: string; content: { type: string; text?: string }[] }[];
  const m = [...msgs].reverse().find((x) => x.role === 'user' && x.content.some((b) => b.type === 'text'))!;
  return m.content.map((b) => b.text ?? '').join('\n');
}

// One retry on the test: real recognition on a busy CPU (other test files running in parallel) has misheard once in ~20 runs.
describe.skipIf(!haveModels)('voice against the real speech service', () => {
  let speech: ChildProcess | null = null;
  let speechUrl = '';
  const rigs: ChatRig[] = [];

  beforeAll(async () => {
    speech = spawn(TSX, ['src/main.ts'], { cwd: SPEECH, env: { ...process.env, SPEECH_ENGINE: 'sherpa', SPEECH_PORT: '0', SPEECH_HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    speechUrl = await new Promise<string>((resolvePort, reject) => {
      const t = setTimeout(() => reject(new Error(`speech service did not start:\n${out}`)), 90_000);
      const onData = (d: Buffer) => {
        out += d.toString();
        const m = /ready in \d+ ms on 127\.0\.0\.1:(\d+)/.exec(out);
        if (m) {
          clearTimeout(t);
          resolvePort(`http://127.0.0.1:${m[1]}`);
        }
      };
      speech!.stdout!.on('data', onData);
      speech!.stderr!.on('data', onData);
      speech!.once('exit', (code) => reject(new Error(`speech service exited (${code}):\n${out}`)));
    });
  }, 100_000);

  afterAll(async () => {
    for (const r of rigs) await r.h.brain.stop();
    if (speech?.pid && speech.exitCode === null) {
      speech.kill('SIGTERM');
      await new Promise((r) => speech!.once('exit', r));
    }
  });

  it('fixture WAV streamed in real time: transcript has "chase" and "friday", a suggestion is created, audio comes back', { timeout: 60_000, retry: 1 }, async () => {
    const rig = await upChat({ module: { speechUrl } });
    rigs.push(rig);
    const { h } = rig;
    h.claude.enqueue(
      (p) => {
        const said = lastUserText(p).toLowerCase();
        expect(said).toMatch(/chase/);
        expect(said).toMatch(/friday/);
        return { content: [{ type: 'text', text: 'Sure, one moment.' }, { type: 'tool_use', id: 'tu1', name: 'propose_create_task', input: { request: 'Chase Michael on Friday' } }] };
      },
      { parsed: triage({ nudge: 'You want to chase Michael on Friday.', tasks: [{ title: 'Chase Michael Okafor', direction: 'owed_to_me', taskType: 'follow_up', dueDate: '2026-11-20', duplicateOf: null }], meetingRequest: false, profileEdits: [] }) },
      { text: "I've suggested a task to chase Michael on Friday. Approve it in your list when you're ready." },
    );
    const c = await VoiceTestClient.connect(rig.base);
    c.send({ type: 'start' });

    const pcm = wavPcm(readFileSync(FIXTURE));
    const FRAME = 640; // 20 ms
    const silence = Buffer.alloc(FRAME);
    const speechEndsAtMs = 3000; // the fixture's speech runs 0.5 s to 3.0 s
    let speechEndWall = 0;
    const t0 = Date.now();
    let stop = false;
    const sender = (async () => {
      for (let i = 0; !stop && i < 1500; i++) {
        const off = i * FRAME;
        c.ws.send(off < pcm.length ? pcm.subarray(off, off + FRAME) : silence);
        if (!speechEndWall && (i + 1) * 20 >= speechEndsAtMs) speechEndWall = Date.now();
        const wait = t0 + (i + 1) * 20 - Date.now();
        if (wait > 0) await sleep(wait);
      }
    })();

    await c.waitFor(() => c.json().some((m) => m.type === 'assistant.done'), 30_000, 'assistant.done');
    await sleep(300);
    stop = true;
    await sender;

    const json = c.json();
    const final = json.find((m) => m.type === 'stt.final') as { text: string } | undefined;
    expect(final?.text).toMatch(/chase/i);
    expect(final?.text).toMatch(/friday/i);
    expect(json.some((m) => m.type === 'stt.partial')).toBe(true);
    const created = h.brain.suggestions.list().filter((s) => s.kind === 'create_task');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ clientId: 'poc-client-acme', taskType: 'follow_up', payload: { dueDate: '2026-11-20' }, source: { connector: 'voice' } });
    const start = json.find((m) => m.type === 'assistant.audio.start') as { sampleRate: number };
    expect(start.sampleRate).toBe(22050);
    const bins = c.got.filter((g) => g.kind === 'bin');
    expect(bins.length).toBeGreaterThan(5);
    const audioMs = (bins.reduce((t, b) => t + (b.kind === 'bin' ? b.bytes : 0), 0) / 2 / start.sampleRate) * 1000;
    expect(audioMs).toBeGreaterThan(2000);
    expect(h.writes).toEqual([]);

    const finalAt = c.got.find((g) => g.kind === 'json' && g.m.type === 'stt.final')!.at;
    const firstAudioAt = bins[0]!.at;
    // Wait for the turn to be logged (after playback).
    let lines: VoiceTimings[] = [];
    for (let i = 0; i < 200 && !lines.length; i++) {
      lines = (await readFile(join(h.dataDir, VOICE_TIMINGS_FILE), 'utf8').catch(() => ''))
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as VoiceTimings);
      if (!lines.length) await sleep(50);
    }
    expect(lines).toHaveLength(1);
    console.log(
      `[voice-real] transcript="${final!.text}" | end of speech -> stt.final ${finalAt - speechEndWall} ms | stt.final -> first audio ${firstAudioAt - finalAt} ms ` +
        `| end of speech -> first audio ${firstAudioAt - speechEndWall} ms | audio ${Math.round(audioMs)} ms | brain log ms=${JSON.stringify(lines[0]!.ms)}`,
    );
    c.close();
  });
});

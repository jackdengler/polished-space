import { describe, expect, it, vi } from 'vitest';
import { VoiceClient, Resampler, type PlaybackSink, type SocketLike, type VoiceHandlers } from './voiceClient';
import { PcmQueue, PlaybackProcessor } from './playback.worklet.js';
import { CaptureProcessor } from './capture.worklet.js';

function harness() {
  const sink = { setInputRate: vi.fn(), push: vi.fn(), flush: vi.fn(), close: vi.fn(), onState: null } as unknown as PlaybackSink & Record<'setInputRate' | 'push' | 'flush', ReturnType<typeof vi.fn>>;
  const sent: unknown[] = [];
  const ws: SocketLike = { binaryType: '', readyState: 1, send: (d) => sent.push(d), close: vi.fn(), onopen: null, onmessage: null, onclose: null, onerror: null };
  const mic = { onFrame: null as null | ((b: ArrayBuffer) => void), close: vi.fn() };
  const events: string[] = [];
  const h: VoiceHandlers = {
    status: (s) => events.push(`status:${s}`),
    partial: (t) => events.push(`partial:${t}`),
    final: (t) => events.push(`final:${t}`),
    delta: (t) => events.push(`delta:${t}`),
    done: (t) => events.push(`done:${t}`),
    interrupted: (t) => events.push(`interrupted:${t}`),
    error: (t) => events.push(`error:${t}`),
  };
  const client = new VoiceClient(h, { openSocket: () => ws, openAudio: async () => ({ mic, sink }) });
  return { client, sink, ws, mic, sent, events };
}
const msg = (m: object) => JSON.stringify(m);
const audio = (n = 441) => new Int16Array(n).fill(1000).buffer;

describe('VoiceClient', () => {
  it('sends start, streams mic frames as binary, and stop', async () => {
    const t = harness();
    await t.client.start('ws://x/api/voice');
    t.ws.onopen!({});
    expect(t.sent[0]).toBe(msg({ type: 'start' }));
    t.mic.onFrame!(new ArrayBuffer(640));
    expect(t.sent[1]).toBeInstanceOf(ArrayBuffer);
    expect((t.sent[1] as ArrayBuffer).byteLength).toBe(640);
    t.client.stop();
    expect(t.sent[2]).toBe(msg({ type: 'stop' }));
    expect(t.mic.close).toHaveBeenCalled();
  });

  it('plays audio at the announced rate and drops the queue at once on `interrupted`', async () => {
    const t = harness();
    await t.client.start('ws://x/api/voice');
    t.ws.onopen!({});
    t.client.handleMessage(msg({ type: 'stt.final', text: 'tell me about Acme' }));
    t.client.handleMessage(msg({ type: 'assistant.audio.start', sampleRate: 22050 }));
    expect(t.sink.setInputRate).toHaveBeenCalledWith(22050);
    t.client.handleMessage(audio());
    t.client.handleMessage(audio());
    expect(t.sink.push).toHaveBeenCalledTimes(2);
    t.sink.onState!('playing');
    expect(t.events).toContain('status:speaking');

    t.client.handleMessage(msg({ type: 'interrupted', spokenText: 'Acme is' }));
    expect(t.sink.flush).toHaveBeenCalledTimes(1);
    // The flush happened before the UI was told.
    expect(t.events.slice(-2)).toEqual(['interrupted:Acme is', 'status:listening']);
    // Late frames after `interrupted` are not played.
    t.client.handleMessage(audio());
    expect(t.sink.push).toHaveBeenCalledTimes(2);
    // A new reply starts playing again after its own audio.start.
    t.client.handleMessage(msg({ type: 'stt.final', text: 'and Harborlight?' }));
    t.client.handleMessage(msg({ type: 'assistant.audio.start', sampleRate: 22050 }));
    t.client.handleMessage(audio());
    expect(t.sink.push).toHaveBeenCalledTimes(3);
  });

  it('passes partials, deltas and done through, and goes listening → thinking → listening', async () => {
    const t = harness();
    await t.client.start('ws://x/api/voice');
    t.ws.onopen!({});
    t.client.handleMessage(msg({ type: 'stt.partial', text: 'add a' }));
    t.client.handleMessage(msg({ type: 'stt.final', text: 'add a task' }));
    t.client.handleMessage(msg({ type: 'assistant.delta', text: 'Done.' }));
    t.client.handleMessage(msg({ type: 'assistant.done', text: 'Done.' }));
    expect(t.events).toEqual(['status:connecting', 'status:listening', 'partial:add a', 'final:add a task', 'status:thinking', 'delta:Done.', 'done:Done.', 'status:listening']);
  });

  it('reports a blocked microphone', async () => {
    const events: string[] = [];
    const c = new VoiceClient(
      { status: (s) => events.push(s), partial() {}, final() {}, delta() {}, done() {}, interrupted() {}, error: (e) => events.push(e) },
      { openSocket: () => { throw new Error('no'); }, openAudio: async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); } },
    );
    await c.start('ws://x');
    expect(events).toEqual(['connecting', 'error', 'Microphone access was blocked. Allow it in the browser to talk.']);
  });
});

describe('playback worklet', () => {
  it('PcmQueue plays in order and flush empties it', () => {
    const q = new PcmQueue();
    q.push(Float32Array.from([0.1, 0.2, 0.3]));
    q.push(Float32Array.from([0.4]));
    const out = new Float32Array(2);
    expect(q.read(out)).toBe(2);
    expect([...out].map((x) => +x.toFixed(1))).toEqual([0.1, 0.2]);
    q.flush();
    expect(q.length).toBe(0);
    expect(q.read(out)).toBe(0);
    expect([...out]).toEqual([0, 0]);
  });

  it('a flush message silences the very next render quantum', () => {
    const p = new PlaybackProcessor();
    p.onMessage({ type: 'audio', samples: new Float32Array(128 * 10).fill(0.5) });
    const out = [[new Float32Array(128)]];
    p.process([], out);
    expect(out[0]![0]![0]).toBe(0.5);
    p.onMessage({ type: 'flush' });
    p.process([], out);
    expect(out[0]![0]!.every((x) => x === 0)).toBe(true);
    expect(p.playing).toBe(false);
  });
});

describe('capture worklet', () => {
  it('turns 48 kHz float audio into 640-byte PCM16 16 kHz frames (20 ms)', () => {
    const frames: ArrayBuffer[] = [];
    const c = new CaptureProcessor({ inputRate: 48000, emit: (b) => frames.push(b) });
    // 200 ms at 48 kHz in 128-sample render quanta = 9600 samples → 3200 at 16 kHz → 10 frames.
    const quantum = new Float32Array(128).fill(0.25);
    for (let i = 0; i < 75; i++) c.process([[quantum]]);
    expect(frames.length).toBe(10);
    expect(frames.every((f) => f.byteLength === 640)).toBe(true);
    expect(new Int16Array(frames[0]!)[10]).toBe(Math.trunc(0.25 * 0x7fff));
  });
});

describe('Resampler', () => {
  it('22050 → 48000 keeps duration and continuity across chunks', () => {
    const r = new Resampler(22050, 48000);
    let total = 0;
    for (let i = 0; i < 10; i++) total += r.process(new Float32Array(2205).fill(0.5)).length;
    expect(Math.abs(total - 48000)).toBeLessThan(3);
  });
});

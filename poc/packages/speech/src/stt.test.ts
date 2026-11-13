import { describe, expect, it } from 'vitest';
import { SttEvent } from '@poc/contracts';
import type { SttConfig } from './config';
import { createFakeEngine, silence, tone } from './engine/fake';
import { float32ToPcm16 } from './pcm';
import { SttSession, tidyTranscript } from './stt';

const CFG: SttConfig = { endpointMs: 400, minSpeechMs: 200, vadThreshold: 0.5, prerollMs: 500, maxUtteranceS: 30, tailPadMs: 300 };
const RATE = 16000;

/** Runs audio through a session in 20 ms frames; records the audio time (ms) of each event. */
function run(parts: Float32Array[], cfg: SttConfig = CFG, opts: { close?: boolean } = {}) {
  const engine = createFakeEngine();
  const events: (SttEvent & { atMs: number })[] = [];
  let sent = 0;
  const s = new SttSession(engine, cfg, (e) => events.push({ ...SttEvent.parse(e), atMs: Math.round((sent / RATE) * 1000) }));
  const audio = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { audio.set(p, o); o += p.length; }
  const pcm = float32ToPcm16(audio);
  for (let i = 0; i < audio.length; i += 320) {
    sent = Math.min(audio.length, i + 320); // events from this frame are stamped with its end
    s.write(pcm.subarray(i * 2, (i + 320) * 2));
  }
  if (opts.close) s.close();
  return { events, engine, session: s };
}

describe('SttSession (fake engine)', () => {
  it('emits speech_start, partials, then final after the endpoint silence', () => {
    const { events } = run([silence(500), tone(1500), silence(1000)]);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('speech_start');
    expect(types.at(-1)).toBe('final');
    expect(types.filter((t) => t === 'final')).toHaveLength(1);
    expect(types.slice(1, -1).every((t) => t === 'partial')).toBe(true);
    expect(types.filter((t) => t === 'partial').length).toBeGreaterThan(2);

    // speech_start after min speech (200 ms) of the tone that starts at 500 ms.
    const start = events[0]!.atMs;
    expect(start).toBeGreaterThanOrEqual(700);
    expect(start).toBeLessThanOrEqual(760);
    // final once 400 ms of silence followed the tone that ends at 2000 ms.
    const final = events.at(-1)!;
    expect(final.atMs).toBeGreaterThanOrEqual(2400);
    expect(final.atMs).toBeLessThanOrEqual(2460);
    expect(final.type === 'final' && final.text).toBe('Add a task to chase michael on friday');
  });

  it('sends only changed, non-empty partials that grow', () => {
    const { events } = run([silence(300), tone(1000), silence(600)]);
    const partials = events.filter((e) => e.type === 'partial').map((e) => (e as { text: string }).text);
    expect(partials.every((p) => p.length > 0)).toBe(true);
    expect(new Set(partials).size).toBe(partials.length);
    for (let i = 1; i < partials.length; i++) expect(partials[i]!.startsWith(partials[i - 1]!)).toBe(true);
  });

  it('feeds the pre-roll so the start of speech reaches the recogniser', () => {
    const { engine } = run([silence(1000), tone(1000), silence(600)]);
    const heard = engine.recognizer.streams[0]!.samples;
    // 500 ms pre-roll + rest of tone + 400 ms endpoint silence + 300 ms tail pad
    expect(heard).toBeGreaterThanOrEqual(RATE * (0.5 + 0.8 + 0.4 + 0.3) - 640);
    expect(engine.recognizer.streams[0]!.finished).toBe(true);
    expect(engine.recognizer.streams[0]!.disposed).toBe(true);
  });

  it('ignores silence and quiet noise', () => {
    const { events } = run([silence(1000), tone(2000, 0.005), silence(500)]);
    expect(events).toEqual([]);
  });

  it('ignores a click shorter than the minimum speech length', () => {
    const { events } = run([silence(300), tone(100), silence(800)]);
    expect(events).toEqual([]);
  });

  it('handles two utterances in one session', () => {
    const { events } = run([silence(300), tone(800), silence(700), tone(800), silence(700)]);
    expect(events.map((e) => e.type).filter((t) => t !== 'partial')).toEqual(['speech_start', 'final', 'speech_start', 'final']);
  });

  it('cuts an utterance at the max length', () => {
    const { events } = run([silence(200), tone(4500), silence(600)], { ...CFG, maxUtteranceS: 2 });
    const finals = events.filter((e) => e.type === 'final');
    expect(finals.length).toBeGreaterThanOrEqual(2);
    expect(finals[0]!.atMs).toBeLessThanOrEqual(200 + 200 + 2000 + 40);
  });

  it('closing mid-utterance still sends the final', () => {
    const { events } = run([silence(200), tone(800)], CFG, { close: true });
    expect(events.map((e) => e.type).filter((t) => t !== 'partial')).toEqual(['speech_start', 'final']);
  });

  it('honours a longer endpoint', () => {
    const { events } = run([silence(200), tone(600), silence(1500)], { ...CFG, endpointMs: 1000 });
    const final = events.find((e) => e.type === 'final')!;
    expect(final.atMs).toBeGreaterThanOrEqual(800 + 1000);
  });

  it('accepts frames that split samples across messages', () => {
    const engine = createFakeEngine();
    const events: SttEvent[] = [];
    const s = new SttSession(engine, CFG, (e) => events.push(e));
    const pcm = float32ToPcm16(new Float32Array([...silence(200), ...tone(800), ...silence(600)]));
    for (let i = 0; i < pcm.length; i += 333) s.write(pcm.subarray(i, i + 333));
    expect(events.map((e) => e.type).filter((t) => t !== 'partial')).toEqual(['speech_start', 'final']);
  });
});

describe('tidyTranscript', () => {
  it('lower-cases model text and capitalises the start and "I"', () => {
    expect(tidyTranscript('  I THINK I\'LL CHASE  MICHAEL ')).toBe("I think I'll chase michael");
    expect(tidyTranscript('')).toBe('');
  });
});

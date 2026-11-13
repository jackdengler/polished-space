import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { AUDIO, type SttEvent } from '@poc/contracts';
import { configFromEnv } from './config';
import { createSherpaEngine, missingModelFiles } from './engine/sherpa';
import type { SpeechEngine } from './engine/types';
import { decodeWav, float32ToPcm16, resampleLinear } from './pcm';
import { SttSession } from './stt';
import { TtsService } from './tts';

/**
 * Runs only when the models are installed (`npm --prefix poc run models -w @poc/speech`).
 * Skipped cleanly otherwise, so CI and other builders never need them.
 */
const cfg = configFromEnv({ ...process.env, SPEECH_ENGINE: 'sherpa' });
const haveModels = missingModelFiles(cfg.modelsDir, cfg.voice).length === 0;
const fixturePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'chase-michael-friday.wav');
const RATE = AUDIO.sttSampleRate;

/** Feeds audio in 20 ms frames; returns events with the audio time (ms) at which each was emitted. */
function transcribe(engine: SpeechEngine, samples: Float32Array) {
  const events: (SttEvent & { atMs: number })[] = [];
  let sent = 0;
  const s = new SttSession(engine, cfg.stt, (e) => events.push({ ...e, atMs: Math.round((sent / RATE) * 1000) }));
  const pcm = float32ToPcm16(samples);
  const t0 = performance.now();
  for (let i = 0; i < samples.length; i += 320) {
    sent = Math.min(samples.length, i + 320); // events from this frame are stamped with its end
    s.write(pcm.subarray(i * 2, (i + 320) * 2));
  }
  s.close();
  return { events, rtf: (performance.now() - t0) / 1000 / (samples.length / RATE) };
}

describe.skipIf(!haveModels)('real sherpa-onnx models', () => {
  let engine: SpeechEngine;
  beforeAll(async () => {
    engine = await createSherpaEngine(cfg);
  }, 60_000);

  it('transcribes the fixture WAV with the key words and correct VAD timing', () => {
    const { samples, sampleRate } = decodeWav(readFileSync(fixturePath));
    expect(sampleRate).toBe(RATE);
    const { events, rtf } = transcribe(engine, samples);
    const nonPartial = events.filter((e) => e.type !== 'partial');
    expect(nonPartial.map((e) => e.type)).toEqual(['speech_start', 'final']);
    const [start, final] = nonPartial;
    // Speech runs from 0.5 s to 3.0 s in the fixture.
    expect(start!.atMs).toBeGreaterThanOrEqual(500);
    expect(start!.atMs).toBeLessThanOrEqual(1000);
    expect(final!.atMs).toBeGreaterThanOrEqual(3000);
    expect(final!.atMs).toBeLessThanOrEqual(3000 + cfg.stt.endpointMs + 300);
    const text = final!.type === 'final' ? final!.text : '';
    expect(text).toMatch(/chase/i);
    expect(text).toMatch(/friday/i);
    expect(events.some((e) => e.type === 'partial')).toBe(true);
    expect(rtf).toBeLessThan(0.5);
  });

  it('round-trips a freshly synthesised sentence through STT', async () => {
    const tts = new TtsService(engine.tts);
    const parts: Uint8Array[] = [];
    for await (const c of tts.speak('Add a task to chase Michael on Friday.', new AbortController().signal)) parts.push(c);
    const pcm = Buffer.concat(parts);
    const speech = resampleLinear(
      new Float32Array(Array.from({ length: pcm.length / 2 }, (_, i) => pcm.readInt16LE(i * 2) / 32768)),
      engine.tts.sampleRate,
      RATE,
    );
    const audio = new Float32Array(RATE / 2 + speech.length + RATE);
    audio.set(speech, RATE / 2);
    const final = transcribe(engine, audio).events.find((e) => e.type === 'final');
    expect(final?.type === 'final' && final.text).toMatch(/chase.*friday/i);
  });

  it('gives first TTS audio quickly after warm-up', async () => {
    const tts = new TtsService(engine.tts);
    const t0 = performance.now();
    let first = -1;
    for await (const _ of tts.speak('Sure, I have added that task for Friday.', new AbortController().signal)) {
      if (first < 0) first = performance.now() - t0;
    }
    // Generous bound for slow CI; the measured figure is in the report (npm run measure).
    expect(first).toBeLessThan(1500);
  });
});

describe('fixture', () => {
  it('is present (generated with npm run fixture)', () => {
    expect(existsSync(fixturePath)).toBe(true);
  });
});

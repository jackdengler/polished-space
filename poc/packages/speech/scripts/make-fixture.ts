/**
 * Makes the voice fixture: an invented sentence spoken by the service's own
 * TTS voice, as a 16 kHz mono PCM16 WAV (the `/stt` input format) with
 * 0.5 s of silence before and 1.2 s after.
 *
 *   npm --prefix poc run fixture -w @poc/speech
 *
 * Writes poc/packages/speech/fixtures/chase-michael-friday.wav (small, committed).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDIO } from '@poc/contracts';
import { configFromEnv } from '../src/config';
import { createSherpaEngine } from '../src/engine/sherpa';
import { encodeWav, resampleLinear } from '../src/pcm';

export const FIXTURE_TEXT = 'Add a task to chase Michael on Friday.';
const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, '..', 'fixtures', 'chase-michael-friday.wav');

const cfg = configFromEnv();
const engine = await createSherpaEngine({ ...cfg, ttsThreads: cfg.ttsThreads });
const speech = resampleLinear(await engine.tts.synthesize(FIXTURE_TEXT), engine.tts.sampleRate, AUDIO.sttSampleRate);
const rate = AUDIO.sttSampleRate;
const all = new Float32Array(Math.round(0.5 * rate) + speech.length + Math.round(1.2 * rate));
all.set(speech, Math.round(0.5 * rate));
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, encodeWav(all, rate));
console.log(`wrote ${out}: "${FIXTURE_TEXT}" (${(all.length / rate).toFixed(2)} s, voice ${cfg.voice}, speech from 0.50 s to ${(0.5 + speech.length / rate).toFixed(2)} s)`);

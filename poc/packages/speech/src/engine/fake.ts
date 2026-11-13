import type { Recognizer, RecognizerStream, SpeechEngine, TtsEngine, Vad, VadOptions } from './types';

/**
 * Deterministic stand-in engine: no models, no native code. Used by the
 * protocol tests and by `SPEECH_ENGINE=fake` so other pieces can be wired
 * up without the models.
 *
 * - VAD: a 20 ms frame is speech when its RMS is at least `FAKE_VAD_RMS`
 *   (0.02), with the same min-speech / endpoint / max-length rules as the
 *   real VAD.
 * - Recogniser: reveals one word of `words` per `msPerWord` of audio heard
 *   after the utterance started (silence counts too, like a real model's
 *   look-ahead); `finish()` returns every word revealed so far, at least one.
 * - TTS: a quiet 220 Hz tone, `msPerChar` per character, after `delayMs`.
 */

const RATE = 16000;
export const FAKE_VAD_RMS = 0.02;

export class FakeVad implements Vad {
  private readonly frame = RATE / 50;
  private pending: number[] = [];
  private speech = false;
  private run = 0; // consecutive speech samples (before trigger) or silence samples (after)
  private length = 0;

  constructor(private readonly opts: VadOptions) {}

  accept(samples: Float32Array): void {
    for (const s of samples) {
      this.pending.push(s);
      if (this.pending.length === this.frame) {
        this.frameDone(this.pending);
        this.pending = [];
      }
    }
  }

  private frameDone(frame: number[]): void {
    const rms = Math.sqrt(frame.reduce((a, s) => a + s * s, 0) / frame.length);
    const loud = rms >= FAKE_VAD_RMS;
    const n = frame.length;
    if (!this.speech) {
      this.run = loud ? this.run + n : 0;
      if (this.run >= (this.opts.minSpeechMs / 1000) * RATE) {
        this.speech = true;
        this.run = 0;
        this.length = 0;
      }
      return;
    }
    this.length += n;
    this.run = loud ? 0 : this.run + n;
    if (this.run >= (this.opts.endpointMs / 1000) * RATE || this.length >= this.opts.maxUtteranceS * RATE) {
      this.speech = false;
      this.run = 0;
    }
  }

  isSpeech(): boolean {
    return this.speech;
  }

  reset(): void {
    this.pending = [];
    this.speech = false;
    this.run = 0;
  }

  dispose(): void {}
}

export class FakeRecognizer implements Recognizer {
  readonly streams: { samples: number; finished: boolean; disposed: boolean }[] = [];

  constructor(
    readonly words: string[] = 'ADD A TASK TO CHASE MICHAEL ON FRIDAY'.split(' '),
    readonly msPerWord = 120,
  ) {}

  createStream(): RecognizerStream {
    const rec = { samples: 0, finished: false, disposed: false };
    this.streams.push(rec);
    const count = () => Math.min(this.words.length, Math.floor(rec.samples / ((this.msPerWord / 1000) * RATE)));
    return {
      accept: (s) => { rec.samples += s.length; },
      text: () => this.words.slice(0, count()).join(' '),
      finish: () => {
        rec.finished = true;
        return this.words.slice(0, Math.max(1, count())).join(' ');
      },
      dispose: () => { rec.disposed = true; },
    };
  }
}

export class FakeTts implements TtsEngine {
  readonly sampleRate = 22050;
  readonly calls: string[] = [];

  constructor(readonly msPerChar = 60, readonly delayMs = 0) {}

  async synthesize(text: string): Promise<Float32Array> {
    this.calls.push(text);
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    const n = Math.round((text.length * this.msPerChar * this.sampleRate) / 1000);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = 0.1 * Math.sin((2 * Math.PI * 220 * i) / this.sampleRate);
    return out;
  }
}

export interface FakeEngineOptions {
  words?: string[];
  msPerWord?: number;
  ttsMsPerChar?: number;
  ttsDelayMs?: number;
}

export function createFakeEngine(opts: FakeEngineOptions = {}): SpeechEngine & { recognizer: FakeRecognizer; tts: FakeTts } {
  return {
    name: 'fake',
    createVad: (o) => new FakeVad(o),
    recognizer: new FakeRecognizer(opts.words, opts.msPerWord),
    tts: new FakeTts(opts.ttsMsPerChar, opts.ttsDelayMs),
  };
}

/** Test audio: `ms` of a loud tone (speech to the fake VAD) or of silence. */
export function tone(ms: number, amplitude = 0.3): Float32Array {
  const n = Math.round((ms / 1000) * RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * 300 * i) / RATE);
  return out;
}

export function silence(ms: number): Float32Array {
  return new Float32Array(Math.round((ms / 1000) * RATE));
}

import { AUDIO, type SttEvent } from '@poc/contracts';
import type { SttConfig } from './config';
import type { RecognizerStream, SpeechEngine, Vad } from './engine/types';
import { Pcm16Decoder, SampleRing } from './pcm';

const RATE = AUDIO.sttSampleRate;

/** Model text ("ADD A TASK") to readable text ("Add a task"). */
export function tidyTranscript(raw: string): string {
  const t = raw.replace(/\s+/g, ' ').trim().toLowerCase().replace(/\bi\b/g, 'I').replace(/\bi'(m|ll|d|ve)\b/g, "I'$1");
  return t ? t[0]!.toUpperCase() + t.slice(1) : '';
}

/**
 * One `/stt` session: PCM16 16 kHz in, `speech_start` / `partial` / `final`
 * out. Voice activity decides the utterance bounds:
 *
 * - `speech_start` once the VAD has heard `minSpeechMs` of speech.
 * - `partial` whenever the running transcript changes (non-empty only).
 * - `final` after `endpointMs` of silence (or at `maxUtteranceS`). Its text
 *   may be empty (noise that held no words); every `speech_start` is followed
 *   by exactly one `final`, also when the session closes mid-utterance.
 *
 * The last `prerollMs` of audio before `speech_start` is fed to the
 * recogniser too, so the first word survives the VAD's detection delay.
 */
export class SttSession {
  private readonly decoder = new Pcm16Decoder();
  private readonly vad: Vad;
  private readonly preroll: SampleRing;
  private stream: RecognizerStream | null = null;
  private lastPartial = '';
  private closed = false;

  constructor(
    private readonly engine: SpeechEngine,
    private readonly cfg: SttConfig,
    private readonly emit: (e: SttEvent) => void,
  ) {
    this.vad = engine.createVad({
      threshold: cfg.vadThreshold,
      minSpeechMs: cfg.minSpeechMs,
      endpointMs: cfg.endpointMs,
      maxUtteranceS: cfg.maxUtteranceS,
    });
    this.preroll = new SampleRing((cfg.prerollMs / 1000) * RATE);
  }

  get inSpeech(): boolean {
    return this.stream !== null;
  }

  /** Push PCM16 LE mono 16 kHz bytes (any length; odd bytes carry over). */
  write(pcm: Uint8Array): void {
    if (this.closed) return;
    const samples = this.decoder.push(pcm);
    // Feed the VAD in small steps so state changes land close to where they happen.
    const step = (RATE * AUDIO.sttFrameMs) / 1000;
    for (let i = 0; i < samples.length; i += step) this.step(samples.subarray(i, i + step));
  }

  private step(chunk: Float32Array): void {
    this.vad.accept(chunk);
    const speech = this.vad.isSpeech();
    if (!this.stream) {
      this.preroll.push(chunk);
      if (!speech) return;
      this.stream = this.engine.recognizer.createStream();
      this.lastPartial = '';
      this.emit({ type: 'speech_start' });
      this.stream.accept(this.preroll.drain());
      this.emitPartial();
      return;
    }
    this.stream.accept(chunk);
    if (speech) this.emitPartial();
    else this.finishUtterance();
  }

  private emitPartial(): void {
    const text = tidyTranscript(this.stream!.text());
    if (text && text !== this.lastPartial) {
      this.lastPartial = text;
      this.emit({ type: 'partial', text });
    }
  }

  private finishUtterance(): void {
    const stream = this.stream!;
    this.stream = null;
    if (this.cfg.tailPadMs > 0) stream.accept(new Float32Array(Math.round((this.cfg.tailPadMs / 1000) * RATE)));
    const text = tidyTranscript(stream.finish());
    stream.dispose();
    this.preroll.clear();
    this.emit({ type: 'final', text });
  }

  /** Ends the session. An utterance in progress gets its `final`. */
  close(): void {
    if (this.closed) return;
    if (this.stream) this.finishUtterance();
    this.closed = true;
    this.vad.dispose();
  }
}

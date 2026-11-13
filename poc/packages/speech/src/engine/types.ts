/**
 * The model-loading seam. The service logic (endpointing, streaming,
 * abort, HTTP/WS) only talks to these interfaces; `sherpa.ts` implements
 * them with local sherpa-onnx models and `fake.ts` with deterministic
 * stand-ins for tests and for running without models.
 *
 * All audio here is mono float32 in [-1, 1].
 */

/** Voice activity detector for one session, at 16 kHz. */
export interface Vad {
  accept(samples: Float32Array): void;
  /**
   * True while inside speech: becomes true once `minSpeechMs` of speech is
   * seen, false again after `endpointMs` of silence (or at the max length).
   */
  isSpeech(): boolean;
  reset(): void;
  dispose(): void;
}

export interface VadOptions {
  threshold: number;
  minSpeechMs: number;
  endpointMs: number;
  maxUtteranceS: number;
}

/** One streaming recognition of a single utterance, at 16 kHz. */
export interface RecognizerStream {
  accept(samples: Float32Array): void;
  /** Best transcript so far (raw model text). */
  text(): string;
  /** No more audio: flush and return the final transcript. */
  finish(): string;
  dispose(): void;
}

export interface Recognizer {
  createStream(): RecognizerStream;
}

export interface TtsEngine {
  /** Output sample rate (Hz). */
  readonly sampleRate: number;
  /**
   * Synthesise one short piece of text (a sentence or clause). Must not block
   * the event loop for long; the caller serialises calls.
   */
  synthesize(text: string): Promise<Float32Array>;
  dispose?(): void;
}

export interface SpeechEngine {
  readonly name: string;
  createVad(opts: VadOptions): Vad;
  readonly recognizer: Recognizer;
  readonly tts: TtsEngine;
}

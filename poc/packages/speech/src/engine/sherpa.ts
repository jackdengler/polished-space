import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { AUDIO } from '@poc/contracts';
import { modelPaths, type TtsVoice } from '../models';
import type { Recognizer, RecognizerStream, SpeechEngine, TtsEngine, Vad, VadOptions } from './types';

/**
 * Real engine: sherpa-onnx (Node addon `sherpa-onnx-node`, pinned to 1.13.x
 * because 2.x dropped the built-in espeak-ng phonemizer that Piper voices
 * need). Everything runs locally from the models dir; nothing here opens a
 * network connection.
 */

// The subset of the sherpa-onnx-node API used here (the package ships JS only).
interface SherpaWave { samples: Float32Array; sampleRate: number }
interface SherpaOnlineStream { acceptWaveform(w: SherpaWave): void; inputFinished(): void }
interface SherpaOnlineRecognizer {
  createStream(): SherpaOnlineStream;
  isReady(s: SherpaOnlineStream): boolean;
  decode(s: SherpaOnlineStream): void;
  getResult(s: SherpaOnlineStream): { text: string };
}
interface SherpaVad {
  acceptWaveform(samples: Float32Array): void;
  isDetected(): boolean;
  isEmpty(): boolean;
  pop(): void;
  reset(): void;
}
interface SherpaOfflineTts {
  sampleRate: number;
  generateAsync(o: { text: string; sid: number; speed: number }): Promise<SherpaWave>;
}
interface SherpaModule {
  version: string;
  OnlineRecognizer: new (config: unknown) => SherpaOnlineRecognizer;
  Vad: new (config: unknown, bufferSizeInSeconds: number) => SherpaVad;
  OfflineTts: { createAsync(config: unknown): Promise<SherpaOfflineTts> };
}

export interface SherpaOptions {
  modelsDir: string;
  voice: TtsVoice;
  ttsSpeed: number;
  sttThreads: number;
  ttsThreads: number;
}

const RATE = AUDIO.sttSampleRate;

/** Lists model files missing from `modelsDir` (empty when ready). */
export function missingModelFiles(modelsDir: string, voice: TtsVoice): string[] {
  const p = modelPaths(modelsDir, voice);
  return [...Object.values(p.asr), p.vad, ...Object.values(p.tts)].filter((f) => !existsSync(f));
}

export function loadSherpaModule(): SherpaModule {
  const require = createRequire(import.meta.url);
  return require('sherpa-onnx-node') as SherpaModule;
}

class SherpaVadImpl implements Vad {
  constructor(private readonly vad: SherpaVad) {}
  accept(samples: Float32Array): void {
    this.vad.acceptWaveform(samples);
    // Detected segments queue up inside sherpa; we only need the live state.
    while (!this.vad.isEmpty()) this.vad.pop();
  }
  isSpeech(): boolean {
    return this.vad.isDetected();
  }
  reset(): void {
    this.vad.reset();
  }
  dispose(): void {
    // Native handle is freed by GC.
  }
}

class SherpaRecognizer implements Recognizer {
  constructor(private readonly rec: SherpaOnlineRecognizer) {}
  createStream(): RecognizerStream {
    const rec = this.rec;
    const s = rec.createStream();
    const decode = () => { while (rec.isReady(s)) rec.decode(s); };
    return {
      accept(samples) {
        if (samples.length === 0) return;
        s.acceptWaveform({ samples, sampleRate: RATE });
        decode();
      },
      text: () => rec.getResult(s).text,
      finish() {
        s.inputFinished();
        decode();
        return rec.getResult(s).text;
      },
      dispose() {},
    };
  }
}

class SherpaTts implements TtsEngine {
  constructor(private readonly tts: SherpaOfflineTts, private readonly speed: number) {}
  get sampleRate(): number {
    return this.tts.sampleRate;
  }
  async synthesize(text: string): Promise<Float32Array> {
    // generateAsync runs on a libuv worker thread, so STT keeps flowing.
    const audio = await this.tts.generateAsync({ text, sid: 0, speed: this.speed });
    return audio.samples;
  }
}

export async function createSherpaEngine(opts: SherpaOptions): Promise<SpeechEngine> {
  const missing = missingModelFiles(opts.modelsDir, opts.voice);
  if (missing.length) {
    throw new Error(
      `speech models missing in ${opts.modelsDir} (${missing.length} files, e.g. ${missing[0]}). ` +
        'Run `npm --prefix poc run models -w @poc/speech`, or set SPEECH_ENGINE=fake.',
    );
  }
  const sherpa = loadSherpaModule();
  const p = modelPaths(opts.modelsDir, opts.voice);

  const recognizer = new sherpa.OnlineRecognizer({
    featConfig: { sampleRate: RATE, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: p.asr.encoder, decoder: p.asr.decoder, joiner: p.asr.joiner },
      tokens: p.asr.tokens,
      numThreads: opts.sttThreads,
      provider: 'cpu',
      debug: 0,
    },
    decodingMethod: 'greedy_search',
    // Endpointing is done by the VAD (stt.ts), not by the recogniser.
    enableEndpoint: 0,
  });

  const tts = await sherpa.OfflineTts.createAsync({
    model: {
      vits: { model: p.tts.model, tokens: p.tts.tokens, dataDir: p.tts.dataDir },
      numThreads: opts.ttsThreads,
      provider: 'cpu',
      debug: 0,
    },
    maxNumSentences: 1,
  });

  const createVad = (o: VadOptions): Vad =>
    new SherpaVadImpl(
      new sherpa.Vad(
        {
          sileroVad: {
            model: p.vad,
            threshold: o.threshold,
            minSpeechDuration: o.minSpeechMs / 1000,
            minSilenceDuration: o.endpointMs / 1000,
            maxSpeechDuration: o.maxUtteranceS,
            windowSize: 512,
          },
          sampleRate: RATE,
          numThreads: 1,
          provider: 'cpu',
          debug: 0,
        },
        Math.max(60, o.maxUtteranceS * 2),
      ),
    );

  const engine: SpeechEngine = {
    name: `sherpa-onnx ${sherpa.version}`,
    createVad,
    recognizer: new SherpaRecognizer(recognizer),
    tts: new SherpaTts(tts, opts.ttsSpeed),
  };
  // Warm up: the first inference of each model is slow (graph init, allocations).
  await engine.tts.synthesize('Ready.');
  const warm = engine.recognizer.createStream();
  warm.accept(new Float32Array(RATE / 2));
  warm.finish();
  return engine;
}

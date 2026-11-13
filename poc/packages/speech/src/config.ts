import { PORTS } from '@poc/contracts';
import { DEFAULT_MODELS_DIR, DEFAULT_VOICE, isVoice, type TtsVoice } from './models';

/** Voice activity / endpointing settings for one `/stt` session. */
export interface SttConfig {
  /** Trailing silence that ends an utterance (`final`). Env STT_ENDPOINT_MS, default 400. */
  endpointMs: number;
  /** Speech needed before `speech_start` fires (guards barge-in against clicks). Env STT_MIN_SPEECH_MS, default 250. */
  minSpeechMs: number;
  /** VAD speech probability threshold, 0..1. Env STT_VAD_THRESHOLD, default 0.5. */
  vadThreshold: number;
  /** Audio kept from before `speech_start` and fed to the recogniser, so the first word is not lost. Env STT_PREROLL_MS, default 600. */
  prerollMs: number;
  /** Utterances longer than this are cut (a `final` is sent). Env STT_MAX_UTTERANCE_S, default 30. */
  maxUtteranceS: number;
  /** Silence appended at end of utterance so the recogniser flushes its last word. Env STT_TAIL_PAD_MS, default 300. */
  tailPadMs: number;
}

export interface SpeechConfig {
  port: number;
  host: string;
  /** `sherpa` (real local models) or `fake` (deterministic, no models; for tests and wiring). Env SPEECH_ENGINE. */
  engine: 'sherpa' | 'fake';
  modelsDir: string;
  voice: TtsVoice;
  /** TTS speaking rate (1 = normal). Env TTS_SPEED. */
  ttsSpeed: number;
  sttThreads: number;
  ttsThreads: number;
  stt: SttConfig;
}

type Env = Record<string, string | undefined>;

function num(env: Env, name: string, def: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} must be a number from ${min} to ${max} (got "${raw}")`);
  return n;
}

export function sttConfigFromEnv(env: Env = process.env): SttConfig {
  return {
    endpointMs: num(env, 'STT_ENDPOINT_MS', 400, 100, 3000),
    minSpeechMs: num(env, 'STT_MIN_SPEECH_MS', 250, 50, 2000),
    vadThreshold: num(env, 'STT_VAD_THRESHOLD', 0.5, 0.05, 0.99),
    prerollMs: num(env, 'STT_PREROLL_MS', 600, 0, 3000),
    maxUtteranceS: num(env, 'STT_MAX_UTTERANCE_S', 30, 2, 120),
    tailPadMs: num(env, 'STT_TAIL_PAD_MS', 300, 0, 2000),
  };
}

export function configFromEnv(env: Env = process.env): SpeechConfig {
  const engine = env.SPEECH_ENGINE || 'sherpa';
  if (engine !== 'sherpa' && engine !== 'fake') throw new Error(`SPEECH_ENGINE must be "sherpa" or "fake" (got "${engine}")`);
  const voice = env.TTS_VOICE || DEFAULT_VOICE;
  if (!isVoice(voice)) throw new Error(`TTS_VOICE "${voice}" is not a known voice`);
  return {
    port: num(env, 'SPEECH_PORT', PORTS.speech, 0, 65535),
    host: env.SPEECH_HOST || '0.0.0.0',
    engine,
    modelsDir: env.SPEECH_MODELS_DIR || DEFAULT_MODELS_DIR,
    voice,
    ttsSpeed: num(env, 'TTS_SPEED', 1, 0.5, 2),
    sttThreads: num(env, 'STT_THREADS', 1, 1, 16),
    ttsThreads: num(env, 'TTS_THREADS', 2, 1, 16),
    stt: sttConfigFromEnv(env),
  };
}

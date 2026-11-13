import { configFromEnv } from './config';
import { createFakeEngine } from './engine/fake';
import { createSherpaEngine } from './engine/sherpa';
import type { SpeechEngine } from './engine/types';
import { createSpeechServer } from './server';

const cfg = configFromEnv();
const t0 = performance.now();
let engine: SpeechEngine;
if (cfg.engine === 'fake') {
  engine = createFakeEngine();
} else {
  engine = await createSherpaEngine({
    modelsDir: cfg.modelsDir,
    voice: cfg.voice,
    ttsSpeed: cfg.ttsSpeed,
    sttThreads: cfg.sttThreads,
    ttsThreads: cfg.ttsThreads,
  });
}
const app = createSpeechServer({ engine, stt: cfg.stt });
const port = await app.listen(cfg.port, cfg.host);
console.log(
  `[speech] ${engine.name} ready in ${Math.round(performance.now() - t0)} ms on ${cfg.host}:${port} ` +
    `(voice=${cfg.engine === 'fake' ? 'fake' : cfg.voice}, tts_rate=${app.tts.sampleRate}, endpoint_ms=${cfg.stt.endpointMs}, ` +
    `min_speech_ms=${cfg.stt.minSpeechMs}, vad_threshold=${cfg.stt.vadThreshold})`,
);

const stop = () => {
  console.log('[speech] shutting down');
  app.close().finally(() => process.exit(0));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

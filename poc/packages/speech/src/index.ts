// @poc/speech: local streaming speech-to-text and text-to-speech service.
// Clients for other packages live in '@poc/speech/client' (no native code).
export { createSpeechServer, type SpeechHealth, type SpeechServer } from './server';
export { SttSession, tidyTranscript } from './stt';
export { TtsService, splitForSpeech } from './tts';
export { configFromEnv, sttConfigFromEnv, type SpeechConfig, type SttConfig } from './config';
export { createFakeEngine } from './engine/fake';
export type { SpeechEngine } from './engine/types';

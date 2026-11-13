import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The speech models: one manifest shared by the download script
 * (`npm run models -w @poc/speech`, also run by Dockerfile.speech at build
 * time) and the sherpa engine. Models are never committed; they live in a
 * gitignored folder and the service never touches the network at run time.
 *
 * All files come from the sherpa-onnx GitHub releases (k2-fsa/sherpa-onnx).
 * Each download is pinned by SHA-256.
 */

const RELEASES = 'https://github.com/k2-fsa/sherpa-onnx/releases/download';

export interface ModelDownload {
  /** Folder name under the models dir. */
  id: string;
  url: string;
  sha256: string;
  /** Download size in bytes (informational). */
  bytes: number;
  licence: string;
  /** Plain `.onnx` file (no archive): saved as `<id>/<file>`. */
  file?: string;
  /** For `.tar.bz2` archives: `{ "path/inside/archive": "name in <id>/" }`. Directories are copied whole. */
  extract?: Record<string, string>;
}

/** Streaming English zipformer transducer (icefall, LibriSpeech), int8 encoder/joiner. ~73 MB on disk. */
export const ASR_MODEL: ModelDownload = {
  id: 'asr',
  url: `${RELEASES}/asr-models/sherpa-onnx-streaming-zipformer-en-2023-06-26.tar.bz2`,
  sha256: '639e25b578e9e997131402199419c13a941f8e4e198e2da1ce57dbf5cf401282',
  bytes: 310_414_022,
  licence: 'Apache-2.0',
  extract: {
    'sherpa-onnx-streaming-zipformer-en-2023-06-26/encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx': 'encoder.int8.onnx',
    'sherpa-onnx-streaming-zipformer-en-2023-06-26/decoder-epoch-99-avg-1-chunk-16-left-128.onnx': 'decoder.onnx',
    'sherpa-onnx-streaming-zipformer-en-2023-06-26/joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx': 'joiner.int8.onnx',
    'sherpa-onnx-streaming-zipformer-en-2023-06-26/tokens.txt': 'tokens.txt',
    'sherpa-onnx-streaming-zipformer-en-2023-06-26/README.md': 'README.md',
  },
};

/** Silero VAD (snakers4/silero-vad), 0.6 MB. */
export const VAD_MODEL: ModelDownload = {
  id: 'vad',
  url: `${RELEASES}/asr-models/silero_vad.onnx`,
  sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6',
  bytes: 643_854,
  licence: 'MIT',
  file: 'silero_vad.onnx',
};

function piperVoice(name: string, sha256: string, bytes: number): ModelDownload {
  const dir = `vits-piper-${name}`;
  return {
    id: `tts-${name}`,
    url: `${RELEASES}/tts-models/${dir}.tar.bz2`,
    sha256,
    bytes,
    licence: 'Piper voice (MIT code); training data public domain (see MODEL_CARD). espeak-ng-data: GPL-3.0',
    extract: {
      [`${dir}/${name}.onnx`]: 'model.onnx',
      [`${dir}/tokens.txt`]: 'tokens.txt',
      [`${dir}/MODEL_CARD`]: 'MODEL_CARD',
      [`${dir}/espeak-ng-data`]: 'espeak-ng-data',
    },
  };
}

/** Piper VITS voices (22.05 kHz). ~82 MB on disk each. Pick one with `TTS_VOICE`. */
export const TTS_VOICES = {
  /** UK English female, trained on LibriVox recordings (public domain). Default. */
  cori: piperVoice('en_GB-cori-medium', '49c9a5361bbdd95d7ca9687c4de11e5908481f65e7c7c368960df79949fdac2b', 67_257_412),
  /** US English female, trained on LJ Speech (public domain). */
  ljspeech: piperVoice('en_US-ljspeech-medium', '3dfb4b759d8be032a4903a9538d128b0fda2a06ab1de6cbc2d93a97e2dd83dba', 67_169_893),
} as const satisfies Record<string, ModelDownload>;

export type TtsVoice = keyof typeof TTS_VOICES;
export const DEFAULT_VOICE: TtsVoice = 'cori';

export function isVoice(v: string): v is TtsVoice {
  return Object.hasOwn(TTS_VOICES, v);
}

/** Default models dir: `poc/packages/speech/models` (gitignored). Override with SPEECH_MODELS_DIR. */
export const DEFAULT_MODELS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'models');

/** Paths the sherpa engine loads, under `modelsDir`. */
export function modelPaths(modelsDir: string, voice: TtsVoice) {
  const asr = path.join(modelsDir, ASR_MODEL.id);
  const tts = path.join(modelsDir, TTS_VOICES[voice].id);
  return {
    asr: {
      encoder: path.join(asr, 'encoder.int8.onnx'),
      decoder: path.join(asr, 'decoder.onnx'),
      joiner: path.join(asr, 'joiner.int8.onnx'),
      tokens: path.join(asr, 'tokens.txt'),
    },
    vad: path.join(modelsDir, VAD_MODEL.id, VAD_MODEL.file!),
    tts: {
      model: path.join(tts, 'model.onnx'),
      tokens: path.join(tts, 'tokens.txt'),
      dataDir: path.join(tts, 'espeak-ng-data'),
    },
  };
}

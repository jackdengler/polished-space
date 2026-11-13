import type { TtsEngine } from './engine/types';
import { float32ToPcm16 } from './pcm';

/**
 * Splits text into pieces to synthesise one at a time: sentences, and long
 * sentences at commas or other clause breaks, so the first audio is ready
 * soon and an abort takes effect at the next piece. A first sentence longer
 * than `firstMaxChars` is also split at its first comma or colon.
 */
export function splitForSpeech(text: string, maxChars = 140, firstMaxChars = 60): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?;]+(?:[.!?;]+["')\]]*|$)/g) ?? [clean];
  const out: string[] = [];
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if (s.length <= maxChars) {
      out.push(s);
      continue;
    }
    // Long sentence: break at commas/dashes/colons, then at spaces.
    let cur = '';
    for (const part of s.split(/(?<=[,:—–])\s+|\s+(?=[—–-]\s)/)) {
      if (cur && (cur + ' ' + part).length > maxChars) {
        out.push(...hardWrap(cur, maxChars));
        cur = part;
      } else cur = cur ? `${cur} ${part}` : part;
    }
    if (cur) out.push(...hardWrap(cur, maxChars));
  }
  const pieces = out.filter((p) => /[\p{L}\p{N}]/u.test(p));
  // Faster first audio: speak a long first sentence's opening clause on its own.
  const first = pieces[0];
  if (first && first.length > firstMaxChars) {
    const m = /^(.{15,}?[,:])\s+(.{15,})$/su.exec(first);
    if (m) pieces.splice(0, 1, m[1]!, m[2]!);
  }
  return pieces;
}

function hardWrap(s: string, max: number): string[] {
  if (s.length <= max) return [s];
  const out: string[] = [];
  let cur = '';
  for (const w of s.split(' ')) {
    if (cur && cur.length + 1 + w.length > max) {
      out.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  return out;
}

export interface TtsStats {
  jobs: number;
  completed: number;
  aborted: number;
  piecesSynthesised: number;
  piecesSkipped: number;
  active: number;
}

/**
 * Streams speech for text as PCM16 LE chunks, one engine call at a time
 * (calls from all requests are serialised: the engine is single-instance).
 * Aborting stops before the next piece; the piece already being synthesised
 * (at most ~0.3 s of work) is discarded.
 */
export class TtsService {
  readonly stats: TtsStats = { jobs: 0, completed: 0, aborted: 0, piecesSynthesised: 0, piecesSkipped: 0, active: 0 };
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly engine: TtsEngine, private readonly chunkMs = 100) {}

  get sampleRate(): number {
    return this.engine.sampleRate;
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  async *speak(text: string, signal: AbortSignal): AsyncGenerator<Uint8Array> {
    const pieces = splitForSpeech(text);
    this.stats.jobs++;
    this.stats.active++;
    let done = 0;
    try {
      for (const piece of pieces) {
        if (signal.aborted) break;
        const samples = await this.exclusive(async () => {
          if (signal.aborted) return null;
          const s = await this.engine.synthesize(piece);
          this.stats.piecesSynthesised++;
          return s;
        });
        if (!samples || signal.aborted) break;
        done++;
        const step = Math.max(1, Math.round((this.engine.sampleRate * this.chunkMs) / 1000));
        for (let i = 0; i < samples.length; i += step) {
          if (signal.aborted) break;
          yield float32ToPcm16(samples.subarray(i, i + step));
        }
      }
    } finally {
      this.stats.active--;
      this.stats.piecesSkipped += pieces.length - done;
      if (signal.aborted) this.stats.aborted++;
      else this.stats.completed++;
    }
  }
}

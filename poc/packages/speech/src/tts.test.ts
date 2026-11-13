import { describe, expect, it } from 'vitest';
import type { TtsEngine } from './engine/types';
import { FakeTts } from './engine/fake';
import { splitForSpeech, TtsService } from './tts';

describe('splitForSpeech', () => {
  it('splits sentences and keeps punctuation', () => {
    expect(splitForSpeech('Done. Anything else? Yes!')).toEqual(['Done.', 'Anything else?', 'Yes!']);
  });

  it('keeps a trailing fragment without punctuation', () => {
    expect(splitForSpeech('First one. and then')).toEqual(['First one.', 'and then']);
  });

  it('splits a long first sentence at its first comma', () => {
    expect(splitForSpeech('You have three things due today, and the Harborlight report is the most urgent.')).toEqual([
      'You have three things due today,',
      'and the Harborlight report is the most urgent.',
    ]);
  });

  it('breaks very long sentences into pieces under the limit', () => {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ') + ', ' + Array.from({ length: 30 }, (_, i) => `more${i}`).join(' ') + '.';
    const pieces = splitForSpeech(long);
    expect(pieces.length).toBeGreaterThan(2);
    expect(pieces.every((p) => p.length <= 140)).toBe(true);
    expect(pieces.join(' ').replace(/\s+/g, ' ')).toBe(long);
  });

  it('drops pieces with no letters or digits', () => {
    expect(splitForSpeech('...  !')).toEqual([]);
    expect(splitForSpeech('   ')).toEqual([]);
  });
});

async function collect(it: AsyncIterable<Uint8Array>) {
  const chunks: Uint8Array[] = [];
  for await (const c of it) chunks.push(c);
  return chunks;
}

describe('TtsService', () => {
  it('streams PCM16 for every piece in ~100 ms chunks', async () => {
    const engine = new FakeTts(60);
    const svc = new TtsService(engine);
    const chunks = await collect(svc.speak('Hello there. Bye.', new AbortController().signal));
    const bytes = chunks.reduce((n, c) => n + c.length, 0);
    expect(engine.calls).toEqual(['Hello there.', 'Bye.']);
    expect(bytes).toBe(2 * Math.round((('Hello there.'.length * 60 * 22050) / 1000)) + 2 * Math.round(('Bye.'.length * 60 * 22050) / 1000));
    expect(chunks[0]!.length).toBe(2 * Math.round(22050 * 0.1));
    expect(svc.stats).toMatchObject({ jobs: 1, completed: 1, aborted: 0, piecesSynthesised: 2, active: 0 });
  });

  it('stops synthesising when aborted', async () => {
    const engine = new FakeTts(60, 20);
    const svc = new TtsService(engine);
    const ac = new AbortController();
    let n = 0;
    for await (const _ of svc.speak('One. Two. Three. Four. Five.', ac.signal)) {
      if (++n === 1) ac.abort();
    }
    await new Promise((r) => setTimeout(r, 100));
    expect(engine.calls).toEqual(['One.']);
    expect(svc.stats).toMatchObject({ aborted: 1, piecesSynthesised: 1, piecesSkipped: 4, active: 0 });
  });

  it('runs one engine call at a time across jobs', async () => {
    let running = 0;
    let maxRunning = 0;
    const engine: TtsEngine = {
      sampleRate: 16000,
      async synthesize() {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 10));
        running--;
        return new Float32Array(160);
      },
    };
    const svc = new TtsService(engine);
    const sig = new AbortController().signal;
    await Promise.all([collect(svc.speak('A one. A two.', sig)), collect(svc.speak('B one. B two.', sig))]);
    expect(maxRunning).toBe(1);
    expect(svc.stats.piecesSynthesised).toBe(4);
  });

  it('skips a job aborted while waiting for the engine', async () => {
    const engine = new FakeTts(60, 30);
    const svc = new TtsService(engine);
    const first = collect(svc.speak('First job.', new AbortController().signal));
    const ac = new AbortController();
    const second = collect(svc.speak('Second job.', ac.signal));
    ac.abort();
    await Promise.all([first, second]);
    expect(engine.calls).toEqual(['First job.']);
  });
});

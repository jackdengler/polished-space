import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { AUDIO, ErrorBody, Health, PATHS, SttEvent } from '@poc/contracts';
import { HttpSpeechToText, HttpTextToSpeech } from './client';
import { createFakeEngine, silence, tone } from './engine/fake';
import { float32ToPcm16 } from './pcm';
import { createSpeechServer, type SpeechHealth, type SpeechServer } from './server';

const STT = { endpointMs: 400, minSpeechMs: 200, vadThreshold: 0.5, prerollMs: 500, maxUtteranceS: 30, tailPadMs: 300 };
let app: SpeechServer;
let engine: ReturnType<typeof createFakeEngine>;
let base: string;
const logs: string[] = [];

beforeAll(async () => {
  engine = createFakeEngine({ ttsDelayMs: 15 });
  app = createSpeechServer({ engine, stt: STT, log: (m) => logs.push(m) });
  const port = await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${port}`;
});
afterAll(() => app.close());

const utterance = () => float32ToPcm16(new Float32Array([...silence(300), ...tone(1000), ...silence(800)]));
const health = async () => (await (await fetch(base + PATHS.speech.health)).json()) as SpeechHealth;

describe('speech server (fake engine)', () => {
  it('GET /health matches the contract and reports the TTS rate', async () => {
    const res = await fetch(base + PATHS.speech.health);
    expect(res.status).toBe(200);
    const body = (await res.json()) as SpeechHealth;
    expect(Health.parse(body)).toMatchObject({ ok: true, service: 'speech' });
    expect(body.ttsSampleRate).toBe(22050);
    expect(body.sttSampleRate).toBe(AUDIO.sttSampleRate);
    expect(body.engine).toBe('fake');
  });

  it('WS /stt turns PCM frames into speech_start, partial and final JSON messages', async () => {
    const ws = new WebSocket(base.replace('http', 'ws') + PATHS.speech.stt);
    await new Promise((r) => ws.once('open', r));
    const msgs: SttEvent[] = [];
    const gotFinal = new Promise<void>((resolve) =>
      ws.on('message', (data, isBinary) => {
        expect(isBinary).toBe(false);
        const e = SttEvent.parse(JSON.parse(String(data)));
        msgs.push(e);
        if (e.type === 'final') resolve();
      }),
    );
    const pcm = utterance();
    for (let i = 0; i < pcm.length; i += 640) ws.send(pcm.subarray(i, i + 640));
    await gotFinal;
    ws.close();
    expect(msgs[0]).toEqual({ type: 'speech_start' });
    expect(msgs.some((m) => m.type === 'partial')).toBe(true);
    expect(msgs.at(-1)).toEqual({ type: 'final', text: 'Add a task to chase michael on friday' });
  });

  it('WS /stt ignores text frames', async () => {
    const ws = new WebSocket(base.replace('http', 'ws') + PATHS.speech.stt);
    await new Promise((r) => ws.once('open', r));
    const msgs: unknown[] = [];
    ws.on('message', (d) => msgs.push(d));
    ws.send(JSON.stringify({ type: 'start' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(msgs).toEqual([]);
    ws.close();
  });

  it('POST /tts streams PCM16 with X-Sample-Rate', async () => {
    const res = await fetch(base + PATHS.speech.tts, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Hi. Bye.' }) });
    expect(res.status).toBe(200);
    expect(res.headers.get(AUDIO.ttsSampleRateHeader)).toBe('22050');
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    const bytes = new Uint8Array(await res.arrayBuffer());
    const expected = 2 * (Math.round((3 * 60 * 22050) / 1000) + Math.round((4 * 60 * 22050) / 1000));
    expect(bytes.length).toBe(expected);
  });

  it('POST /tts rejects bad bodies with { error }', async () => {
    for (const body of ['not json', JSON.stringify({}), JSON.stringify({ text: '   ' })]) {
      const res = await fetch(base + PATHS.speech.tts, { method: 'POST', body });
      expect(res.status).toBe(400);
      ErrorBody.parse(await res.json());
    }
    const big = await fetch(base + PATHS.speech.tts, { method: 'POST', body: JSON.stringify({ text: 'x'.repeat(20000) }) });
    expect(big.status).toBe(413);
  });

  it('answers wrong methods and paths with { error }', async () => {
    expect((await fetch(base + PATHS.speech.tts)).status).toBe(405);
    expect((await fetch(base + PATHS.speech.stt)).status).toBe(426);
    const nf = await fetch(base + '/nope');
    expect(nf.status).toBe(404);
    ErrorBody.parse(await nf.json());
  });

  it('client disconnect mid-stream stops synthesis', async () => {
    const before = (await health()).tts;
    const callsBefore = engine.tts.calls.length;
    const ac = new AbortController();
    const res = await fetch(base + PATHS.speech.tts, {
      method: 'POST',
      body: JSON.stringify({ text: 'One. Two. Three. Four. Five. Six. Seven. Eight.' }),
      signal: ac.signal,
    });
    const reader = res.body!.getReader();
    await reader.read();
    ac.abort();
    await new Promise((r) => setTimeout(r, 200));
    const after = (await health()).tts;
    expect(after.aborted).toBe(before.aborted + 1);
    expect(after.active).toBe(0);
    expect(engine.tts.calls.length - callsBefore).toBeLessThanOrEqual(2);
    expect(logs.some((l) => /tts#\d+ aborted/.test(l))).toBe(true);
  });

  it('HttpSpeechToText and HttpTextToSpeech implement the contract against the server', async () => {
    const stt = new HttpSpeechToText(base).open();
    const pcm = utterance();
    for (let i = 0; i < pcm.length; i += 640) stt.write(pcm.subarray(i, i + 640)); // buffered until open
    const events: SttEvent[] = [];
    for await (const e of stt.events) {
      events.push(e);
      if (e.type === 'final') break;
    }
    stt.close();
    expect(events[0]?.type).toBe('speech_start');
    expect(events.at(-1)?.type).toBe('final');

    const tts = await HttpTextToSpeech.connect(base);
    expect(tts.sampleRate).toBe(22050);
    let bytes = 0;
    for await (const c of tts.speak('Hello.', new AbortController().signal)) {
      expect(c.length % 2).toBe(0);
      bytes += c.length;
    }
    expect(bytes).toBe(2 * Math.round((6 * 60 * 22050) / 1000));

    const ac = new AbortController();
    let n = 0;
    for await (const _ of tts.speak('One. Two. Three. Four.', ac.signal)) {
      if (++n === 1) ac.abort();
    }
    expect(n).toBe(1);
  });
});

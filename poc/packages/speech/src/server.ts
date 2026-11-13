import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { AUDIO, PATHS, TtsRequest, type ErrorBody, type Health, type SttEvent } from '@poc/contracts';
import type { SttConfig } from './config';
import type { SpeechEngine } from './engine/types';
import { SttSession } from './stt';
import { TtsService } from './tts';

export interface SpeechServerOptions {
  engine: SpeechEngine;
  stt: SttConfig;
  log?: (msg: string) => void;
}

export interface SpeechServer {
  server: http.Server;
  tts: TtsService;
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

/** Health body: the contract's `Health` plus service details. */
export interface SpeechHealth extends Health {
  engine: string;
  ttsSampleRate: number;
  sttSampleRate: number;
  sttSessions: number;
  tts: TtsService['stats'];
}

const MAX_TTS_BODY = 16 * 1024;

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
  res.end(data);
}

function sendError(res: http.ServerResponse, status: number, error: string): void {
  sendJson(res, status, { error } satisfies ErrorBody);
}

function readBody(req: http.IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let size = 0;
    // Over the limit: keep draining (so the 413 reaches the client) but drop the data.
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size <= limit) parts.push(c);
    });
    req.on('end', () => (size > limit ? reject(new Error('body too large')) : resolve(Buffer.concat(parts).toString('utf8'))));
    req.on('error', reject);
  });
}

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return Buffer.concat(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return data;
}

export function createSpeechServer(opts: SpeechServerOptions): SpeechServer {
  const { engine } = opts;
  const log = opts.log ?? ((m: string) => console.log(`[speech] ${m}`));
  const tts = new TtsService(engine.tts);
  let sttSessions = 0;
  let nextId = 1;

  async function handleTts(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    let text: string;
    try {
      const parsed = TtsRequest.safeParse(JSON.parse(await readBody(req, MAX_TTS_BODY)));
      if (!parsed.success) return sendError(res, 400, 'body must be { "text": "<non-empty string>" }');
      text = parsed.data.text;
    } catch (e) {
      return sendError(res, e instanceof Error && e.message === 'body too large' ? 413 : 400, 'body must be JSON { "text": "..." }');
    }

    const id = nextId++;
    const ac = new AbortController();
    // 'close' on the response fires on client disconnect (and after a normal end).
    res.on('close', () => { if (!res.writableFinished) ac.abort(); });

    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      [AUDIO.ttsSampleRateHeader]: String(tts.sampleRate),
      'X-Audio-Format': 'pcm_s16le; channels=1',
      'Cache-Control': 'no-store',
    });
    res.flushHeaders();

    const t0 = performance.now();
    let firstMs = -1;
    let bytes = 0;
    try {
      for await (const chunk of tts.speak(text, ac.signal)) {
        if (firstMs < 0) firstMs = performance.now() - t0;
        bytes += chunk.length;
        if (!res.write(chunk)) {
          await new Promise<void>((resolve) => {
            const done = () => { res.off('drain', done); res.off('close', done); resolve(); };
            res.on('drain', done);
            res.on('close', done);
          });
        }
        if (ac.signal.aborted) break;
      }
      if (!ac.signal.aborted) res.end();
    } catch (e) {
      log(`tts#${id} error: ${e instanceof Error ? e.message : String(e)}`);
      res.destroy();
      return;
    }
    const audioMs = Math.round((bytes / 2 / tts.sampleRate) * 1000);
    log(
      `tts#${id} ${ac.signal.aborted ? 'aborted' : 'done'} chars=${text.length} first_audio_ms=${Math.round(firstMs)} ` +
        `total_ms=${Math.round(performance.now() - t0)} audio_ms=${audioMs}`,
    );
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://speech');
    if (req.method === 'GET' && url.pathname === PATHS.speech.health) {
      const body: SpeechHealth = {
        ok: true,
        service: 'speech',
        now: new Date().toISOString(),
        engine: engine.name,
        ttsSampleRate: tts.sampleRate,
        sttSampleRate: AUDIO.sttSampleRate,
        sttSessions,
        tts: { ...tts.stats },
      };
      return sendJson(res, 200, body);
    }
    if (url.pathname === PATHS.speech.tts) {
      if (req.method !== 'POST') return sendError(res, 405, 'use POST');
      handleTts(req, res).catch((e) => {
        log(`tts handler failed: ${String(e)}`);
        if (!res.headersSent) sendError(res, 500, 'tts failed');
        else res.destroy();
      });
      return;
    }
    if (url.pathname === PATHS.speech.stt) return sendError(res, 426, 'WebSocket upgrade required');
    sendError(res, 404, 'not found');
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://speech');
    if (url.pathname !== PATHS.speech.stt) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onStt(ws));
  });

  function onStt(ws: WebSocket): void {
    const id = nextId++;
    sttSessions++;
    const t0 = performance.now();
    let audioSamples = 0;
    let uttStart = 0;
    const send = (e: SttEvent) => {
      const at = Math.round(((audioSamples / AUDIO.sttSampleRate) * 1000));
      if (e.type === 'speech_start') uttStart = at;
      if (e.type !== 'partial') log(`stt#${id} ${e.type} at_audio_ms=${at}${e.type === 'final' ? ` utt_ms=${at - uttStart} text="${e.text}"` : ''}`);
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(e));
    };
    const session = new SttSession(engine, opts.stt, send);
    log(`stt#${id} open`);
    ws.on('message', (data, isBinary) => {
      if (!isBinary) return; // the protocol has no client text messages
      const bytes = toBytes(data);
      audioSamples += bytes.length >> 1;
      try {
        session.write(bytes);
      } catch (e) {
        log(`stt#${id} error: ${String(e)}`);
        ws.close(1011, 'stt failed');
      }
    });
    ws.on('close', () => {
      session.close();
      sttSessions--;
      log(`stt#${id} closed audio_s=${(audioSamples / AUDIO.sttSampleRate).toFixed(1)} wall_s=${((performance.now() - t0) / 1000).toFixed(1)}`);
    });
    ws.on('error', (e) => log(`stt#${id} socket error: ${e.message}`));
  }

  return {
    server,
    tts,
    listen(port, host = '0.0.0.0') {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve((server.address() as AddressInfo).port));
      });
    },
    close() {
      for (const c of wss.clients) c.terminate();
      wss.close();
      server.closeAllConnections();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

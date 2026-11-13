/**
 * Fixture brain server for developing and testing the sidebar without the
 * real brain. Serves the contract's `/api` endpoints (HTTP, SSE and the
 * `WS /api/voice` socket) from fixture data, plus either the built app
 * (`--static dist`, like the gateway does) or Vite in middleware mode (`--dev`).
 *
 *   tsx fixture/server.ts --port 5190 --dev            # development with HMR
 *   tsx fixture/server.ts --port 5190 --static dist    # serve the build
 *
 * Options: --now <ISO|real> (default 2026-11-11T09:40:00Z, a Wednesday).
 *
 * Fixture-only test hooks live under `/__fixture/*` (never used by the app):
 *   GET  /__fixture/log       decisions and calls received
 *   GET  /__fixture/voice     voice socket stats (frames received, sizes)
 *   GET  /__fixture/sent      mail "sent" by approved send_reply suggestions
 *   POST /__fixture/reset     back to the fixture data
 *   POST /__fixture/drop      drop a new email (nudge + suggestion)
 *   POST /__fixture/outage    {ms}: refuse /api and drop SSE for ms
 *   POST /__fixture/interrupt barge in on the voice reply in progress
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { AUDIO, PATHS, VoiceClientMessage, type VoiceServerMessage } from '@poc/contracts';
import { FixtureBrain } from './brain';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const port = Number(opt('port') ?? 5190);
const staticDir = opt('static');
const dev = args.includes('--dev');
const nowArg = opt('now') ?? process.env.FIXTURE_NOW ?? '2026-11-11T09:40:00Z';
const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const startReal = Date.now();
const fixed = nowArg === 'real' ? null : Date.parse(nowArg);
// The clock advances in real time from the fixed start, so "x min ago" stays sensible.
const clock = () => new Date(fixed === null ? Date.now() : fixed + (Date.now() - startReal));
const brain = new FixtureBrain(clock);

let outageUntil = 0;
const sseClients = new Set<ServerResponse>();

const voiceStats = { connections: 0, starts: 0, stops: 0, frames: 0, badFrames: 0, bytes: 0, lastFrameBytes: 0 };
const voiceSockets = new Set<VoiceSession>();

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return Symbol.for('bad-json');
  }
}

function sse(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

brain.subscribe((event, data) => {
  for (const res of sseClients) sse(res, event, data);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const path = url.pathname;
  const method = req.method ?? 'GET';

  if (Date.now() < outageUntil) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'The assistant is unavailable.' }));
    return;
  }

  if (method === 'GET' && path === PATHS.brain.state) return json(res, 200, brain.state());
  if (method === 'GET' && path === PATHS.brain.health) return json(res, 200, { ok: true, service: 'brain-fixture', now: clock().toISOString() });
  if (method === 'GET' && path === PATHS.brain.usage) return json(res, 200, { today: brain.world.usage, days: [brain.world.usage] });

  if (method === 'GET' && path === PATHS.brain.events) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 1000\n\n');
    sse(res, 'state', brain.state());
    sseClients.add(res);
    const ka = setInterval(() => res.write(': keepalive\n\n'), 15000);
    req.on('close', () => {
      clearInterval(ka);
      sseClients.delete(res);
    });
    return;
  }

  let m: RegExpMatchArray | null;
  if (method === 'POST' && (m = path.match(/^\/api\/suggestions\/([^/]+)\/(approve|deny)$/))) {
    const body = await readBody(req);
    if (typeof body === 'symbol') return json(res, 400, { error: 'Bad JSON.' });
    const id = decodeURIComponent(m[1]!);
    const [status, out] = m[2] === 'approve' ? brain.approve(id, body) : brain.deny(id);
    return json(res, status, out);
  }

  if (method === 'POST' && path === PATHS.brain.input) {
    const body = (await readBody(req)) as { text?: unknown } | undefined;
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) return json(res, 400, { error: 'Type something first.' });
    brain.log.push({ at: new Date().toISOString(), action: 'input', body });
    return json(res, 200, { suggestions: [brain.intake(text, 'manual')] });
  }

  if (method === 'POST' && path === PATHS.brain.chat) {
    const body = (await readBody(req)) as { text?: unknown } | undefined;
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) return json(res, 400, { error: 'Type something first.' });
    brain.log.push({ at: new Date().toISOString(), action: 'chat', body });
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    const { words, suggestion } = brain.reply(text);
    let full = '';
    let closed = false;
    req.on('close', () => (closed = true));
    res.on('close', () => (closed = true));
    for (let i = 0; i < words.length && !closed; i++) {
      await sleep(35);
      full += words[i];
      sse(res, 'delta', { text: words[i] });
      if (suggestion && i === Math.floor(words.length / 2)) sse(res, 'suggestion', { suggestion });
    }
    if (!closed) sse(res, 'done', { text: full });
    res.end();
    return;
  }

  if ((m = path.match(/^\/api\/tasks\/([^/]+)\/(prepared|prepare|hold)$/))) {
    const id = decodeURIComponent(m[1]!);
    if (method === 'GET' && m[2] === 'prepared') {
      const p = brain.prepared(id);
      return p ? json(res, 200, p) : json(res, 404, { error: 'No such task.' });
    }
    if (method === 'POST' && m[2] === 'prepare') {
      return brain.prepare(id) ? json(res, 202, brain.prepared(id)) : json(res, 404, { error: 'No such task.' });
    }
    if (method === 'POST' && m[2] === 'hold') {
      const body = (await readBody(req)) as { onHold?: unknown } | undefined;
      if (typeof body?.onHold !== 'boolean') return json(res, 400, { error: 'onHold must be true or false.' });
      const meta = brain.hold(id, body.onHold);
      return meta ? json(res, 200, meta) : json(res, 404, { error: 'No such task.' });
    }
  }

  if (method === 'GET' && path === PATHS.brain.profiles) {
    return json(res, 200, { profiles: brain.world.profiles.map(({ markdown: _m, ...p }) => p) });
  }
  if (method === 'GET' && (m = path.match(/^\/api\/profiles\/([^/]+)$/))) {
    const p = brain.world.profiles.find((x) => x.clientId === decodeURIComponent(m![1]!));
    return p ? json(res, 200, p) : json(res, 404, { error: 'No profile for that client.' });
  }

  json(res, 404, { error: `No route for ${method} ${path}` });
}

async function handleFixture(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const path = url.pathname;
  if (path === '/__fixture/log') return json(res, 200, brain.log);
  if (path === '/__fixture/voice') return json(res, 200, voiceStats);
  if (path === '/__fixture/sent') return json(res, 200, brain.sent);
  if (req.method !== 'POST') return json(res, 404, { error: 'not found' });
  if (path === '/__fixture/reset') {
    brain.reset();
    Object.assign(voiceStats, { connections: 0, starts: 0, stops: 0, frames: 0, badFrames: 0, bytes: 0, lastFrameBytes: 0 });
    return json(res, 200, { ok: true });
  }
  if (path === '/__fixture/drop') {
    brain.dropEmail();
    return json(res, 200, { ok: true });
  }
  if (path === '/__fixture/outage') {
    const body = (await readBody(req)) as { ms?: number } | undefined;
    outageUntil = Date.now() + (body?.ms ?? 3000);
    for (const c of sseClients) c.destroy();
    sseClients.clear();
    return json(res, 200, { ok: true });
  }
  if (path === '/__fixture/interrupt') {
    for (const v of voiceSockets) v.interrupt();
    return json(res, 200, { ok: true, sessions: voiceSockets.size });
  }
  json(res, 404, { error: 'not found' });
}

// ---- WS /api/voice --------------------------------------------------------

const FRAME_BYTES = (AUDIO.sttSampleRate * AUDIO.sttFrameMs * 2) / 1000; // 640
const TTS_RATE = 24000;

/** A scripted voice session: partials as frames arrive, a final, then a streamed spoken reply. */
class VoiceSession {
  private frames = 0;
  private turnStarted = false;
  private speaking = false;
  private interruptedFlag = false;
  private spoken = '';

  constructor(private readonly ws: WebSocket) {}

  send(m: VoiceServerMessage): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(m));
  }

  onBinary(buf: Buffer): void {
    voiceStats.frames++;
    voiceStats.bytes += buf.length;
    voiceStats.lastFrameBytes = buf.length;
    if (buf.length !== FRAME_BYTES) voiceStats.badFrames++;
    this.frames++;
    if (this.turnStarted) return;
    // 25 frames = 0.5 s of audio.
    if (this.frames === 25) this.send({ type: 'stt.partial', text: 'add a task' });
    if (this.frames === 50) this.send({ type: 'stt.partial', text: 'add a task to chase' });
    if (this.frames === 75) this.send({ type: 'stt.partial', text: 'add a task to chase Michael' });
    if (this.frames === 100) {
      this.turnStarted = true;
      void this.turn('Add a task to chase Michael on Friday.');
    }
  }

  interrupt(): void {
    if (!this.speaking) return;
    this.interruptedFlag = true;
  }

  private async turn(text: string): Promise<void> {
    this.send({ type: 'stt.final', text });
    const s = brain.intake(text, 'voice');
    const words = `Okay. I’ve added a task to chase Michael on Friday, tagged ${s.clientId ? 'Acme Tooling' : 'for you to check'}. It’s waiting for your approval. Anything else you want me to line up for Friday while we’re at it?`.split(/(?<= )/);
    await sleep(300);
    this.send({ type: 'assistant.audio.start', sampleRate: TTS_RATE });
    this.speaking = true;
    this.interruptedFlag = false;
    this.spoken = '';
    let full = '';
    let phase = 0;
    // ~0.25 s of tone per word, sent a little faster than real time.
    for (const w of words) {
      if (this.interruptedFlag || this.ws.readyState !== this.ws.OPEN) break;
      full += w;
      this.send({ type: 'assistant.delta', text: w });
      this.spoken += w;
      for (let c = 0; c < 5; c++) {
        if (this.interruptedFlag) break;
        const n = (TTS_RATE * 50) / 1000;
        const pcm = new Int16Array(n);
        for (let i = 0; i < n; i++) pcm[i] = Math.round(Math.sin((phase++ * 2 * Math.PI * 220) / TTS_RATE) * 2500);
        if (this.ws.readyState === this.ws.OPEN) this.ws.send(Buffer.from(pcm.buffer));
        await sleep(40);
      }
    }
    this.speaking = false;
    if (this.interruptedFlag) {
      this.send({ type: 'interrupted', spokenText: this.spoken.trim() });
      this.interruptedFlag = false;
    } else {
      this.send({ type: 'assistant.done', text: full.trim() });
    }
  }
}

const wss = new WebSocketServer({ noServer: true });
wss.on('connection', (ws) => {
  voiceStats.connections++;
  const session = new VoiceSession(ws);
  voiceSockets.add(session);
  ws.on('message', (data, isBinary) => {
    if (isBinary) return session.onBinary(data as Buffer);
    try {
      const m = VoiceClientMessage.parse(JSON.parse(data.toString()));
      if (m.type === 'start') voiceStats.starts++;
      else voiceStats.stops++;
    } catch {
      session.send({ type: 'error', error: 'Unknown message.' });
    }
  });
  ws.on('close', () => voiceSockets.delete(session));
});

// ---- static / dev ---------------------------------------------------------

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };

function serveStatic(dir: string, url: URL, res: ServerResponse): void {
  const root = resolve(pkgDir, dir);
  let file = normalize(join(root, decodeURIComponent(url.pathname)));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
}

const server = createServer();
let viteMiddleware: ((req: IncomingMessage, res: ServerResponse, next: () => void) => void) | null = null;

server.on('request', (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const done = (p: Promise<void>) =>
    p.catch((e) => {
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: 'Fixture server error.' });
    });
  if (url.pathname.startsWith('/api/')) return void done(handleApi(req, res, url));
  if (url.pathname.startsWith('/__fixture/')) return void done(handleFixture(req, res, url));
  if (viteMiddleware) return viteMiddleware(req, res, () => res.writeHead(404).end());
  if (staticDir) return serveStatic(staticDir, url, res);
  res.writeHead(404).end();
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== PATHS.brain.voice) return; // Vite's HMR socket handles its own upgrades in --dev.
  if (Date.now() < outageUntil) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

if (dev) {
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({ root: pkgDir, server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
  viteMiddleware = vite.middlewares;
}

server.listen(port, '127.0.0.1', () => {
  console.log(`fixture brain on http://127.0.0.1:${port} (${dev ? 'vite dev' : staticDir ? `static ${staticDir}` : 'api only'}), now=${clock().toISOString()}`);
});

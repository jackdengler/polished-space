/**
 * The brain's HTTP server: core routes, module routes, SSE and WebSocket
 * upgrade dispatch. Plain node:http, JSON in and out, `{ error }` on failure.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { HEARTBEAT_MS } from '@poc/contracts';
import { HttpProblem } from './httpProblem';
import type { Registry } from './modules/registry';
import type { RouteRequest } from './modules/types';

const MAX_BODY = 1_000_000;

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

export function sendError(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  sendJson(res, status, { error: message });
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpProblem(413, 'request body too large');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpProblem(400, 'request body is not valid JSON');
  }
}

/** Server-sent events hub for `/api/events`. */
export class SseHub {
  private clients = new Set<ServerResponse>();
  private keepAlive: NodeJS.Timeout;

  constructor() {
    // A named event (not a comment) so the browser's EventSource sees it: the sidebar treats
    // HEARTBEAT_TIMEOUT_MS of silence as "connection lost" (D2), whatever proxies sit in between.
    this.keepAlive = setInterval(() => {
      for (const c of this.clients) this.send(c, 'heartbeat', { now: new Date().toISOString() });
    }, HEARTBEAT_MS);
    this.keepAlive.unref();
  }

  open(res: ServerResponse): void {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(': connected\n\n');
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
  }

  send(res: ServerResponse, event: string, data: unknown): void {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  broadcast(event: string, data: unknown): void {
    for (const c of this.clients) this.send(c, event, data);
  }

  get size(): number {
    return this.clients.size;
  }

  close(): void {
    clearInterval(this.keepAlive);
    for (const c of this.clients) c.end();
    this.clients.clear();
  }
}

export function createBrainServer(registry: Registry, log: (msg: string) => void): Server {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://brain.local');
    const found = registry.match(req.method ?? 'GET', url.pathname);
    if (!('handler' in found)) {
      sendError(res, found.methodMismatch ? 405 : 404, found.methodMismatch ? 'method not allowed' : `no route ${url.pathname}`);
      return;
    }
    let bodyPromise: Promise<unknown> | null = null;
    const r: RouteRequest = { req, res, url, params: found.params, body: () => (bodyPromise ??= readBody(req)) };
    try {
      await found.handler(r);
    } catch (err) {
      if (err instanceof HttpProblem) sendError(res, err.status, err.message);
      else {
        log(`${req.method} ${url.pathname} failed: ${(err as Error).stack ?? err}`);
        sendError(res, 500, (err as Error).message || 'internal error');
      }
    }
  });
  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', 'http://brain.local').pathname;
    const handler = registry.upgradeFor(path);
    if (!handler) {
      socket.end('HTTP/1.1 404 Not Found\r\nconnection: close\r\ncontent-length: 0\r\n\r\n');
      return;
    }
    try {
      handler(req, socket, head);
    } catch (err) {
      log(`upgrade ${path} failed: ${(err as Error).message}`);
      socket.destroy();
    }
  });
  return server;
}

/**
 * Port 8080: the Planr build (static files) plus the storage API that Planr's
 * ServerAdapter uses. This API is Planr's own backend, not part of the MCP
 * surface: the brain must use the MCP server instead.
 */
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { PATHS } from '@poc/contracts';
import { BadRequest, RevConflict, writeAtomic, type WorkspaceStore } from './store';

const MAX_JSON = 20 * 1024 * 1024;
const MAX_LOGO = 5 * 1024 * 1024;
/** Logo file names and person ids: no slashes, no leading dot. */
const SAFE_NAME = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers }).end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new HttpError(413, 'Request body too large.');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  try {
    return JSON.parse((await readBody(req, MAX_JSON)).toString('utf8'));
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'Body is not valid JSON.');
  }
}

function safeName(raw: string): string {
  const name = decodeURIComponent(raw);
  if (!SAFE_NAME.test(name)) throw new HttpError(400, 'Invalid name.');
  return name;
}

export interface AppOptions {
  store: WorkspaceStore;
  /** The Planr build folder (vite's dist). */
  staticDir: string;
}

export function appHandler({ store, staticDir }: AppOptions) {
  const pmDir = store.pmDir;
  const logosDir = join(pmDir, 'logos');
  const personalDir = join(pmDir, 'personal');

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (path === PATHS.pm.health && method === 'GET') return send(res, 200, { ok: true, service: 'pm', now: new Date().toISOString() });

    if (path === PATHS.pm.workspace) {
      if (method === 'GET') return send(res, 200, await store.read());
      if (method === 'PUT') {
        const ifMatch = req.headers['if-match'];
        const rev = ifMatch === undefined ? undefined : Number(String(ifMatch).replace(/"/g, ''));
        if (rev !== undefined && !Number.isFinite(rev)) throw new HttpError(400, 'If-Match must be a rev number.');
        const body = (await readJson(req)) as { workspace?: unknown } | null;
        if (!body || typeof body !== 'object' || !('workspace' in body)) throw new HttpError(400, 'Body must be { workspace }.');
        return send(res, 200, await store.replace(body.workspace, { ifMatch: rev }));
      }
    }

    if (path === PATHS.pm.events && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      const push = (rev: number) => res.write(`data: ${JSON.stringify({ rev })}\n\n`);
      push(store.currentRev);
      const off = store.onChange(push);
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => { off(); clearInterval(ping); });
      return;
    }

    const logo = path.match(/^\/api\/logos\/([^/]+)$/);
    if (logo) {
      const file = join(logosDir, safeName(logo[1]!));
      if (method === 'GET') {
        try {
          const data = await readFile(file);
          return void res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream' }).end(data);
        } catch { return send(res, 404, { error: 'No such logo.' }); }
      }
      if (method === 'PUT') {
        await mkdir(logosDir, { recursive: true });
        await writeAtomic(file, await readBody(req, MAX_LOGO));
        return send(res, 200, { ok: true });
      }
    }

    const personal = path.match(/^\/api\/personal\/([^/]+)$/);
    if (personal) {
      const file = join(personalDir, `${safeName(personal[1]!)}.json`);
      if (method === 'GET') {
        // None yet → 200 null (not 404), so the browser console stays clean.
        if (!existsSync(file)) return send(res, 200, null);
        return send(res, 200, JSON.parse(await readFile(file, 'utf8')));
      }
      if (method === 'PUT') {
        const data = await readJson(req);
        await mkdir(personalDir, { recursive: true });
        await writeAtomic(file, JSON.stringify(data, null, 2) + '\n');
        return send(res, 200, { ok: true });
      }
    }

    if (path.startsWith('/api/')) return send(res, 404, { error: 'Not found.' });
    if (method !== 'GET' && method !== 'HEAD') return send(res, 405, { error: 'Method not allowed.' });
    return serveStatic(res, path);
  }

  async function serveStatic(res: ServerResponse, urlPath: string) {
    const rel = normalize(decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath)).replace(/^([/\\])+/, '');
    const file = join(staticDir, rel);
    if (!file.startsWith(staticDir + sep)) return send(res, 400, { error: 'Bad path.' });
    try {
      const s = await stat(file);
      if (!s.isFile()) throw new Error('not a file');
    } catch {
      if (rel === 'index.html') {
        return void res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
          .end(`The Planr build is missing at ${staticDir}. Build it first (npx vite build at the repo root).`);
      }
      return send(res, 404, { error: 'Not found.' });
    }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': rel === 'index.html' ? 'no-cache' : 'public, max-age=3600',
    });
    createReadStream(file).pipe(res);
  }

  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      await route(req, res);
    } catch (e) {
      if (e instanceof RevConflict) return send(res, 409, { error: e.message, rev: e.rev });
      if (e instanceof BadRequest) return send(res, 400, { error: e.message });
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error('pm-server request failed:', e);
      if (!res.headersSent) send(res, 500, { error: e instanceof Error ? e.message : String(e) });
    }
  };
}

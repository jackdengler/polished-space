// Local stand-in for the nginx gateway (poc/gateway/nginx.conf) when running
// WITHOUT Docker. Same host ports, loopback only:
//
//   5180  sidebar static build (SPA fallback) + /api -> brain (HTTP, SSE, WebSocket)
//   5181  Planr test copy -> pm-server app port
//   5182  control page + fake Graph / Zoom -> mocks
//
// It has no outbound Claude listener: without Docker the brain calls its
// POC_CLAUDE_BASE_URL directly (there is no network isolation in this mode).
//
//   node poc/scripts/gateway.mjs      (normally started by poc/scripts/dev.mjs)
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { extname, join, normalize, resolve, sep } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
};

/** Forward one HTTP request to `target` ({ host, port }), streaming both ways (SSE-safe). */
function proxy(req, res, target, log) {
  const up = request(
    { host: target.host, port: target.port, method: req.method, path: req.url, headers: { ...req.headers, host: `${target.host}:${target.port}` } },
    (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      res.flushHeaders?.();
      r.pipe(res);
    },
  );
  up.on('error', (e) => {
    log?.(`proxy ${req.method} ${req.url} -> ${target.port} failed: ${e.code ?? e.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: `upstream on port ${target.port} is not answering` }));
    } else res.destroy();
  });
  res.on('close', () => up.destroy());
  req.pipe(up);
}

/** Forward a WebSocket upgrade as raw bytes. */
function proxyUpgrade(req, socket, head, target) {
  const up = connect(target.port, target.host, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i];
      lines.push(`${k}: ${k.toLowerCase() === 'host' ? `${target.host}:${target.port}` : req.rawHeaders[i + 1]}`);
    }
    up.write(lines.join('\r\n') + '\r\n\r\n');
    if (head?.length) up.write(head);
    up.pipe(socket);
    socket.pipe(up);
  });
  const end = () => {
    up.destroy();
    socket.destroy();
  };
  up.on('error', end);
  socket.on('error', end);
  up.on('close', end);
  socket.on('close', end);
}

function serveStatic(root, req, res) {
  const url = new URL(req.url ?? '/', 'http://x');
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = resolve(root, '.' + normalize(rel));
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html'); // SPA fallback (try_files)
  if (!existsSync(file)) {
    res.writeHead(503, { 'content-type': 'text/plain' }).end('The sidebar is not built yet (npm --prefix poc run build -w @poc/sidebar).');
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'cache-control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=300' });
  createReadStream(file).pipe(res);
}

/**
 * Start the three listeners. Returns { close() }.
 * opts: { sidebarDir, brain: {host,port}, pm: {host,port}, mocks: {host,port}, ports: {sidebar,pm,mocks}, bind, log }
 */
export async function startGateway(opts) {
  const bind = opts.bind ?? '127.0.0.1';
  const log = opts.log ?? (() => {});
  const root = resolve(opts.sidebarDir);
  const servers = [];
  const listen = (port, handler, upgrade) =>
    new Promise((ok, fail) => {
      const s = createServer(handler);
      if (upgrade) s.on('upgrade', upgrade);
      s.once('error', fail);
      s.listen(port, bind, () => ok(s));
      servers.push(s);
    });
  await listen(
    opts.ports.sidebar,
    (req, res) => (req.url?.startsWith('/api/') ? proxy(req, res, opts.brain, log) : serveStatic(root, req, res)),
    (req, socket, head) => (req.url?.startsWith('/api/') ? proxyUpgrade(req, socket, head, opts.brain) : socket.destroy()),
  );
  await listen(opts.ports.pm, (req, res) => proxy(req, res, opts.pm, log));
  await listen(opts.ports.mocks, (req, res) => proxy(req, res, opts.mocks, log));
  return {
    close: () =>
      Promise.all(
        servers.map(
          (s) =>
            new Promise((r) => {
              s.closeAllConnections?.();
              s.close(() => r());
            }),
        ),
      ),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const here = new URL('.', import.meta.url).pathname;
  const g = await startGateway({
    sidebarDir: join(here, '../packages/sidebar/dist'),
    brain: { host: '127.0.0.1', port: 7000 },
    pm: { host: '127.0.0.1', port: 8080 },
    mocks: { host: '127.0.0.1', port: 8090 },
    ports: { sidebar: 5180, pm: 5181, mocks: 5182 },
    log: (m) => console.log(`[gateway] ${m}`),
  });
  console.log('[gateway] listening on 127.0.0.1:5180 (sidebar + /api), :5181 (Planr), :5182 (control page)');
  const stop = () => g.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

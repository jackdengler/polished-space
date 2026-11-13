// Preload (node --import) that records every outbound TCP connection a POC
// service opens, one JSON line per connection, to $POC_NETWATCH_FILE.
// Used by the e2e check WITHOUT Docker, where there is no network isolation:
// it proves (as far as a process can see itself) that the services only
// talk to each other and to the configured Claude base URL.
// Covers node:net, node:http(s) and fetch (undici), which all open sockets
// through net.Socket and publish on the 'net.client.socket' channel.
import { appendFileSync } from 'node:fs';
import { subscribe } from 'node:diagnostics_channel';

const file = process.env.POC_NETWATCH_FILE;
const service = process.env.POC_NETWATCH_NAME ?? 'unknown';

if (file) {
  subscribe('net.client.socket', ({ socket }) => {
    socket.once('connect', () => {
      try {
        // The requested host name is known by the time the socket connects (also for TLS sockets).
        appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), service, host: socket._host ?? null, address: socket.remoteAddress ?? null, port: socket.remotePort ?? null })}\n`);
      } catch {
        /* never break the service over a log line */
      }
    });
  });
}

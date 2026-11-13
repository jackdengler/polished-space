/** Helpers for the Phase 2 stub modules: a clear 501 until the feature lands. */
import type { Duplex } from 'node:stream';
import type { ServerResponse } from 'node:http';
import { sendJson } from '../server';

export function notImplemented(res: ServerResponse, feature: string): void {
  sendJson(res, 501, { error: `${feature} is not built yet (Phase 2).` });
}

/** Answer a WebSocket upgrade with a plain 501 and close. */
export function upgradeNotImplemented(socket: Duplex, feature: string): void {
  const body = JSON.stringify({ error: `${feature} is not built yet (Phase 2).` });
  socket.end(`HTTP/1.1 501 Not Implemented\r\ncontent-type: application/json\r\ncontent-length: ${Buffer.byteLength(body)}\r\nconnection: close\r\n\r\n${body}`);
}

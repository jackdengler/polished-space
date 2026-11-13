import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { ENV, PORTS } from '@poc/contracts';
import { appHandler } from './app';
import { mcpHandler, type ToolLog } from './mcp';
import { WorkspaceStore } from './store';

const PKG_DIR = resolve(import.meta.dirname, '..');
/** Local default: poc/data. Containers set POC_DATA_DIR=/data. */
export const DEFAULT_DATA_DIR = resolve(PKG_DIR, '..', '..', 'data');
/** Local default: the repo root's vite build. */
export const DEFAULT_STATIC_DIR = resolve(PKG_DIR, '..', '..', '..', 'dist');

export interface PmServerOptions {
  /** Root of the POC data folder; the workspace lives in `<dataDir>/pm`. */
  dataDir: string;
  staticDir: string;
  appPort: number;
  mcpPort: number;
  host: string;
  log?: ToolLog;
}

export function optionsFromEnv(env = process.env): PmServerOptions {
  return {
    dataDir: resolve(env[ENV.dataDir] || DEFAULT_DATA_DIR),
    staticDir: resolve(env.PM_STATIC_DIR || DEFAULT_STATIC_DIR),
    appPort: Number(env.PM_APP_PORT || PORTS.pmApp),
    mcpPort: Number(env.PM_MCP_PORT || PORTS.pmMcp),
    // Inside a container listen on every interface (the sandbox network); locally, loopback only.
    host: env.PM_HOST || (existsSync('/.dockerenv') ? '0.0.0.0' : '127.0.0.1'),
  };
}

export interface RunningPmServer {
  store: WorkspaceStore;
  appUrl: string;
  mcpUrl: string;
  close(): Promise<void>;
}

function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => ok((server.address() as AddressInfo).port));
  });
}

/** Starts both ports. Rejects (and starts nothing) if `<dataDir>/pm/.poc-sandbox` is missing. */
export async function startPmServer(o: PmServerOptions): Promise<RunningPmServer> {
  const store = await WorkspaceStore.open(join(o.dataDir, 'pm'));
  const app = createServer(appHandler({ store, staticDir: o.staticDir }));
  const mcp = createServer(mcpHandler(store, o.log));
  const appPort = await listen(app, o.appPort, o.host);
  const mcpPort = await listen(mcp, o.mcpPort, o.host);
  const shown = o.host === '0.0.0.0' ? 'localhost' : o.host;
  return {
    store,
    appUrl: `http://${shown}:${appPort}`,
    mcpUrl: `http://${shown}:${mcpPort}/mcp`,
    close: async () => {
      app.closeAllConnections();
      mcp.closeAllConnections();
      await Promise.all([new Promise((r) => app.close(r)), new Promise((r) => mcp.close(r))]);
    },
  };
}

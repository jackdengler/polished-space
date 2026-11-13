/**
 * @poc/pm-server: the Planr test copy (port 8080) and the PM MCP server
 * (port 8081). Sandbox data only: refuses to start without the marker file.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { optionsFromEnv, startPmServer } from './server';

const opts = optionsFromEnv();
try {
  const s = await startPmServer({ ...opts, log: (tool, args) => console.log(`[mcp] ${tool} ${JSON.stringify(args)}`) });
  console.log(`pm-server: data ${join(opts.dataDir, 'pm')}`);
  console.log(`  Planr test copy  ${s.appUrl}/?storage=server`);
  console.log(`  MCP              ${s.mcpUrl}`);
  if (!existsSync(join(opts.staticDir, 'index.html'))) console.warn(`  warning: no Planr build at ${opts.staticDir} (run "npx vite build" at the repo root); the API still works.`);
  const stop = () => void s.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}

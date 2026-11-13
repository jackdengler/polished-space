/**
 * Entry point: `npm --prefix poc run start -w @poc/brain`.
 * Real connectors (mocks over HTTP, pm-server over MCP, files on disk) and
 * the real Anthropic client. The API key is read by the SDK from the
 * environment and never logged.
 */
import { join } from 'node:path';
import { DATA_LAYOUT } from '@poc/contracts';
import { Brain } from './brain';
import { createAnthropicClient } from './claude';
import { loadConfig } from './config';
import { GraphCalendarConnector } from './connectors/calendar';
import { ZoomChatConnector } from './connectors/chat';
import { LocalFilesConnector } from './connectors/files';
import { GraphMailConnector } from './connectors/mail';
import { McpPmConnector } from './connectors/pm';
import { createModules } from './modules';

const config = loadConfig();
const pm = new McpPmConnector(config.pmMcpUrl);
const anthropic = createAnthropicClient(config);
const brain = new Brain({
  config,
  anthropic,
  connectors: {
    pm,
    mail: new GraphMailConnector(config.mocksUrl),
    calendar: new GraphCalendarConnector(config.mocksUrl),
    chat: new ZoomChatConnector(config.mocksUrl),
    files: new LocalFilesConnector(join(config.dataDir, DATA_LAYOUT.files)),
  },
  modules: createModules(),
});

await brain.init();
await brain.start();
console.log(
  `[brain] listening on ${config.host}:${config.port}; data ${config.dataDir}; pm ${config.pmMcpUrl}; mocks ${config.mocksUrl}; ` +
    `now ${config.clock.now().toISOString()} (${config.clock.tz}); cap $${config.maxUsdPerDay}/day; Claude ${anthropic ? 'configured' : 'NOT configured (no key)'}`,
);

const shutdown = async () => {
  await brain.stop().catch(() => {});
  await pm.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

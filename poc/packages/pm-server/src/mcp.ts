/**
 * The PM app MCP server: exactly the five tools in MCP_TOOLS, over Streamable
 * HTTP (stateless: a fresh server and transport per request, as the SDK's
 * stateless example does). Results go out as `structuredContent` and as one
 * JSON text block.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { MCP_TOOLS, PATHS, type CreateTaskInput, type ListTasksInput } from '@poc/contracts';
import type { WorkspaceStore } from './store';
import { completeTask, createTask, listClients, listTasks, rescheduleTask } from './tools';

/** Called after every successful write tool, for the server log. */
export type ToolLog = (tool: string, args: unknown) => void;

const reply = (out: Record<string, unknown>) => ({ structuredContent: out, content: [{ type: 'text' as const, text: JSON.stringify(out) }] });

export function buildMcpServer(store: WorkspaceStore, log: ToolLog = () => {}): McpServer {
  const server = new McpServer({ name: 'planr-poc-pm', version: '0.0.0' });
  const T = MCP_TOOLS;
  const meta = <K extends keyof typeof T>(k: K) => ({ description: T[k].description, inputSchema: T[k].input, outputSchema: T[k].output });

  server.registerTool('list_clients', meta('list_clients'), async () => reply(listClients((await store.read()).workspace)));
  server.registerTool('list_tasks', meta('list_tasks'), async (args: ListTasksInput) => reply(listTasks((await store.read()).workspace, args)));
  server.registerTool('create_task', meta('create_task'), async (args: CreateTaskInput) => {
    const { result } = await store.update((ws) => createTask(ws, args));
    log('create_task', args);
    return reply({ task: result });
  });
  server.registerTool('complete_task', meta('complete_task'), async ({ taskId }: { taskId: string }) => {
    const { result } = await store.update((ws) => completeTask(ws, taskId));
    log('complete_task', { taskId });
    return reply({ task: result });
  });
  server.registerTool('reschedule_task', meta('reschedule_task'), async ({ taskId, dueDate }: { taskId: string; dueDate: string | null }) => {
    const { result } = await store.update((ws) => rescheduleTask(ws, taskId, dueDate));
    log('reschedule_task', { taskId, dueDate });
    return reply({ task: result });
  });
  return server;
}

/** Node request handler for the MCP port. Only `PATHS.pm.mcp` (POST) is served. */
export function mcpHandler(store: WorkspaceStore, log?: ToolLog) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    if (path !== PATHS.pm.mcp) return void res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Not found' }));
    if (req.method !== 'POST') {
      // Stateless server: no standalone SSE stream and no sessions to delete.
      return void res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }));
    }
    const server = buildMcpServer(store, log);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (e) {
      console.error('MCP request failed:', e);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }));
    }
  };
}

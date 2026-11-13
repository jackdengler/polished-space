/**
 * PmConnector as an MCP client of pm-server (Streamable HTTP). The brain
 * reaches Planr ONLY through these five MCP tools; it never uses pm-server's
 * storage API. Results are validated against the contract's output schemas.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  CompleteTaskInput,
  CreateTaskInput,
  ListTasksInput,
  MCP_TOOLS,
  MCP_WRITE_TOOLS,
  RescheduleTaskInput,
  type CompleteTaskOutput,
  type CreateTaskOutput,
  type ListClientsOutput,
  type ListTasksOutput,
  type McpToolName,
  type PmConnector,
  type RescheduleTaskOutput,
} from '@poc/contracts';

export class McpToolError extends Error {
  override name = 'McpToolError';
}

export class McpPmConnector implements PmConnector {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;

  constructor(private mcpUrl: string) {}

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    if (!this.connecting) {
      this.connecting = (async () => {
        const client = new Client({ name: 'poc-brain', version: '0.0.0' });
        await client.connect(new StreamableHTTPClientTransport(new URL(this.mcpUrl)));
        this.client = client;
        return client;
      })().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  private async reset(): Promise<void> {
    const c = this.client;
    this.client = null;
    await c?.close().catch(() => {});
  }

  async close(): Promise<void> {
    await this.reset();
  }

  /**
   * Calls one tool. Reads get one reconnect-and-retry on a transport failure;
   * writes never retry (a lost response could mean the write happened).
   */
  private async call<N extends McpToolName>(name: N, args: unknown): Promise<unknown> {
    const isWrite = (MCP_WRITE_TOOLS as readonly string[]).includes(name);
    const attempt = async () => {
      const client = await this.connect();
      return client.callTool({ name, arguments: args as Record<string, unknown> });
    };
    let result;
    try {
      result = await attempt();
    } catch (err) {
      await this.reset();
      if (isWrite) throw err;
      result = await attempt();
    }
    const content = (result.content ?? []) as { type: string; text?: string }[];
    if (result.isError) throw new McpToolError(`${name} failed: ${content.find((c) => c.type === 'text')?.text ?? 'unknown error'}`);
    let payload: unknown = result.structuredContent;
    if (payload === undefined) {
      const text = content.find((c) => c.type === 'text')?.text;
      if (text === undefined) throw new McpToolError(`${name} returned no result`);
      payload = JSON.parse(text);
    }
    const parsed = MCP_TOOLS[name].output.safeParse(payload);
    if (!parsed.success) throw new McpToolError(`${name} returned an unexpected shape: ${parsed.error.message}`);
    return parsed.data;
  }

  async listClients(): Promise<ListClientsOutput> {
    return (await this.call('list_clients', {})) as ListClientsOutput;
  }

  async listTasks(q: ListTasksInput = {}): Promise<ListTasksOutput> {
    return (await this.call('list_tasks', ListTasksInput.parse(q))) as ListTasksOutput;
  }

  async createTask(i: CreateTaskInput): Promise<CreateTaskOutput> {
    return (await this.call('create_task', CreateTaskInput.parse(i))) as CreateTaskOutput;
  }

  async completeTask(taskId: string): Promise<CompleteTaskOutput> {
    return (await this.call('complete_task', CompleteTaskInput.parse({ taskId }))) as CompleteTaskOutput;
  }

  async rescheduleTask(taskId: string, dueDate: string | null): Promise<RescheduleTaskOutput> {
    return (await this.call('reschedule_task', RescheduleTaskInput.parse({ taskId, dueDate }))) as RescheduleTaskOutput;
  }
}

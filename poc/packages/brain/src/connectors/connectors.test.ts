/**
 * The connector clients against small in-test servers that follow the
 * contract (the real mocks and pm-server are built in parallel).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { GraphSendMailRequest, MCP_TOOLS, MCP_TOOL_NAMES, NewCalEvent, PATHS, makeBodyPreview, toGraphDateTime, type CalEvent, type GraphMessage, type McpToolName, type ZoomChatMessage } from '@poc/contracts';
import { FakePmConnector } from '@poc/contracts/testing';
import { CLIENTS, NOW } from '../testing/harness';
import { GraphCalendarConnector } from './calendar';
import { ZoomChatConnector } from './chat';
import { LocalFilesConnector } from './files';
import { GraphMailConnector } from './mail';
import { McpPmConnector, McpToolError } from './pm';

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
});

async function serve(handler: (req: IncomingMessage, res: ServerResponse, body: string) => unknown): Promise<string> {
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    await handler(req, res, body);
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

function mail(id: string, at: string): GraphMessage {
  return {
    id,
    conversationId: `conv-${id}`,
    subject: `Subject ${id}`,
    from: { emailAddress: { name: 'Michael Okafor', address: 'michael.okafor@acmetooling.example' } },
    toRecipients: [{ emailAddress: { name: 'Alex Rivera', address: 'alex.rivera@brightline-advisory.example' } }],
    ccRecipients: [],
    receivedDateTime: at,
    body: { contentType: 'text', content: 'Body' },
    bodyPreview: makeBodyPreview('Body'),
    isRead: false,
  };
}

describe('GraphMailConnector', () => {
  it('lists strictly after the cursor with $filter, follows nextLink, and sends via sendMail', async () => {
    const all = [mail('m1', '2026-11-13T09:00:00Z'), mail('m2', '2026-11-13T10:00:00Z'), mail('m3', '2026-11-13T11:00:00Z')];
    const sent: unknown[] = [];
    const urls: string[] = [];
    const base = await serve((req, res, body) => {
      const url = new URL(req.url!, 'http://x');
      urls.push(url.pathname + url.search);
      if (req.method === 'GET' && url.pathname === PATHS.graph.messages) {
        const filter = url.searchParams.get('$filter');
        const after = filter ? Date.parse(filter.replace('receivedDateTime gt ', '')) : -Infinity;
        const items = all.filter((m) => Date.parse(m.receivedDateTime) > after);
        const page = url.searchParams.get('page');
        if (!page && items.length > 1) return json(res, 200, { value: items.slice(0, 1), '@odata.nextLink': `${PATHS.graph.messages}?${url.searchParams}&page=2` });
        return json(res, 200, { value: page ? items.slice(1) : items });
      }
      if (req.method === 'GET' && url.pathname === PATHS.graph.message('m2')) return json(res, 200, all[1]);
      if (req.method === 'GET' && url.pathname === PATHS.graph.sentMessages) return json(res, 200, { value: [{ ...mail('s2', '2026-11-12T09:00:00Z'), sentDateTime: '2026-11-12T09:00:00Z' }, { ...mail('s1', '2026-11-11T09:00:00Z'), sentDateTime: '2026-11-11T09:00:00Z' }] });
      if (req.method === 'POST' && url.pathname === PATHS.graph.sendMail) {
        sent.push(GraphSendMailRequest.parse(JSON.parse(body)));
        res.writeHead(202);
        return res.end();
      }
      json(res, 404, { error: 'nope' });
    });
    const c = new GraphMailConnector(base);
    const first = await c.listSince('2026-11-13T09:00:00Z');
    expect(first.items.map((m) => m.id)).toEqual(['m2', 'm3']);
    expect(first.cursor).toBe('2026-11-13T11:00:00Z');
    expect(urls[0]).toContain('%24filter=receivedDateTime+gt+2026-11-13T09%3A00%3A00Z');
    expect((await c.listSince(first.cursor)).items).toEqual([]);
    expect((await c.listSince('')).items).toHaveLength(3);
    expect((await c.get('m2')).id).toBe('m2');
    expect((await c.listSent()).map((m) => m.id)).toEqual(['s1', 's2']);
    const out = await c.send({ to: [{ name: 'Michael Okafor', address: 'michael.okafor@acmetooling.example' }], cc: [], subject: 'Re: x', body: 'Hello', replyToMessageId: 'm2' });
    expect(out.id).toMatch(/^sent-/);
    expect(sent).toEqual([{ message: { subject: 'Re: x', body: { contentType: 'text', content: 'Hello' }, toRecipients: [{ emailAddress: { name: 'Michael Okafor', address: 'michael.okafor@acmetooling.example' } }], ccRecipients: [] }, saveToSentItems: true }]);
  });

  it('surfaces HTTP errors', async () => {
    const base = await serve((_q, res) => json(res, 500, { error: 'boom' }));
    await expect(new GraphMailConnector(base).listSince('')).rejects.toMatchObject({ status: 500, message: 'The mail service said: boom.' });
    const bare = await serve((_q, res) => {
      res.writeHead(503);
      res.end('<html>down</html>');
    });
    await expect(new GraphMailConnector(bare).listSince('')).rejects.toMatchObject({ message: 'The mail service answered with an error (503).' });
    await expect(new GraphMailConnector('http://127.0.0.1:9').listSince('')).rejects.toThrow(/^The mail service is not answering \(/);
  });
});

describe('GraphCalendarConnector', () => {
  it('reads calendarView and creates events', async () => {
    const events: CalEvent[] = [];
    const seen: string[] = [];
    const base = await serve((req, res, body) => {
      const url = new URL(req.url!, 'http://x');
      if (req.method === 'GET' && url.pathname === PATHS.graph.calendarView) {
        seen.push(`${url.searchParams.get('startDateTime')}|${url.searchParams.get('endDateTime')}`);
        return json(res, 200, { value: events });
      }
      if (req.method === 'POST' && url.pathname === PATHS.graph.events) {
        const n = NewCalEvent.parse(JSON.parse(body));
        const ev: CalEvent = { ...n, id: `ev-${events.length + 1}`, isAllDay: false, bodyPreview: '' };
        events.push(ev);
        return json(res, 201, ev);
      }
      json(res, 404, {});
    });
    const c = new GraphCalendarConnector(base);
    const ev = await c.createEvent({ subject: 'Lunch', start: toGraphDateTime('2026-11-13T12:00:00Z'), end: toGraphDateTime('2026-11-13T12:30:00Z'), attendees: [], showAs: 'busy', categories: ['Lunch'] });
    expect(ev.id).toBe('ev-1');
    expect((await c.view('2026-11-13T00:00:00Z', '2026-11-14T00:00:00Z')).map((e) => e.subject)).toEqual(['Lunch']);
    expect(seen).toEqual(['2026-11-13T00:00:00Z|2026-11-14T00:00:00Z']);
  });
});

describe('ZoomChatConnector', () => {
  it('pages with next_page_token and keeps only items strictly after the cursor', async () => {
    const msgs: ZoomChatMessage[] = ['09:00', '10:00', '11:00'].map((t, i) => ({
      id: `c${i + 1}`,
      message: `hello ${i}`,
      sender: 'priya.shah@brightline-advisory.example',
      sender_display_name: 'Priya Shah',
      date_time: `2026-11-13T${t}:00Z`,
      timestamp: Date.parse(`2026-11-13T${t}:00Z`),
      to_contact: 'priya.shah@brightline-advisory.example',
    }));
    const base = await serve((req, res) => {
      const url = new URL(req.url!, 'http://x');
      if (url.pathname !== PATHS.zoom.messages) return json(res, 404, {});
      const from = url.searchParams.get('from');
      const items = msgs.filter((m) => !from || Date.parse(m.date_time) >= Date.parse(from)); // Zoom's from is inclusive
      const token = url.searchParams.get('next_page_token');
      const pageItems = token ? items.slice(1) : items.slice(0, 1);
      json(res, 200, { from: from ?? undefined, page_size: 50, next_page_token: token || items.length <= 1 ? '' : 'p2', messages: pageItems });
    });
    const c = new ZoomChatConnector(base);
    const r = await c.listSince('2026-11-13T09:00:00Z');
    expect(r.items.map((m) => m.id)).toEqual(['c2', 'c3']);
    expect(r.cursor).toBe('2026-11-13T11:00:00Z');
    expect((await c.listSince('')).items).toHaveLength(3);
  });
});

describe('LocalFilesConnector', () => {
  it('lists a client folder, reads text and PDFs, and refuses paths outside the root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'poc-files-'));
    await mkdir(join(root, 'Acme Tooling', 'sub'), { recursive: true });
    await writeFile(join(root, 'Acme Tooling', 'notes.txt'), 'hello');
    await writeFile(join(root, 'Acme Tooling', 'sub', 'deck.pdf'), Buffer.from('%PDF-1.4'));
    await writeFile(join(root, 'Acme Tooling', 'skip.docx'), 'x');
    const c = new LocalFilesConnector(root);
    expect((await c.list('Acme Tooling')).map((f) => [f.path, f.mimeType])).toEqual([
      ['Acme Tooling/notes.txt', 'text/plain'],
      ['Acme Tooling/sub/deck.pdf', 'application/pdf'],
    ]);
    expect(await c.list('Nope')).toEqual([]);
    expect(await c.read('Acme Tooling/notes.txt')).toMatchObject({ encoding: 'utf8', content: 'hello', folder: 'Acme Tooling' });
    expect(await c.read('Acme Tooling/sub/deck.pdf')).toMatchObject({ encoding: 'base64', content: Buffer.from('%PDF-1.4').toString('base64') });
    await expect(c.read('../etc/passwd')).rejects.toThrow(/outside/);
    await expect(c.read('/etc/passwd')).rejects.toThrow(/outside/);
  });
});

describe('McpPmConnector (MCP client over Streamable HTTP)', () => {
  async function mcpServer(pm: FakePmConnector, failTool?: McpToolName): Promise<string> {
    const run = async (name: McpToolName, args: Record<string, unknown>): Promise<unknown> => {
      switch (name) {
        case 'list_clients':
          return pm.listClients();
        case 'list_tasks':
          return pm.listTasks(args);
        case 'create_task':
          return pm.createTask(args as never);
        case 'complete_task':
          return pm.completeTask(args.taskId as string);
        case 'reschedule_task':
          return pm.rescheduleTask(args.taskId as string, args.dueDate as string | null);
      }
    };
    return serve(async (req, res, body) => {
      // Stateless mode: a fresh server and transport per request.
      const server = new McpServer({ name: 'test-pm', version: '0.0.0' });
      for (const name of MCP_TOOL_NAMES) {
        const t = MCP_TOOLS[name];
        server.registerTool(name, { description: t.description, inputSchema: t.input, outputSchema: t.output }, (async (args: Record<string, unknown>) => {
          if (name === failTool) return { isError: true, content: [{ type: 'text', text: 'no such task' }] };
          const out = (await run(name, args)) as Record<string, unknown>;
          return { structuredContent: out, content: [{ type: 'text', text: JSON.stringify(out) }] };
        }) as never);
      }
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
    });
  }

  it('calls the five tools and validates results against the contract', async () => {
    const pm = new FakePmConnector({ clients: CLIENTS }, () => NOW);
    const url = `${await mcpServer(pm)}/mcp`;
    const c = new McpPmConnector(url);
    try {
      expect((await c.listClients()).clients.map((x) => x.id)).toEqual(CLIENTS.map((x) => x.id));
      const { task } = await c.createTask({ clientId: 'poc-client-acme', title: 'Reply to Michael', dueDate: '2026-11-16', assigneeIds: ['poc-member-alex'] });
      expect(task).toMatchObject({ clientId: 'poc-client-acme', title: 'Reply to Michael', deliverableTitle: 'General' });
      expect((await c.listTasks({ assigneeId: 'poc-member-alex' })).tasks).toHaveLength(1);
      expect((await c.rescheduleTask(task.id, null)).task.dueDate).toBeNull();
      expect((await c.completeTask(task.id)).task.done).toBe(true);
      expect(pm.calls.map((x) => x.tool)).toEqual(['list_clients', 'create_task', 'list_tasks', 'reschedule_task', 'complete_task']);
    } finally {
      await c.close();
    }
  });

  it('turns a tool error into McpToolError', async () => {
    const pm = new FakePmConnector({ clients: CLIENTS }, () => NOW);
    const c = new McpPmConnector(`${await mcpServer(pm, 'complete_task')}/mcp`);
    try {
      await expect(c.completeTask('nope')).rejects.toBeInstanceOf(McpToolError);
    } finally {
      await c.close();
    }
  });
});

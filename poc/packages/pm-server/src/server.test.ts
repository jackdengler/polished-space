import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ListClientsOutput, ListTasksOutput, MCP_TOOL_NAMES, PATHS, TaskOutput } from '@poc/contracts';
import { parseWorkspace, type Workspace } from '../../../../src/model/schema';
import { startPmServer, type RunningPmServer } from './server';
import { makeDataDir } from './testUtil';

const ACME = 'poc-client-acme';
const ME = 'poc-member-alex';

async function start(dataDir: string) {
  return startPmServer({ dataDir, staticDir: join(dataDir, 'no-build'), appPort: 0, mcpPort: 0, host: '127.0.0.1' });
}

describe('startup guard', () => {
  it('refuses to start without the .poc-sandbox marker', async () => {
    const dataDir = await makeDataDir({ marker: false });
    await expect(start(dataDir)).rejects.toThrow(/Refusing to start.*\.poc-sandbox/);
  });
});

describe('pm-server', () => {
  let dataDir: string;
  let s: RunningPmServer;
  let mcp: Client;
  const api = (path: string, init?: RequestInit) => fetch(s.appUrl + path, init);
  const getWs = async () => (await (await api(PATHS.pm.workspace)).json()) as { rev: number; workspace: Workspace };
  const put = (workspace: unknown, rev?: number) =>
    api(PATHS.pm.workspace, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(rev === undefined ? {} : { 'If-Match': String(rev) }) }, body: JSON.stringify({ workspace }) });
  const call = async (name: string, args: Record<string, unknown>) => mcp.callTool({ name, arguments: args });
  const onDisk = async () => JSON.parse(await readFile(join(dataDir, 'pm', 'workspace.json'), 'utf8')) as Workspace;

  beforeEach(async () => {
    dataDir = await makeDataDir();
    s = await start(dataDir);
    mcp = new Client({ name: 'pm-server-test', version: '0.0.0' });
    await mcp.connect(new StreamableHTTPClientTransport(new URL(s.mcpUrl)));
  });
  afterEach(async () => {
    await mcp.close();
    await s.close();
  });

  describe('storage API', () => {
    it('serves health and the workspace with a rev', async () => {
      expect(await (await api(PATHS.pm.health)).json()).toMatchObject({ ok: true, service: 'pm' });
      const { rev, workspace } = await getWs();
      expect(typeof rev).toBe('number');
      expect(workspace.clients).toHaveLength(5);
    });

    it('PUT with the current rev saves and bumps the rev; a stale rev gets 409', async () => {
      const { rev, workspace } = await getWs();
      workspace.clients[0]!.name = 'Acme Tooling Co. (renamed in test)';
      const ok = await put(workspace, rev);
      expect(ok.status).toBe(200);
      const next = ((await ok.json()) as { rev: number }).rev;
      expect(next).toBeGreaterThan(rev);
      expect((await onDisk()).clients[0]!.name).toBe('Acme Tooling Co. (renamed in test)');

      const stale = await put(workspace, rev);
      expect(stale.status).toBe(409);
      expect(await stale.json()).toMatchObject({ rev: next });
    });

    it('an MCP write makes an open tab stale (409)', async () => {
      const { rev, workspace } = await getWs();
      await call('create_task', { clientId: ACME, title: 'Written by the assistant' });
      expect((await put(workspace, rev)).status).toBe(409);
    });

    it('rejects an invalid workspace with 400 and leaves the file alone', async () => {
      const before = await readFile(join(dataDir, 'pm', 'workspace.json'), 'utf8');
      const { rev } = await getWs();
      const res = await put({ schemaVersion: 1, clients: 'nope' }, rev);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(/not valid/);
      expect(await readFile(join(dataDir, 'pm', 'workspace.json'), 'utf8')).toBe(before);
    });

    it('the four client fields survive a load → save round trip (storage API and MCP writes)', async () => {
      const seeded = (await onDisk()).clients.find((c) => c.id === ACME)!;
      expect(seeded.emailDomains.length).toBeGreaterThan(0);
      // Planr's path: load, parse with its own schema, save the whole document.
      const { rev, workspace } = await getWs();
      expect((await put(parseWorkspace(workspace), rev)).status).toBe(200);
      await call('create_task', { clientId: ACME, title: 'Round trip check' });
      const after = (await onDisk()).clients.find((c) => c.id === ACME)!;
      for (const k of ['emailDomains', 'contacts', 'fileFolder', 'nicknames'] as const) expect(after[k]).toEqual(seeded[k]);
    });

    it('picks up an outside edit of workspace.json (e.g. a re-seed) with a new rev', async () => {
      const { rev } = await getWs();
      const ws = await onDisk();
      ws.clients[1]!.name = 'Harborlight Freight (edited on disk)';
      await new Promise((r) => setTimeout(r, 20));
      await writeFile(join(dataDir, 'pm', 'workspace.json'), JSON.stringify(ws));
      const now = await getWs();
      expect(now.rev).toBeGreaterThan(rev);
      expect(now.workspace.clients[1]!.name).toBe('Harborlight Freight (edited on disk)');
    });

    it('sends the rev over SSE on connect and on every change', async () => {
      const ctrl = new AbortController();
      const res = await api(PATHS.pm.events, { signal: ctrl.signal });
      const reader = res.body!.getReader();
      const revs: number[] = [];
      let buf = '';
      const next = async () => {
        while (!buf.includes('\n\n')) buf += new TextDecoder().decode((await reader.read()).value);
        const [msg, ...rest] = buf.split('\n\n');
        buf = rest.join('\n\n');
        revs.push((JSON.parse(msg!.replace(/^data: /, '')) as { rev: number }).rev);
      };
      await next();
      await call('create_task', { clientId: ACME, title: 'Triggers an event' });
      await next();
      ctrl.abort();
      expect(revs[1]).toBe(revs[0]! + 1);
    });

    it('stores logos and personal data', async () => {
      expect(await (await api(PATHS.pm.personal(ME))).json()).toBeNull();
      await api(PATHS.pm.personal(ME), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries: [1] }) });
      expect(await (await api(PATHS.pm.personal(ME))).json()).toEqual({ entries: [1] });

      const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
      expect((await api(PATHS.pm.logo('acme-1.png'), { method: 'PUT', body: png })).status).toBe(200);
      const back = await api(PATHS.pm.logo('acme-1.png'));
      expect(back.headers.get('content-type')).toBe('image/png');
      expect(new Uint8Array(await back.arrayBuffer())).toEqual(png);
      expect((await api('/api/logos/..%2Fworkspace.json')).status).toBe(400);
    });

    it('says the Planr build is missing rather than failing silently', async () => {
      const res = await api('/');
      expect(res.status).toBe(503);
      expect(await res.text()).toMatch(/Planr build is missing/);
    });
  });

  describe('MCP server', () => {
    it('tools/list returns exactly the five tools', async () => {
      const { tools } = await mcp.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([...MCP_TOOL_NAMES].sort());
      for (const t of tools) expect(t.outputSchema).toBeDefined();
    });

    it('list_clients returns the contract shape', async () => {
      const r = await call('list_clients', {});
      const out = ListClientsOutput.parse(r.structuredContent);
      expect(out.clients.map((c) => c.id)).toContain(ACME);
      // also sent as one JSON text block
      expect(JSON.parse((r.content as { text: string }[])[0]!.text)).toEqual(r.structuredContent);
    });

    it('create_task adds to Ad-hoc → General, list_tasks shows it, and the file is written', async () => {
      const r = await call('create_task', { clientId: ACME, title: 'Draft the market pricing reply', dueDate: '2026-11-20', assigneeIds: [ME] });
      const { task } = TaskOutput.parse(r.structuredContent);
      expect(task).toMatchObject({ clientId: ACME, boardId: 'adhoc', deliverableTitle: 'General', dueDate: '2026-11-20', assigneeIds: [ME] });
      const list = ListTasksOutput.parse((await call('list_tasks', { clientId: ACME })).structuredContent);
      expect(list.tasks.some((t) => t.id === task.id)).toBe(true);
      const disk = await onDisk();
      const general = disk.clients.find((c) => c.id === ACME)!.adhoc.deliverables.find((d) => d.title === 'General')!;
      expect(general.tasks.some((t) => t.id === task.id)).toBe(true);
    });

    it('list_tasks honours its filters', async () => {
      const all = ListTasksOutput.parse((await call('list_tasks', { includeDone: true })).structuredContent).tasks;
      const open = ListTasksOutput.parse((await call('list_tasks', {})).structuredContent).tasks;
      expect(open.every((t) => !t.done)).toBe(true);
      expect(all.length).toBeGreaterThan(open.length);
      const ranged = ListTasksOutput.parse((await call('list_tasks', { dueFrom: '2026-11-13', dueTo: '2026-11-13', assigneeId: ME })).structuredContent).tasks;
      expect(ranged.every((t) => t.dueDate === '2026-11-13' && t.assigneeIds.includes(ME))).toBe(true);
    });

    it('complete_task sets done (idempotent) and reschedule_task changes the date', async () => {
      const { task } = TaskOutput.parse((await call('create_task', { clientId: ACME, title: 'Short-lived' })).structuredContent);
      expect(TaskOutput.parse((await call('reschedule_task', { taskId: task.id, dueDate: '2026-11-27' })).structuredContent).task.dueDate).toBe('2026-11-27');
      expect(TaskOutput.parse((await call('reschedule_task', { taskId: task.id, dueDate: null })).structuredContent).task.dueDate).toBeNull();
      expect(TaskOutput.parse((await call('complete_task', { taskId: task.id })).structuredContent).task.done).toBe(true);
      expect(TaskOutput.parse((await call('complete_task', { taskId: task.id })).structuredContent).task.done).toBe(true);
      const open = ListTasksOutput.parse((await call('list_tasks', {})).structuredContent).tasks;
      expect(open.some((t) => t.id === task.id)).toBe(false);
    });

    it('returns a tool error for an unknown id or bad input, and changes nothing', async () => {
      const before = await readFile(join(dataDir, 'pm', 'workspace.json'), 'utf8');
      const bad = await call('complete_task', { taskId: 'no-such-task' });
      expect(bad.isError).toBe(true);
      expect(JSON.stringify(bad.content)).toMatch(/No task/);
      const badDate = await call('reschedule_task', { taskId: 'x', dueDate: 'Friday' });
      expect(badDate.isError).toBe(true);
      const noClient = await call('create_task', { clientId: 'poc-client-nobody', title: 'x' });
      expect(noClient.isError).toBe(true);
      expect(await readFile(join(dataDir, 'pm', 'workspace.json'), 'utf8')).toBe(before);
    });

    it('D1: refuses impossible dates, unknown members and unknown deliverables over MCP, and changes nothing', async () => {
      const { task } = TaskOutput.parse((await call('create_task', { clientId: ACME, title: 'Date guard' })).structuredContent);
      const before = await readFile(join(dataDir, 'pm', 'workspace.json'), 'utf8');
      for (const [name, args] of [
        ['reschedule_task', { taskId: task.id, dueDate: '2026-13-45' }],
        ['reschedule_task', { taskId: task.id, dueDate: '2026-02-30' }],
        ['create_task', { clientId: ACME, title: 'x', dueDate: '2026-02-29' }],
        ['create_task', { clientId: ACME, title: 'x', assigneeIds: ['nobody'] }],
        ['create_task', { clientId: ACME, title: 'x', deliverableId: 'no-such-deliverable' }],
      ] as const) {
        const r = await call(name, args);
        expect(r.isError, `${name} ${JSON.stringify(args)}`).toBe(true);
      }
      expect(JSON.stringify((await call('create_task', { clientId: ACME, title: 'x', assigneeIds: ['nobody'] })).content)).toMatch(/No team member/);
      expect(await readFile(join(dataDir, 'pm', 'workspace.json'), 'utf8')).toBe(before);
    });

    it('serialises concurrent writes (no lost updates)', async () => {
      const results = await Promise.all(Array.from({ length: 10 }, (_, i) => call('create_task', { clientId: ACME, title: `Parallel ${i}` })));
      expect(results.every((r) => !r.isError)).toBe(true);
      const titles = (await onDisk()).clients.find((c) => c.id === ACME)!.adhoc.deliverables.flatMap((d) => d.tasks.map((t) => t.title));
      for (let i = 0; i < 10; i++) expect(titles).toContain(`Parallel ${i}`);
    });
  });
});

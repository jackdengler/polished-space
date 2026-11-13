/** The brain over HTTP: core routes, SSE, module routes and stubs, WebSocket upgrade dispatch. */
import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { BRAIN_SSE_EVENTS, ConversationResponse, FileView, HEARTBEAT_MS, InputResponse, PATHS, PreparedResponse, ProfileDoc, ProfileListResponse, SidebarState, SourceMessage, UsageResponse } from '@poc/contracts';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createModules } from './modules';
import type { BrainModule } from './modules/types';
import { TODAY, makeDataDir, makeHarness, michaelMail, task, triage, type Harness } from './testing/harness';

const running: Harness[] = [];
afterEach(async () => {
  for (const h of running.splice(0)) await h.brain.stop();
});

async function up(modules: BrainModule[] = createModules(), opts: Parameters<typeof makeHarness>[0] = {}) {
  const h = await makeHarness({ modules, ...opts });
  await new Promise<void>((r) => h.brain.server.listen(0, '127.0.0.1', () => r()));
  running.push(h);
  const base = `http://127.0.0.1:${(h.brain.server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };
  return { h, base, call };
}

/** Read SSE events until `until` returns true. */
async function readSse(url: string, until: (events: { event: string; data: unknown }[]) => boolean, act?: () => Promise<void>) {
  const ctrl = new AbortController();
  const res = await fetch(url, { signal: ctrl.signal });
  const reader = res.body!.getReader();
  const events: { event: string; data: unknown }[] = [];
  let buf = '';
  let acted = false;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += new TextDecoder().decode(value);
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = /^event: (.+)$/m.exec(chunk)?.[1];
      const data = /^data: (.+)$/m.exec(chunk)?.[1];
      if (ev && data) events.push({ event: ev, data: JSON.parse(data) });
    }
    if (!acted && events.length && act) {
      acted = true;
      await act();
    }
    if (until(events)) break;
  }
  ctrl.abort();
  return events;
}

describe('core routes', () => {
  it('serves health, state, usage; approves and denies; validates bodies', async () => {
    const { h, call } = await up();
    expect((await call('GET', PATHS.brain.health)).body).toMatchObject({ ok: true, service: 'brain' });
    const state = await call('GET', PATHS.brain.state);
    expect(state.status).toBe(200);
    SidebarState.parse(state.body);
    UsageResponse.parse((await call('GET', PATHS.brain.usage)).body);

    h.claude.enqueue({ parsed: triage() });
    const input = await call('POST', PATHS.brain.input, { text: 'add a task to reply to Michael on Monday' });
    expect(input.status).toBe(200);
    const sugs = InputResponse.parse(input.body).suggestions;
    expect(sugs).toHaveLength(2);
    expect(sugs[0]!.source?.connector).toBe('manual');

    expect((await call('POST', PATHS.brain.input, { text: '' })).status).toBe(400);
    expect((await call('POST', PATHS.brain.input, '{bad json')).status).toBe(400);
    expect((await call('POST', PATHS.brain.approve('missing'), {})).status).toBe(404);
    expect((await call('POST', PATHS.brain.approve(sugs[0]!.id), { edits: { payload: { dueDate: 'soon' } } })).status).toBe(400);
    const ok = await call('POST', PATHS.brain.approve(sugs[0]!.id), { edits: { payload: { dueDate: '2026-11-16' } } });
    expect(ok.body.suggestion).toMatchObject({ status: 'applied', payload: { dueDate: '2026-11-16' } });
    expect((await call('POST', PATHS.brain.approve(sugs[0]!.id), {})).status).toBe(409);
    expect((await call('POST', PATHS.brain.deny(sugs[1]!.id))).body.suggestion.status).toBe('denied');
    expect(h.pm.writeCalls).toHaveLength(1);

    const taskId = h.pm.tasks[0]!.id;
    expect((await call('POST', PATHS.brain.hold(taskId), { onHold: 'yes' })).status).toBe(400);
    expect((await call('POST', PATHS.brain.hold(taskId), { onHold: true })).body).toMatchObject({ taskId, onHold: true });
    const after = SidebarState.parse((await call('GET', PATHS.brain.state)).body);
    expect(after.sections.find((s) => s.key === 'on_hold')!.items.map((i) => i.taskId)).toEqual([taskId]);

    expect((await call('GET', '/api/nowhere')).status).toBe(404);
    expect((await call('DELETE', PATHS.brain.state)).status).toBe(405);
  });

  it('maps the spend cap on typed input to 429', async () => {
    const { call } = await up(createModules(), { maxUsdPerDay: 0 });
    const r = await call('POST', PATHS.brain.input, { text: 'chase Michael' });
    expect(r.status).toBe(429);
    expect(r.body.error).toMatch(/cap/);
  });

  it('streams state and nudge events over SSE', async () => {
    const { h, base } = await up();
    h.claude.enqueue({ parsed: triage() });
    const events = await readSse(
      base + PATHS.brain.events,
      (ev) => ev.some((e) => e.event === 'nudge') && ev.filter((e) => e.event === 'state').length >= 2,
      async () => {
        h.mail.deliver(michaelMail);
        await h.brain.tick();
      },
    );
    expect(events[0]!.event).toBe('state');
    SidebarState.parse(events[0]!.data);
    const nudge = events.find((e) => e.event === 'nudge')!.data as { kind: string; text: string };
    expect(nudge).toMatchObject({ kind: 'new_item' });
    const last = events.filter((e) => e.event === 'state').pop()!.data as SidebarState;
    expect(last.suggestions).toHaveLength(2);
  });

  it('D2: sends a named heartbeat event at least every HEARTBEAT_MS', async () => {
    const { base } = await up();
    const t0 = Date.now();
    const events = await readSse(base + PATHS.brain.events, (ev) => ev.some((e) => e.event === 'heartbeat'));
    const hb = events.find((e) => e.event === 'heartbeat');
    expect(hb, 'no heartbeat').toBeTruthy();
    expect(BRAIN_SSE_EVENTS.heartbeat.safeParse(hb!.data).success).toBe(true);
    expect(Date.now() - t0).toBeLessThan(HEARTBEAT_MS + 1500);
  });

  it('D4: GET /api/sources returns the original email and chat message; unknown ids are a readable 404', async () => {
    const { h, call } = await up();
    const m = h.mail.deliver(michaelMail);
    const c = h.chat.deliver({ sender: 'priya.shah@brightline-advisory.example', sender_display_name: 'Priya Shah', message: 'Harbor sent the driver pay draft.' });
    const mail = await call('GET', PATHS.brain.source('mail', m.id));
    expect(mail.status).toBe(200);
    expect(SourceMessage.parse(mail.body)).toMatchObject({ connector: 'mail', from: { name: 'Michael Okafor' }, subject: michaelMail.subject, body: michaelMail.body });
    const chat = await call('GET', PATHS.brain.source('chat', c.id));
    expect(SourceMessage.parse(chat.body)).toMatchObject({ connector: 'chat', from: { name: 'Priya Shah' }, subject: null, body: 'Harbor sent the driver pay draft.' });
    const missing = await call('GET', PATHS.brain.source('mail', 'nope'));
    expect(missing).toMatchObject({ status: 404, body: { error: 'That email is no longer in the mailbox.' } });
    expect((await call('GET', '/api/sources/files/x')).status).toBe(400);
  });

  it('D10: GET /api/conversation returns the stored turns (typed and spoken, with interrupted markers)', async () => {
    const dataDir = await makeDataDir();
    await mkdir(join(dataDir, 'brain'), { recursive: true });
    const turn = (id: string, via: 'text' | 'voice', user: string, assistant: string, interrupted: boolean) => ({ id, at: '2026-11-13T13:40:00.000Z', via, user, assistant, interrupted, suggestionIds: [], messageStart: 0, messageEnd: 0 });
    await writeFile(join(dataDir, 'brain', 'conversation.json'), JSON.stringify({ version: 1, messages: [], lastContext: null, turns: [turn('t1', 'text', 'What is next?', 'The Acme reply.', false), turn('t2', 'voice', 'Tell me about my day', 'Here is your', true)] }));
    const { call } = await up(createModules(), { dataDir });
    const r = ConversationResponse.parse((await call('GET', PATHS.brain.conversation)).body);
    expect(r.turns.map((t) => [t.via, t.user, t.assistant, t.interrupted])).toEqual([
      ['text', 'What is next?', 'The Acme reply.', false],
      ['voice', 'Tell me about my day', 'Here is your', true],
    ]);
  });
});

describe('modules', () => {
  it('the real module routes answer with their contract shapes, and WS /api/voice upgrades', async () => {
    const { h, base, call } = await up();
    // Chat: bad body is a 400; a real turn streams delta ... done as SSE.
    expect((await call('POST', PATHS.brain.chat, {})).status).toBe(400);
    h.claude.setDefault({ text: 'Your next meeting is at 15:30.' });
    const chat = await fetch(base + PATHS.brain.chat, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'when is my next meeting?' }) });
    expect(chat.headers.get('content-type')).toMatch(/text\/event-stream/);
    const sse = await chat.text();
    expect(sse).toMatch(/event: delta\n/);
    const done = /event: done\ndata: (.+)\n/.exec(sse)![1]!;
    expect(JSON.parse(done)).toEqual({ text: 'Your next meeting is at 15:30.' });

    // Prepared work: unknown task 404; a real task answers PreparedResponse.
    expect((await call('GET', PATHS.brain.prepared('t-none'))).status).toBe(404);
    expect((await call('POST', PATHS.brain.prepare('t-none'), {})).status).toBe(404);
    h.pm.tasks.push(task('t-acme-1', 'poc-client-acme', 'Reply to Michael', TODAY));
    h.claude.setDefault({ parsed: { summary: 'Context.', notes: [], nextStep: { kind: 'none', title: '', nudge: '', toName: null, subject: '', body: '', dueDate: null, taskType: 'other' } } });
    const prep = await call('GET', PATHS.brain.prepared('t-acme-1'));
    expect(prep.status).toBe(200);
    PreparedResponse.parse(prep.body);
    expect((await call('POST', PATHS.brain.prepare('t-acme-1'), {})).status).toBe(202);

    // Profiles.
    const list = ProfileListResponse.parse((await call('GET', PATHS.brain.profiles)).body);
    expect(list.profiles.map((p) => p.clientId)).toContain('poc-client-acme');
    const doc = ProfileDoc.parse((await call('GET', PATHS.brain.profile('poc-client-acme'))).body);
    expect(doc.markdown).toContain('# Acme Tooling Co.');
    expect((await call('GET', PATHS.brain.profile('poc-client-nobody'))).status).toBe(404);

    // Files: text served as is; outside the root refused.
    const file = FileView.parse((await call('GET', PATHS.brain.file('Acme Tooling/benchmark_matches.csv'))).body);
    expect(file).toMatchObject({ textSource: 'file', text: 'job,match\n', truncated: false });
    expect((await call('GET', PATHS.brain.file('../secrets.txt'))).status).toBe(400);
    expect((await call('GET', PATHS.brain.files)).status).toBe(400);
    expect((await call('GET', PATHS.brain.file('Acme Tooling/missing.md'))).status).toBe(404);

    // Voice: the upgrade is accepted (101 Switching Protocols).
    const port = new URL(base).port;
    const reply = await new Promise<string>((resolve) => {
      const sock = connect(Number(port), '127.0.0.1', () => {
        sock.write(`GET ${PATHS.brain.voice} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
      });
      let data = '';
      sock.on('data', (d) => {
        data += d;
        if (data.includes('\r\n\r\n')) sock.destroy();
      });
      sock.on('close', () => resolve(data));
    });
    expect(reply).toMatch(/^HTTP\/1.1 101/);
    await h.brain.idle();
  });

  it('a module object can serve only one brain; createModules() gives fresh ones', async () => {
    const mods = createModules();
    await up(mods);
    await expect(makeHarness({ modules: [mods[0]!] })).rejects.toThrow(/already bound/);
    const again = createModules();
    expect(again.every((m, i) => m !== mods[i])).toBe(true);
    await up(again); // fresh instances start fine
  });

  it('suggestions from ANY source fire onSuggestionsAdded (chat propose_* included)', async () => {
    const seen: string[][] = [];
    const mod: BrainModule = { name: 'watch', onSuggestionsAdded: (e) => void seen.push(e.suggestions.map((s) => s.kind)) };
    const { h } = await up([mod]);
    const ctx = h.brain.moduleContext('chat');
    await ctx.suggestions.add({ kind: 'create_task', title: 'Chase Michael', nudge: 'n', clientId: 'poc-client-acme', clientConfidence: 'high', source: { connector: 'manual', id: 'chat-1', label: 'Chat' }, direction: 'i_owe', taskType: 'follow_up', duplicateOf: null, payload: { title: 'Chase Michael', dueDate: '2026-11-20', assigneeIds: [] } });
    h.claude.enqueue({ parsed: triage() });
    await h.brain.intake.submitText('reply to Michael', 'manual');
    await h.brain.idle();
    expect(seen).toEqual([['create_task'], ['create_task', 'create_task']]);
  });

  it('module routes, executor overrides and hooks plug in; clashes are refused', async () => {
    const seen: string[] = [];
    const mod: BrainModule = {
      name: 'test',
      init(ctx) {
        ctx.routes.add('GET', '/api/test/:x', ({ res, params }) => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ x: params.x }));
        });
        ctx.executors.override('calendar_block', async (s, x) => {
          seen.push(`override ${s.kind}`);
          return x.core(s, x);
        });
      },
      onSuggestionApplied: (e) => void seen.push(`applied ${e.suggestion.kind}`),
      onCalendarChanged: () => void seen.push('calendar'),
      onTasksChanged: (e) => void seen.push(`tasks ${e.reason}`),
    };
    const { h, call } = await up([mod]);
    expect((await call('GET', '/api/test/a%20b')).body).toEqual({ x: 'a b' });
    await h.brain.tick();
    const s = await h.brain.suggestions.add({ kind: 'calendar_block', title: 'Lunch', nudge: 'Lunch?', clientId: null, clientConfidence: 'high', source: null, payload: { subject: 'Lunch', start: '2026-11-13T12:00:00.000Z', end: '2026-11-13T12:30:00.000Z', purpose: 'lunch', taskId: null } });
    await h.brain.approve(s.id, {});
    await h.brain.idle();
    expect(seen).toEqual(['tasks startup', 'calendar', 'override calendar_block', 'applied calendar_block', 'calendar']);
    expect(h.calendar.created).toHaveLength(1);

    const ctx = h.brain.moduleContext('other');
    expect(() => ctx.routes.add('GET', '/api/test/:y', () => {})).toThrow(/clashes/);
    expect(() => ctx.routes.add('GET', PATHS.brain.state, () => {})).toThrow(/clashes/);
    expect(() => ctx.executors.override('calendar_block', async () => ({}))).toThrow(/already overridden/);
    expect(() => ctx.upgrades.add('/api/x', () => {})).not.toThrow();
    expect(() => ctx.upgrades.add('/api/x', () => {})).toThrow(/already registered/);
    // revise may not change status/kind, and only pending suggestions.
    const p = await ctx.suggestions.add({ kind: 'complete_task', title: 'Done?', nudge: 'n', clientId: null, clientConfidence: 'high', source: null, payload: { taskId: 't-1' } });
    await expect(ctx.suggestions.revise(p.id, (x) => ({ ...x, status: 'applied' }))).rejects.toThrow(/cannot change/);
    await expect(ctx.suggestions.revise(s.id, (x) => x)).rejects.toThrow(/not pending/);
  });
});

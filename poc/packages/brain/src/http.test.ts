/** The brain over HTTP: core routes, SSE, module routes and stubs, WebSocket upgrade dispatch. */
import { connect } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { InputResponse, PATHS, SidebarState, UsageResponse } from '@poc/contracts';
import { MODULES } from './modules';
import type { BrainModule } from './modules/types';
import { makeHarness, michaelMail, triage, type Harness } from './testing/harness';

const running: Harness[] = [];
afterEach(async () => {
  for (const h of running.splice(0)) await h.brain.stop();
});

async function up(modules: BrainModule[] = MODULES, opts: Parameters<typeof makeHarness>[0] = {}) {
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
    const { call } = await up(MODULES, { maxUsdPerDay: 0 });
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
});

describe('modules', () => {
  it('Phase 2 stub routes answer 501, and WS /api/voice is refused with 501', async () => {
    const { base, call } = await up();
    for (const [m, p] of [
      ['POST', PATHS.brain.chat],
      ['GET', PATHS.brain.prepared('t-1')],
      ['POST', PATHS.brain.prepare('t-1')],
      ['GET', PATHS.brain.profiles],
      ['GET', PATHS.brain.profile('poc-client-acme')],
    ] as const) {
      const r = await call(m, p, m === 'POST' ? {} : undefined);
      expect(r.status, `${m} ${p}`).toBe(501);
      expect(r.body.error).toMatch(/not built yet/);
    }
    const port = new URL(base).port;
    const reply = await new Promise<string>((resolve) => {
      const sock = connect(Number(port), '127.0.0.1', () => {
        sock.write(`GET ${PATHS.brain.voice} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
      });
      let data = '';
      sock.on('data', (d) => (data += d));
      sock.on('close', () => resolve(data));
    });
    expect(reply).toMatch(/^HTTP\/1.1 501/);
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

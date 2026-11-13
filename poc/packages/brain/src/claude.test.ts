import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { FakeClaude } from '@poc/contracts/testing';
import { z } from 'zod';
import { Claude, ClaudeRefusalError, ClaudeRequestError, ClaudeUnavailableError, createAnthropicClient, isAbortError, type AnthropicLike } from './claude';
import { makeClock } from './config';
import { TriageOutput, buildTriageRequest } from './intake/triage';
import { estimateUsd } from './models';
import { CLIENTS, ME, NOW, makeDataDir } from './testing/harness';
import { UsageLog } from './usage';

async function setup(opts: { fallbacks?: boolean; cap?: number } = {}) {
  const dir = await makeDataDir();
  const clock = makeClock('UTC', null, () => new Date(NOW));
  const usage = new UsageLog(join(dir, 'logs/usage.jsonl'), clock);
  const fake = new FakeClaude();
  const claude = new Claude(fake as unknown as AnthropicLike, usage, { maxUsdPerDay: opts.cap ?? 5, fallbacks: opts.fallbacks ?? true, clock });
  const lines = async () => (await readFile(join(dir, 'logs/usage.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { fake, claude, lines, usage };
}

const user = (text: string) => [{ role: 'user' as const, content: text }];

describe('Claude wrapper', () => {
  it('sets effort explicitly on every call, per call type, and never sends sampling params or budget_tokens', async () => {
    const { fake, claude } = await setup();
    fake.setDefault({ text: 'ok' });
    await claude.create({ call: 'triage', sourceId: null }, { messages: user('a') });
    await claude.create({ call: 'prepare', sourceId: null }, { messages: user('a') });
    await claude.create({ call: 'chat', sourceId: null }, { messages: user('a') });
    await claude.create({ call: 'prioritise', sourceId: null }, { messages: user('a'), effort: 'medium' });
    expect(fake.calls.map((c) => [c.params.model, (c.params.output_config as { effort: string }).effort])).toEqual([
      ['claude-sonnet-5-5', 'low'],
      ['claude-opus-5-5', 'medium'],
      ['claude-haiku-5-5', 'low'],
      ['claude-sonnet-5-5', 'medium'],
    ]);
    for (const c of fake.calls) {
      for (const k of ['temperature', 'top_p', 'top_k']) expect(c.params).not.toHaveProperty(k);
      expect(JSON.stringify(c.params)).not.toContain('budget_tokens');
    }
  });

  it('opts Sonnet and Opus into server-side fallbacks, never Haiku', async () => {
    const { fake, claude } = await setup();
    fake.setDefault({ text: 'ok' });
    await claude.create({ call: 'triage', sourceId: null }, { messages: user('a') });
    await claude.create({ call: 'chat', sourceId: null }, { messages: user('a') });
    expect(fake.calls[0]!.params.fallbacks).toBe('default');
    expect(fake.calls[0]!.options?.headers).toEqual({ 'anthropic-beta': 'server-side-fallback-2026-07-01' });
    expect(fake.calls[1]!.params).not.toHaveProperty('fallbacks');
    expect(fake.calls[1]!.options?.headers).toBeUndefined();
    const off = await setup({ fallbacks: false });
    off.fake.setDefault({ text: 'ok' });
    await off.claude.create({ call: 'triage', sourceId: null }, { messages: user('a') });
    expect(off.fake.calls[0]!.params).not.toHaveProperty('fallbacks');
  });

  it('rejects request shapes the 5.5 models refuse, before sending', async () => {
    const { fake, claude } = await setup();
    fake.setDefault({ text: 'ok' });
    await expect(claude.create({ call: 'prepare', sourceId: null }, { messages: user('a'), thinking: 'disabled' })).rejects.toBeInstanceOf(ClaudeRequestError);
    await expect(claude.create({ call: 'triage', sourceId: null }, { messages: user('a'), thinking: 'disabled' })).rejects.toBeInstanceOf(ClaudeRequestError);
    await expect(claude.create({ call: 'chat', sourceId: null }, { messages: user('a'), thinking: 'disabled', effort: 'xhigh' })).rejects.toBeInstanceOf(ClaudeRequestError);
    await expect(claude.create({ call: 'triage', sourceId: null }, { messages: user('a'), toolChoice: { type: 'tool', name: 'x' } as never })).rejects.toBeInstanceOf(ClaudeRequestError);
    expect(fake.calls).toHaveLength(0);
    await claude.create({ call: 'chat', sourceId: null }, { messages: user('a'), thinking: 'disabled', effort: 'low' });
    await claude.create({ call: 'triage', sourceId: null }, { messages: user('a'), thinking: 'between_tools', effort: 'high' });
    expect(fake.calls.map((c) => c.params.thinking)).toEqual([{ type: 'disabled' }, { type: 'between_tools' }]);
  });

  it('streams text, logs usage once, and handles abort and refusal', async () => {
    const { fake, claude, lines } = await setup();
    fake.enqueue({ text: 'Hello there, here is the plan.', usage: { input_tokens: 500, output_tokens: 40 } });
    const s = await claude.stream({ call: 'chat', sourceId: null }, { messages: user('hi') });
    const deltas: string[] = [];
    s.on('text', (d) => deltas.push(d));
    const msg = await s.finalMessage();
    expect(deltas.join('')).toBe('Hello there, here is the plan.');
    expect(msg.stop_reason).toBe('end_turn');
    let events = 0;
    for await (const _ of s) events++;
    expect(events).toBeGreaterThan(3);

    fake.enqueue({ text: 'one two three four five six seven eight nine ten', chunkDelayMs: 10 });
    const s2 = await claude.stream({ call: 'chat', sourceId: 'turn-2' }, { messages: user('long') });
    s2.on('text', () => {
      if (s2.text.split(' ').length >= 3) s2.abort();
    });
    const err = await s2.finalMessage().catch((e) => e);
    expect(isAbortError(err)).toBe(true);
    expect(fake.calls[1]!.aborted).toBe(true);
    expect(s2.text.split(' ').length).toBeLessThan(10);

    fake.enqueue({ text: 'Sorry', stop_reason: 'refusal' });
    const s3 = await claude.stream({ call: 'chat', sourceId: null }, { messages: user('x') });
    await expect(s3.finalMessage()).rejects.toBeInstanceOf(ClaudeRefusalError);

    const l = await lines();
    expect(l).toHaveLength(3);
    expect(l[0]).toMatchObject({ call: 'chat', model: 'claude-haiku-5-5', input_tokens: 500, output_tokens: 40 });
    expect(l[1]).toMatchObject({ sourceId: 'turn-2', input_tokens: 1000 });
  });

  it('refuses a stream before it opens when the cap is reached', async () => {
    const { fake, claude } = await setup({ cap: 0 });
    fake.setDefault({ text: 'ok' });
    await expect(claude.stream({ call: 'chat', sourceId: null }, { messages: user('x') })).rejects.toMatchObject({ name: 'SpendCapError' });
    expect(fake.calls).toHaveLength(0);
  });

  it('without credentials the client is null and every call fails clearly, sending nothing', async () => {
    expect(createAnthropicClient({ anthropicBaseUrl: undefined }, {})).toBeNull();
    const dir = await makeDataDir();
    const clock = makeClock('UTC', null, () => new Date(NOW));
    const claude = new Claude(null, new UsageLog(join(dir, 'logs/usage.jsonl'), clock), { maxUsdPerDay: 5, fallbacks: true, clock });
    await expect(claude.create({ call: 'triage', sourceId: null }, { messages: user('a') })).rejects.toBeInstanceOf(ClaudeUnavailableError);
  });

  it('prices calls from the single table', () => {
    const u = { input_tokens: 1_000_000, output_tokens: 1_000_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 1_000_000 };
    expect(estimateUsd('claude-sonnet-5-5', u)).toBeCloseTo(2 + 10 + 0.1);
    expect(estimateUsd('claude-opus-5-5', u)).toBeCloseTo(4 + 20 + 0.2);
    expect(estimateUsd('claude-haiku-5-5', { ...u, input_tokens: 50_000, output_tokens: 1000, cache_read_input_tokens: 0 })).toBeCloseTo(0.005 + 0.0005);
    expect(estimateUsd('claude-sonnet-5-5', { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000, cache_read_input_tokens: 0, cache_creation: { ephemeral_5m_input_tokens: 500_000, ephemeral_1h_input_tokens: 500_000 } })).toBeCloseTo(1.25 + 2);
    // A fallback model missing from the table is priced at the requested model.
    expect(estimateUsd('claude-unknown-x', u, 'claude-opus-5-5')).toBeCloseTo(24.2);
  });
});

describe('triage prompt layout', () => {
  it('puts cache breakpoints after the roster and the profile, and "now" only after them', () => {
    const req = buildTriageRequest(
      { kind: 'mail', header: 'Email from Michael Okafor <michael.okafor@acmetooling.example>', subject: 'Pricing', body: 'Where are we? id-mail-777' },
      { now: new Date(NOW), today: '2026-11-13', tz: 'UTC', me: ME, clients: CLIENTS, aliases: {}, candidates: [{ clientId: 'poc-client-acme', score: 20, reasons: ['sender domain'] }], profiles: [{ clientId: 'poc-client-acme', markdown: '# Acme Tooling Co.\n' }], openTasks: [], pendingSuggestions: [] },
    );
    expect(req.system).toHaveLength(2);
    expect(req.system[0]!.cache_control).toBeUndefined();
    expect(req.system[1]!.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    const content = req.messages[0]!.content as { text: string; cache_control?: unknown }[];
    expect(content[0]!.cache_control).toEqual({ type: 'ephemeral', ttl: '5m' });
    expect(content.slice(1).every((b) => b.cache_control === undefined)).toBe(true);
    const cached = JSON.stringify([req.system, content[0]]);
    expect(cached).not.toContain(NOW);
    expect(cached).not.toContain('2026-11-13');
    expect(cached).not.toContain('id-mail-777');
    expect(content[1]!.text).toContain(NOW);
    expect(content[content.length - 1]!.text).toContain('untrusted');
    // Same roster -> byte-identical cached prefix (no shuffled keys).
    const again = buildTriageRequest({ kind: 'chat', header: 'x', body: 'y' }, { now: new Date(), today: '2026-11-14', tz: 'UTC', me: ME, clients: [...CLIENTS].reverse(), aliases: {}, candidates: [], profiles: [], openTasks: [], pendingSuggestions: [] });
    expect(JSON.stringify(again.system)).toBe(JSON.stringify(req.system));
  });

  it('zodOutputFormat accepts the zod 4 triage schema', () => {
    const fmt = zodOutputFormat(TriageOutput) as unknown as { type: string; schema: Record<string, unknown> };
    expect(fmt.type).toBe('json_schema');
    expect(Object.keys(fmt.schema.properties as object).sort()).toEqual(['alias', 'clientId', 'confidence', 'meetingRequest', 'nudge', 'profileEdits', 'tasks']);
  });
});

// ---- the real SDK against a local stand-in for the Messages API ------------

describe('real SDK through ANTHROPIC_BASE_URL (no network, no key)', () => {
  const seen: { path: string; headers: IncomingMessage['headers']; body: Record<string, unknown> }[] = [];
  let baseUrl = '';
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const body = JSON.parse(raw || '{}');
    seen.push({ path: req.url ?? '', headers: req.headers, body });
    const message = (content: unknown[]) => ({ id: 'msg_local_1', type: 'message', role: 'assistant', model: body.model, content, stop_reason: 'end_turn', stop_sequence: null, stop_details: null, usage: { input_tokens: 11, output_tokens: 7, cache_creation_input_tokens: 0, cache_read_input_tokens: 5 } });
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      send('message_start', { type: 'message_start', message: { ...message([]), usage: { input_tokens: 11, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 5 } } });
      send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      for (const t of ['Hello ', 'from ', 'the gateway.']) send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } });
      send('content_block_stop', { type: 'content_block_stop', index: 0 });
      send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 7 } });
      send('message_stop', { type: 'message_stop' });
      res.end();
      return;
    }
    const isParse = !!(body.output_config as { format?: unknown } | undefined)?.format;
    const text = isParse ? JSON.stringify({ answer: 'forty-two', n: 42 }) : 'plain reply';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(message([{ type: 'text', text }])));
  });
  const saved = { base: process.env.ANTHROPIC_BASE_URL, key: process.env.ANTHROPIC_API_KEY };

  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.ANTHROPIC_BASE_URL = baseUrl;
    process.env.ANTHROPIC_API_KEY = 'dummy-local-test-value';
  });
  afterAll(async () => {
    process.env.ANTHROPIC_BASE_URL = saved.base;
    process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.base === undefined) delete process.env.ANTHROPIC_BASE_URL;
    if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY;
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('create, parse (zod 4) and stream all go to ANTHROPIC_BASE_URL with the fallback beta header', async () => {
    const dir = await makeDataDir();
    const clock = makeClock('UTC', null, () => new Date(NOW));
    const usage = new UsageLog(join(dir, 'logs/usage.jsonl'), clock);
    const client = createAnthropicClient({ anthropicBaseUrl: undefined }); // the SDK reads ANTHROPIC_BASE_URL itself
    expect(client).not.toBeNull();
    const claude = new Claude(client, usage, { maxUsdPerDay: 5, fallbacks: true, clock });

    const created = await claude.create({ call: 'triage', sourceId: 'm1' }, { messages: user('hi') });
    expect(created.content[0]).toMatchObject({ type: 'text', text: 'plain reply' });

    const parsed = await claude.parse({ call: 'triage', sourceId: 'm2' }, { messages: user('q') }, z.object({ answer: z.string(), n: z.number() }));
    expect(parsed.data).toEqual({ answer: 'forty-two', n: 42 });

    const s = await claude.stream({ call: 'chat', sourceId: null }, { messages: user('hi') });
    let text = '';
    s.on('text', (d) => (text += d));
    await s.finalMessage();
    expect(text).toBe('Hello from the gateway.');

    expect(seen.map((x) => x.path)).toEqual(['/v1/messages', '/v1/messages', '/v1/messages']);
    expect(seen[0]!.headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01');
    expect(seen[0]!.body).toMatchObject({ model: 'claude-sonnet-5-5', fallbacks: 'default', output_config: { effort: 'low' } });
    expect(seen[1]!.body.output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } });
    expect(seen[2]!.body).toMatchObject({ model: 'claude-haiku-5-5', stream: true });
    expect(seen[2]!.body).not.toHaveProperty('fallbacks');
    expect(seen[2]!.headers['anthropic-beta']).toBeUndefined();

    const log = await readFile(join(dir, 'logs/usage.jsonl'), 'utf8');
    expect(log.trim().split('\n')).toHaveLength(3);
    expect(log).not.toContain('dummy-local-test-value');
    expect(JSON.parse(log.trim().split('\n')[2]!)).toMatchObject({ call: 'chat', input_tokens: 11, output_tokens: 7, cache_read_input_tokens: 5 });
  });
});

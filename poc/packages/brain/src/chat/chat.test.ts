/** POST /api/chat with FakeClaude: tools, suggestions only, grounding, shared history. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CHAT_SSE_EVENTS, DATA_LAYOUT, MCP_WRITE_TOOLS } from '@poc/contracts';
import type { FakeParams } from '@poc/contracts/testing';
import { CLIENTS, michaelMail, task, triage } from '../testing/harness';
import type { ConversationFile } from './conversation';
import { postChat, upChat, type ChatRig } from './testHelpers';
import { impliedDueDate } from './tools';

const rigs: ChatRig[] = [];
afterEach(async () => {
  for (const r of rigs.splice(0)) await r.h.brain.stop();
});
async function rig(opts: Parameters<typeof upChat>[0] = {}) {
  const r = await upChat(opts);
  rigs.push(r);
  return r;
}

type Msg = { role: string; content: string | { type: string; text?: string; content?: string; tool_use_id?: string }[] };

/** Text the user typed or said in the latest user message (not tool results). */
function lastUserText(p: FakeParams): string {
  const msgs = p.messages as Msg[];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]!;
    if (m.role !== 'user' || typeof m.content === 'string') continue;
    if (m.content.some((b) => b.type === 'tool_result')) continue;
    return m.content.map((b) => b.text ?? '').join('\n');
  }
  return '';
}

function toolResults(p: FakeParams): { tool_use_id: string; content: string; is_error?: boolean }[] {
  const last = (p.messages as Msg[]).at(-1)!;
  return typeof last.content === 'string' ? [] : (last.content.filter((b) => b.type === 'tool_result') as never);
}

const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use' as const, id, name, input });
const FRIDAY = '2026-11-20'; // harness "now" is Friday 2026-11-13, so "Friday" is the next one

/** Chase-Michael triage answer (follow_up, Acme). */
const chaseTriage = (dueDate: string | null) =>
  triage({
    nudge: 'You want to chase Michael on Friday.',
    tasks: [{ title: 'Chase Michael Okafor', direction: 'owed_to_me', taskType: 'follow_up', dueDate, duplicateOf: null }],
    meetingRequest: false,
    profileEdits: [],
  });

describe('POST /api/chat', () => {
  it('"add a task to chase Michael on Friday" gives exactly one create_task suggestion (follow_up, Acme, Friday) and no write', async () => {
    const { h, base } = await rig();
    h.claude.enqueue(
      { content: [{ type: 'text', text: 'Sure, one moment.' }, toolUse('tu1', 'propose_create_task', { request: 'Chase Michael on Friday' })] },
      { parsed: chaseTriage(FRIDAY) },
      { text: "I've suggested a task to chase Michael on Friday the twentieth. Approve it when you're ready." },
    );
    const events = await postChat(base, 'add a task to chase Michael on Friday');
    for (const e of events) expect(CHAT_SSE_EVENTS[e.event as keyof typeof CHAT_SSE_EVENTS].safeParse(e.data).success, e.event).toBe(true);

    const sugEvents = events.filter((e) => e.event === 'suggestion');
    expect(sugEvents).toHaveLength(1);
    const s = sugEvents[0]!.data.suggestion;
    expect(s).toMatchObject({ kind: 'create_task', status: 'pending', clientId: 'poc-client-acme', taskType: 'follow_up', payload: { dueDate: FRIDAY } });
    expect(s.source.connector).toBe('manual');
    expect(h.brain.suggestions.list().filter((x) => x.kind === 'create_task')).toHaveLength(1);

    const done = events.at(-1)!;
    expect(done.event).toBe('done');
    const deltas = events.filter((e) => e.event === 'delta').map((e) => e.data.text).join('');
    expect(deltas).toBe(done.data.text);
    expect(done.data.text).toBe("Sure, one moment.\n\nI've suggested a task to chase Michael on Friday the twentieth. Approve it when you're ready.");

    // The call: Haiku, streamed, thinking off, effort set, tools eager-streamed, no write tool, no forced tool choice.
    const first = h.claude.calls[0]!;
    expect(first.method).toBe('stream');
    expect(first.params.model).toBe('claude-haiku-5-5');
    expect(first.params.thinking).toEqual({ type: 'disabled' });
    expect(first.params.output_config).toEqual({ effort: 'low' });
    expect(first.params.tool_choice).toBeUndefined();
    const tools = first.params.tools as { name: string; eager_input_streaming?: boolean }[];
    expect(tools.every((t) => t.eager_input_streaming === true)).toBe(true);
    const names = tools.map((t) => t.name);
    for (const w of MCP_WRITE_TOOLS) expect(names).not.toContain(w);
    expect(names.filter((n) => !['list_tasks', 'list_clients', 'read_source'].includes(n)).every((n) => n.startsWith('propose_'))).toBe(true);
    // The triage call was the same path as typed input.
    expect(h.claude.calls[1]!.method).toBe('parse');
    expect(JSON.stringify(h.claude.calls[1]!.params.messages)).toContain('Chase Michael on Friday');
    // Cache layout: roster cached for 1h, context last.
    const system = first.params.system as { text: string; cache_control?: unknown }[];
    expect(system[1]!.cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    expect(system[0]!.text).not.toMatch(/2026/);
    expect(lastUserText(first.params)).toContain('Now: Friday 2026-11-13');

    // Nothing written anywhere; the guard holds.
    await h.brain.idle();
    expect(h.writes).toEqual([]);
    expect(h.pm.writeCalls).toEqual([]);
    // The suggestion is approvable through the normal path only.
    await h.brain.approve(s.id, {});
    expect(h.writes.map((w) => [w.method, w.approval])).toEqual([['createTask', s.id]]);
  });

  it('a plainly named day is enforced in code when triage gets the date wrong', async () => {
    const { h, base } = await rig();
    h.claude.enqueue({ content: [toolUse('tu1', 'propose_create_task', { request: 'Chase Michael on Friday' })] }, { parsed: chaseTriage(null) }, { text: 'Suggested.' });
    const events = await postChat(base, 'add a task to chase michael on friday');
    const s = events.find((e) => e.event === 'suggestion')!.data.suggestion;
    expect(s.payload.dueDate).toBe(FRIDAY);
    expect(h.brain.suggestions.get(s.id)!.kind === 'create_task' && h.brain.suggestions.get(s.id)!.payload).toMatchObject({ dueDate: FRIDAY });
    expect(impliedDueDate('chase michael on friday', '2026-11-13')).toBe(FRIDAY);
    expect(impliedDueDate('chase michael tomorrow', '2026-11-13')).toBe('2026-11-14');
    expect(impliedDueDate('chase michael next friday', '2026-11-13')).toBeNull();
    expect(impliedDueDate('chase michael on monday or friday', '2026-11-13')).toBeNull();
    expect(impliedDueDate('chase michael', '2026-11-13')).toBeNull();
  });

  it('read tools return live data from the connectors', async () => {
    const { h, base } = await rig({ harness: { tasks: [task('t-1', 'poc-client-acme', 'Send Lena the benchmark matches', '2026-11-16')] } });
    h.claude.enqueue({ content: [toolUse('a', 'list_tasks', {}), toolUse('b', 'list_clients', {})] });
    h.claude.enqueue((p) => {
      const res = toolResults(p);
      expect(res.map((r) => r.tool_use_id)).toEqual(['a', 'b']);
      const tasks = JSON.parse(res[0]!.content).tasks;
      expect(tasks).toEqual([expect.objectContaining({ id: 't-1', title: 'Send Lena the benchmark matches', due: '2026-11-16' })]);
      const clients = JSON.parse(res[1]!.content).clients.map((c: { name: string }) => c.name);
      expect(clients).toEqual(CLIENTS.map((c) => c.name));
      return { text: 'You have one task: send Lena the matches by Monday.' };
    });
    const events = await postChat(base, 'what is on my list?');
    expect(events.at(-1)).toMatchObject({ event: 'done', data: { text: 'You have one task: send Lena the matches by Monday.' } });
    // Live: a task added in the PM app shows up on the next turn without any cache.
    await h.pm.createTask({ clientId: 'poc-client-quillon', title: 'Draft revised levels for Renata', dueDate: '2026-11-18', assigneeIds: ['poc-member-alex'] });
    h.claude.enqueue({ content: [toolUse('c', 'list_tasks', {})] }, (p) => {
      expect(JSON.parse(toolResults(p)[0]!.content).tasks.map((t: { title: string }) => t.title)).toContain('Draft revised levels for Renata');
      return { text: 'Two tasks now.' };
    });
    await postChat(base, 'and now?');
    expect(h.claude.calls).toHaveLength(4);
  });

  it('propose tools only create suggestions; bad input is refused without side effects', async () => {
    const { h, base } = await rig({ harness: { tasks: [task('t-1', 'poc-client-acme', 'Send Lena the benchmark matches', '2026-11-16')] } });
    h.claude.enqueue(
      {
        content: [
          toolUse('a', 'propose_complete_task', { taskId: 't-1', reason: 'you sent them this morning' }),
          toolUse('b', 'propose_reschedule_task', { taskId: 't-1', dueDate: '2026-11-17' }),
          toolUse('c', 'propose_calendar_block', { purpose: 'lunch', start: '2026-11-14T12:00:00Z', end: '2026-11-14T12:30:00Z' }),
          toolUse('d', 'propose_complete_task', { taskId: 'no-such-task' }),
          toolUse('e', 'propose_calendar_block', { purpose: 'focus', start: '2026-11-13T15:00:00Z', end: '2026-11-13T15:45:00Z' }), // overlaps the 15:30 check-in
          toolUse('f', 'propose_reschedule_task', { taskId: 't-1', dueDate: 'next tuesday' }),
          toolUse('g', 'complete_task', { taskId: 't-1' }), // not a tool the model has
        ],
      },
      (p) => {
        const res = toolResults(p);
        expect(res.map((r) => !!r.is_error)).toEqual([false, false, false, true, true, true, true]);
        expect(res[4]!.content).toMatch(/overlaps "Acme Tooling check-in"/);
        expect(res[5]!.content).toMatch(/INVALID_INPUT/);
        return { text: 'Three suggestions are waiting for you.' };
      },
    );
    const events = await postChat(base, 'mark the matches done, move them to tuesday, and block lunch tomorrow at noon');
    expect(events.filter((e) => e.event === 'suggestion').map((e) => e.data.suggestion.kind)).toEqual(['complete_task', 'reschedule_task', 'calendar_block']);
    await h.brain.idle();
    expect(h.writes).toEqual([]);
    expect(h.pm.writeCalls).toEqual([]);
    expect(h.calendar.created).toEqual([]);
    // Asking again does not duplicate a pending suggestion.
    h.claude.enqueue({ content: [toolUse('x', 'propose_complete_task', { taskId: 't-1' })] }, (p) => {
      expect(JSON.parse(toolResults(p)[0]!.content).alreadyPending).toBeTruthy();
      return { text: 'Already suggested.' };
    });
    await postChat(base, 'mark the matches done');
    expect(h.brain.suggestions.list().filter((s) => s.kind === 'complete_task')).toHaveLength(1);
  });

  it('answers "what did Michael want?" from the source message behind the nudge', async () => {
    const { h, base } = await rig();
    h.claude.enqueue({ parsed: triage() });
    const mail = h.mail.deliver(michaelMail);
    await h.brain.tick();
    expect(h.brain.nudges.list()).toHaveLength(1);
    // A scripted "model" that finds the mail id in the context, as the prompt tells it to.
    h.claude.enqueue(
      (p) => {
        const ctx = lastUserText(p);
        const m = /source mail:(\S+)/.exec(ctx);
        expect(m?.[1]).toBe(mail.id);
        return { content: [toolUse('r', 'read_source', { connector: 'mail', id: m![1] })] };
      },
      (p) => {
        const out = JSON.parse(toolResults(p)[0]!.content);
        expect(out.note).toMatch(/untrusted/);
        expect(out.email.body).toContain('quick update on the market pricing analysis');
        expect(out.email.from).toContain('Michael Okafor');
        return { text: 'Michael wants a quick update on the market pricing analysis and 45 minutes next week.' };
      },
    );
    const events = await postChat(base, 'what did Michael want?');
    expect(events.at(-1)!.data.text).toMatch(/market pricing analysis/);
  });

  it('keeps one append-only conversation; history is replayed unchanged and the context says "unchanged"', async () => {
    const { h, base } = await rig();
    h.claude.enqueue({ text: 'Hello Alex.' }, { text: 'Still here.' });
    await postChat(base, 'hi');
    await postChat(base, 'still there?');
    const second = h.claude.calls[1]!.params.messages as Msg[];
    expect(second.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(lastUserText({ model: 'x', messages: [second[0]] })).toContain('hi');
    expect(second[1]!.content).toEqual([expect.objectContaining({ type: 'text', text: 'Hello Alex.', cache_control: { type: 'ephemeral' } })]);
    expect(lastUserText(h.claude.calls[1]!.params)).toContain('<context>Unchanged since the previous message.</context>');
    const file = JSON.parse(await readFile(join(h.dataDir, DATA_LAYOUT.brainConversation), 'utf8')) as ConversationFile;
    expect(file.turns.map((t) => [t.via, t.user, t.assistant])).toEqual([
      ['text', 'hi', 'Hello Alex.'],
      ['text', 'still there?', 'Still here.'],
    ]);
    // Stored messages carry no cache markers (they are added per request).
    expect(JSON.stringify(file.messages)).not.toContain('cache_control');
  });

  it('a Claude failure becomes an error event, and the turn is still recorded', async () => {
    const { h, base } = await rig({ harness: { maxUsdPerDay: 0 } });
    const events = await postChat(base, 'hello');
    expect(events.map((e) => e.event)).toEqual(['error', 'done']);
    expect(events[0]!.data.error).toMatch(/budget/);
    expect(h.claude.calls).toHaveLength(0);
  });

  it('rejects a bad body with 400', async () => {
    const { base } = await rig();
    const res = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '  ' }) });
    expect(res.status).toBe(400);
  });
});



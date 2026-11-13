/**
 * Integration check against the REAL pm-server (MCP) and mocks, with
 * FakeClaude standing in for the API. Skipped unless BRAIN_LIVE_TEST=1.
 *
 *   POC_DATA_DIR=<dir> npm --prefix poc run seed
 *   POC_DATA_DIR=<dir> npm --prefix poc run start -w @poc/pm-server
 *   POC_DATA_DIR=<dir> POC_NOW=... MOCKS_HOST=127.0.0.1 npm --prefix poc run start -w @poc/mocks
 *   BRAIN_LIVE_TEST=1 POC_DATA_DIR=<dir> PM_MCP_URL=http://127.0.0.1:8081/mcp MOCKS_URL=http://127.0.0.1:8090 \
 *     npx vitest run --project @poc/brain src/live.test.ts
 *
 * Uses the seed's clients, so it writes to that (scratch) data dir.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATA_LAYOUT, PATHS, type GraphMessage } from '@poc/contracts';
import { FakeClaude } from '@poc/contracts/testing';
import { Brain } from './brain';
import type { AnthropicLike } from './claude';
import { loadConfig } from './config';
import { GraphCalendarConnector } from './connectors/calendar';
import { ZoomChatConnector } from './connectors/chat';
import { LocalFilesConnector } from './connectors/files';
import { GraphMailConnector } from './connectors/mail';
import { McpPmConnector } from './connectors/pm';
import { createModules } from './modules';

const live = process.env.BRAIN_LIVE_TEST === '1';

describe.skipIf(!live)('live: real pm-server and mocks, FakeClaude', () => {
  it('mail and chat -> suggestions -> approve -> Planr, Sent and calendar', async () => {
    const config = { ...loadConfig(), port: 0 };
    const pm = new McpPmConnector(config.pmMcpUrl);
    const mail = new GraphMailConnector(config.mocksUrl);
    const claude = new FakeClaude();
    const brain = new Brain({
      config,
      anthropic: claude as unknown as AnthropicLike,
      connectors: { pm, mail, calendar: new GraphCalendarConnector(config.mocksUrl), chat: new ZoomChatConnector(config.mocksUrl), files: new LocalFilesConnector(join(config.dataDir, DATA_LAYOUT.files)) },
      modules: createModules(),
      log: () => {},
    });
    await brain.init();
    try {
      // Seeded history before the intake cursor is not triaged.
      await brain.tick();
      expect(claude.calls).toHaveLength(0);

      claude.setDefault((params) => {
        const harbor = JSON.stringify(params.messages).includes('Harbor');
        return {
          parsed: {
            clientId: harbor ? 'poc-client-harborlight' : 'poc-client-acme',
            confidence: 'high',
            alias: null,
            nudge: harbor ? 'Priya says Harbor sent a draft to review.' : 'Michael wants an update and a meeting. Want me to draft a reply?',
            tasks: harbor
              ? [{ title: 'Review the HLF driver pay draft', direction: 'i_owe', taskType: 'review_file', dueDate: '2026-11-19', duplicateOf: null }]
              : [
                  { title: 'Reply to Michael with a pricing update', direction: 'i_owe', taskType: 'reply_email', dueDate: '2026-11-13', duplicateOf: null },
                  { title: 'Set up a call with Michael', direction: 'i_owe', taskType: 'schedule_meeting', dueDate: null, duplicateOf: null },
                ],
            meetingRequest: !harbor,
            profileEdits: [],
          },
        };
      });
      const post = (path: string, body: unknown) => fetch(config.mocksUrl + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const dropped = (await (await post(PATHS.control.mail, { from: { name: 'Michael Okafor', address: 'michael.okafor@acmetooling.example' }, subject: 'Market pricing: where are we?', body: 'Could you send an update? And let us meet next week.' })).json()) as GraphMessage;
      await post(PATHS.control.chat, { sender: 'priya.shah@brightline-advisory.example', sender_display_name: 'Priya Shah', message: 'Harbor sent over "HLF Driver Pay Structure Draft.pdf". Can you read it before Thursday?' });
      await brain.tick();
      await brain.tick();
      expect(claude.calls).toHaveLength(2);
      const pending = brain.suggestions.list().filter((s) => s.status === 'pending');
      expect(pending.map((s) => [s.clientId, s.source?.connector])).toEqual([
        ['poc-client-acme', 'mail'],
        ['poc-client-acme', 'mail'],
        ['poc-client-harborlight', 'chat'],
      ]);
      expect(pending[0]!.source?.id).toBe(dropped.id);
      // Prematch used the real client list and files.
      expect(JSON.stringify(claude.calls[1]!.params.messages)).toContain('names file');

      const approved = await brain.approve(pending[0]!.id, {});
      expect(approved.status).toBe('applied');
      await brain.deny(pending[1]!.id);
      const { tasks } = await pm.listTasks({ assigneeId: config.me.id });
      const created = tasks.find((t) => t.title === 'Reply to Michael with a pricing update')!;
      expect(created).toMatchObject({ clientId: 'poc-client-acme', boardLabel: 'Ad-hoc', deliverableTitle: 'General' });
      const state = await brain.buildState();
      expect(state.sections.find((s) => s.key === 'today')!.items.map((i) => i.taskId)).toContain(created.id);
      expect(state.calendarToday.length).toBeGreaterThan(0);

      const reply = await brain.suggestions.add({ kind: 'send_reply', title: 'Reply', nudge: 'Send?', clientId: 'poc-client-acme', clientConfidence: 'high', source: null, payload: { draft: { to: [{ name: 'Michael Okafor', address: 'michael.okafor@acmetooling.example' }], cc: [], subject: 'Re: Market pricing', body: 'Hi Michael, live check.', replyToMessageId: dropped.id }, taskId: created.id } });
      expect((await brain.approve(reply.id, {})).status).toBe('applied');
      const sent = (await (await fetch(config.mocksUrl + PATHS.control.sent)).json()) as GraphMessage[];
      expect(sent.some((m) => m.body.content === 'Hi Michael, live check.')).toBe(true);
      expect((await pm.listTasks({ includeDone: true })).tasks.find((t) => t.id === created.id)!.done).toBe(true);

      const lunch = await brain.suggestions.add({ kind: 'calendar_block', title: 'Lunch', nudge: 'Lunch?', clientId: null, clientConfidence: 'high', source: null, payload: { subject: 'Lunch (live check)', start: '2026-11-13T12:00:00.000Z', end: '2026-11-13T12:30:00.000Z', purpose: 'lunch', taskId: null } });
      expect((await brain.approve(lunch.id, {})).status).toBe('applied');
      expect((await brain.read.calendar.view('2026-11-13T00:00:00Z', '2026-11-14T00:00:00Z')).some((e) => e.subject === 'Lunch (live check)')).toBe(true);

      // A failing action against the real server is marked failed, not retried.
      const bad = await brain.suggestions.add({ kind: 'complete_task', title: 'x', nudge: 'x', clientId: null, clientConfidence: 'high', source: null, payload: { taskId: 'no-such-task' } });
      const failed = await brain.approve(bad.id, {});
      expect(failed.status).toBe('failed');
      expect(failed.error).toBeTruthy();
      await brain.idle();
    } finally {
      await pm.close();
    }
  }, 30_000);
});

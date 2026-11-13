import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CalEvent,
  CalEventList,
  CannedMessage,
  ControlResetResponse,
  DATA_LAYOUT,
  ErrorBody,
  GraphMessage,
  GraphMessageList,
  Health,
  PATHS,
  ZoomChatMessage,
  ZoomChatMessageList,
  draftToSendMail,
  toGraphDateTime,
  type ControlMailDrop,
} from '@poc/contracts';
import { SAMPLES } from '@poc/contracts/testing';
import { createApp } from './app';

// Invented fixture data. "Now" is fixed and equals the seed's intake cursor.
const NOW = '2026-11-13T09:00:00.000Z';
const ME = { name: 'Alex Rivera', address: 'alex.rivera@brightline-advisory.example' };
const MICHAEL = { name: 'Michael Okafor', address: 'michael.okafor@acmetooling.example' };
const PRIYA = 'priya.shah@brightline-advisory.example';

const mail = (id: string, at: string, subject: string): GraphMessage => ({
  id,
  conversationId: `conv-${id}`,
  subject,
  from: { emailAddress: MICHAEL },
  toRecipients: [{ emailAddress: ME }],
  ccRecipients: [],
  receivedDateTime: at,
  sentDateTime: at,
  body: { contentType: 'text', content: `${subject} body` },
  bodyPreview: `${subject} body`,
  isRead: false,
});
const event = (id: string, startIso: string, endIso: string, subject: string): CalEvent => ({
  id,
  subject,
  start: toGraphDateTime(startIso),
  end: toGraphDateTime(endIso),
  attendees: [],
  showAs: 'busy',
  isAllDay: false,
  categories: [],
  bodyPreview: '',
});
const chat = (id: string, at: string, message: string): ZoomChatMessage => ({
  id,
  message,
  sender: PRIYA,
  sender_display_name: 'Priya Shah',
  date_time: at,
  timestamp: Date.parse(at),
  to_contact: PRIYA,
});

const FIXTURE = {
  mail: [mail('m-old', '2026-11-10T10:00:00.000Z', 'Older'), mail('m-new', '2026-11-12T10:00:00.000Z', 'Newer')],
  sent: [] as GraphMessage[],
  calendar: [
    event('e-1', '2026-11-13T11:00:00Z', '2026-11-13T11:30:00Z', 'Team huddle'),
    event('e-2', '2026-11-14T15:00:00Z', '2026-11-14T16:00:00Z', 'Staffing review'),
  ],
  chat: [chat('c-1', '2026-11-12T08:00:00.000Z', 'First'), chat('c-2', '2026-11-12T12:00:00.000Z', 'Second')],
};

let dir: string;
let server: Server;
let base: string;

function writeFixture(root: string) {
  const put = (rel: string, v: unknown) => {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), JSON.stringify(v, null, 2));
  };
  for (const [name, rel] of [
    ['mail', DATA_LAYOUT.mocksMail],
    ['sent', DATA_LAYOUT.mocksSent],
    ['calendar', DATA_LAYOUT.mocksCalendar],
    ['chat', DATA_LAYOUT.mocksChat],
  ] as const) {
    put(rel, FIXTURE[name]);
    put(rel.replace('mocks/', 'mocks/initial/'), FIXTURE[name]);
  }
  put(DATA_LAYOUT.mocksCanned, [SAMPLES.CannedMessage!.valid]);
  put(DATA_LAYOUT.seedInfo, SAMPLES.SeedInfo!.valid);
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'poc-mocks-'));
  writeFixture(dir);
  server = createServer(createApp({ dataDir: dir, tz: 'UTC', now: () => new Date(NOW) }));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

const getJson = async (path: string) => {
  const res = await fetch(base + path);
  return { status: res.status, body: (await res.json()) as unknown };
};
const postJson = async (path: string, body?: unknown) => {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, body: text ? (JSON.parse(text) as unknown) : null };
};
const messagesUrl = (q: Record<string, string>) => `${PATHS.graph.messages}?${new URLSearchParams(q)}`;
const dropMail = (over: Partial<ControlMailDrop> = {}) =>
  postJson(PATHS.control.mail, { from: MICHAEL, subject: 'Pricing: where are we?', body: 'Could you send an update?', ...over });

describe('health and control page', () => {
  it('health matches the contract', async () => {
    const { status, body } = await getJson(PATHS.control.health);
    expect(status).toBe(200);
    expect(Health.parse(body)).toEqual({ ok: true, service: 'mocks', now: NOW });
  });

  it('serves the control page at /', async () => {
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    for (const tab of ['Inbox', 'Sent', 'Calendar', 'Chat']) expect(html).toContain(`data-tab="${tab.toLowerCase()}"`);
    expect(html).toContain(PATHS.control.canned);
    expect(html).toContain(PATHS.control.reset);
  });

  it('unknown routes give 404 and wrong methods 405, as ErrorBody', async () => {
    const a = await getJson('/v1.0/me/nothing');
    expect(a.status).toBe(404);
    ErrorBody.parse(a.body);
    const b = await postJson(PATHS.graph.messages, {});
    expect(b.status).toBe(405);
    ErrorBody.parse(b.body);
  });
});

describe('fake Graph mail', () => {
  it('lists newest first by default, oldest first with $orderby asc', async () => {
    const d = GraphMessageList.parse((await getJson(PATHS.graph.messages)).body);
    expect(d.value.map((m) => m.id)).toEqual(['m-new', 'm-old']);
    const a = GraphMessageList.parse((await getJson(messagesUrl({ $orderby: 'receivedDateTime asc' }))).body);
    expect(a.value.map((m) => m.id)).toEqual(['m-old', 'm-new']);
  });

  it('$filter receivedDateTime gt is strict, and $top limits', async () => {
    const r = GraphMessageList.parse(
      (await getJson(messagesUrl({ $filter: 'receivedDateTime gt 2026-11-10T10:00:00.000Z', $orderby: 'receivedDateTime' }))).body,
    );
    expect(r.value.map((m) => m.id)).toEqual(['m-new']);
    const top = GraphMessageList.parse((await getJson(messagesUrl({ $top: '1' }))).body);
    expect(top.value.map((m) => m.id)).toEqual(['m-new']);
  });

  it('accepts an unencoded + offset in $filter (hand-typed curl)', async () => {
    const r = await getJson(`${PATHS.graph.messages}?$filter=receivedDateTime%20gt%202026-11-11T11:00:00+01:00`);
    expect(r.status).toBe(200);
    expect(GraphMessageList.parse(r.body).value.map((m) => m.id)).toEqual(['m-new']);
  });

  it('rejects filters it does not understand', async () => {
    const r = await getJson(messagesUrl({ $filter: "subject eq 'x'" }));
    expect(r.status).toBe(400);
    ErrorBody.parse(r.body);
  });

  it('a dropped email shows up in a $filter query after the cursor', async () => {
    const cursor = NOW; // = SeedInfo.intakeCursor in the fixture
    const before = GraphMessageList.parse((await getJson(messagesUrl({ $filter: `receivedDateTime gt ${cursor}` }))).body);
    expect(before.value).toEqual([]);

    const drop = await dropMail();
    expect(drop.status).toBe(201);
    const dropped = GraphMessage.parse(drop.body);
    expect(Date.parse(dropped.receivedDateTime)).toBeGreaterThan(Date.parse(cursor));
    expect(dropped.toRecipients[0]!.emailAddress.address).toBe(ME.address);
    expect(dropped.bodyPreview).toBe('Could you send an update?');

    const after = GraphMessageList.parse(
      (await getJson(messagesUrl({ $filter: `receivedDateTime gt ${cursor}`, $orderby: 'receivedDateTime asc' }))).body,
    );
    expect(after.value).toEqual([dropped]);

    // Next poll with the new cursor sees nothing; a second drop is strictly later.
    const second = GraphMessage.parse((await dropMail({ subject: 'Second' })).body);
    expect(Date.parse(second.receivedDateTime)).toBeGreaterThan(Date.parse(dropped.receivedDateTime));
    const next = GraphMessageList.parse(
      (await getJson(messagesUrl({ $filter: `receivedDateTime gt ${dropped.receivedDateTime}` }))).body,
    );
    expect(next.value.map((m) => m.id)).toEqual([second.id]);
  });

  it('a drop with an old receivedDateTime is still stamped after the newest message', async () => {
    const d = GraphMessage.parse((await dropMail({ receivedDateTime: '2026-01-01T00:00:00Z' })).body);
    expect(Date.parse(d.receivedDateTime)).toBeGreaterThan(Date.parse(NOW));
    const kept = GraphMessage.parse((await dropMail({ receivedDateTime: '2026-12-01T00:00:00.000Z', conversationId: 'conv-m-new' })).body);
    expect(kept.receivedDateTime).toBe('2026-12-01T00:00:00.000Z');
    expect(kept.conversationId).toBe('conv-m-new');
  });

  it('rejects an invalid drop with 400', async () => {
    const r = await postJson(PATHS.control.mail, { from: MICHAEL, subject: 'No body' });
    expect(r.status).toBe(400);
    ErrorBody.parse(r.body);
  });

  it('gets one message by id, 404 for unknown', async () => {
    const r = await getJson(PATHS.graph.message('m-old'));
    expect(GraphMessage.parse(r.body).subject).toBe('Older');
    const miss = await getJson(PATHS.graph.message('nope'));
    expect(miss.status).toBe(404);
    ErrorBody.parse(miss.body);
  });

  it('sendMail returns 202 with no body and lands in Sent only', async () => {
    const req = draftToSendMail({
      to: [MICHAEL],
      cc: [],
      subject: 'Re: Pricing',
      body: 'Hi Michael,\n\nHere is the update.',
      replyToMessageId: 'm-new',
    });
    const r = await postJson(PATHS.graph.sendMail, req);
    expect(r.status).toBe(202);
    expect(r.text).toBe('');
    const id = r.headers.get('x-poc-message-id');
    expect(id).toBeTruthy();

    const sent = (await getJson(PATHS.control.sent)).body as unknown[];
    expect(sent).toHaveLength(1);
    const item = GraphMessage.parse(sent[0]);
    expect(item.id).toBe(id);
    expect(item.subject).toBe('Re: Pricing');
    expect(item.from.emailAddress.address).toBe(ME.address);
    expect(item.toRecipients).toEqual([{ emailAddress: MICHAEL }]);

    // Reachable by id, but not in the inbox listing.
    expect(GraphMessage.parse((await getJson(PATHS.graph.message(id!))).body).id).toBe(id);
    const inbox = GraphMessageList.parse((await getJson(PATHS.graph.messages)).body);
    expect(inbox.value.map((m) => m.id)).not.toContain(id);

    // Persisted to disk.
    const onDisk = JSON.parse(readFileSync(join(dir, DATA_LAYOUT.mocksSent), 'utf8')) as GraphMessage[];
    expect(onDisk.map((m) => m.id)).toEqual([id]);
  });

  it('the Sent Items folder lists what sendMail filed, oldest first (Graph mailFolders/sentitems/messages)', async () => {
    for (const subject of ['First chaser', 'Second chaser']) {
      const r = await postJson(PATHS.graph.sendMail, draftToSendMail({ to: [MICHAEL], cc: [], subject, body: `Body of ${subject}`, replyToMessageId: null }));
      expect(r.status).toBe(202);
    }
    const list = GraphMessageList.parse((await getJson(PATHS.graph.sentMessages)).body);
    expect(list.value.map((m) => m.subject)).toEqual(['First chaser', 'Second chaser']);
    expect(list.value[0]!.toRecipients).toEqual([{ emailAddress: MICHAEL }]);
    // The inbox listing is unchanged.
    expect(GraphMessageList.parse((await getJson(PATHS.graph.messages)).body).value.some((m) => m.subject === 'First chaser')).toBe(false);
  });

  it('sendMail with an invalid body is a 400 and stores nothing', async () => {
    const r = await postJson(PATHS.graph.sendMail, { message: { subject: 'x', body: { contentType: 'text', content: 'y' }, toRecipients: [] } });
    expect(r.status).toBe(400);
    ErrorBody.parse(r.body);
    expect((await getJson(PATHS.control.sent)).body).toEqual([]);
  });
});

describe('fake Graph calendar', () => {
  const view = (s: string, e: string) =>
    `${PATHS.graph.calendarView}?${new URLSearchParams({ startDateTime: s, endDateTime: e })}`;

  it('calendarView returns overlapping events sorted by start', async () => {
    const r = CalEventList.parse((await getJson(view('2026-11-13T11:15:00Z', '2026-11-15T00:00:00Z'))).body);
    expect(r.value.map((e) => e.id)).toEqual(['e-1', 'e-2']);
    const none = CalEventList.parse((await getJson(view('2026-11-13T11:30:00Z', '2026-11-14T15:00:00Z'))).body);
    expect(none.value).toEqual([]);
  });

  it('calendarView needs both bounds', async () => {
    const r = await getJson(`${PATHS.graph.calendarView}?startDateTime=2026-11-13T00:00:00Z`);
    expect(r.status).toBe(400);
    ErrorBody.parse(r.body);
  });

  it('a created event appears in calendarView', async () => {
    const r = await postJson(PATHS.graph.events, {
      subject: 'Lunch',
      start: toGraphDateTime('2026-11-13T12:00:00Z'),
      end: toGraphDateTime('2026-11-13T12:30:00Z'),
      showAs: 'busy',
      categories: ['POC assistant'],
    });
    expect(r.status).toBe(201);
    const created = CalEvent.parse(r.body);
    expect(created.id).toMatch(/^poc-event-/);
    const today = CalEventList.parse((await getJson(view('2026-11-13T00:00:00Z', '2026-11-14T00:00:00Z'))).body);
    expect(today.value.map((e) => e.subject)).toEqual(['Team huddle', 'Lunch']);
    expect(today.value[1]).toEqual(created);
  });

  it('rejects non-UTC times and end before start', async () => {
    const tz = await postJson(PATHS.graph.events, {
      subject: 'Lunch',
      start: { dateTime: '2026-11-13T12:00:00', timeZone: 'Europe/London' },
      end: { dateTime: '2026-11-13T12:30:00', timeZone: 'Europe/London' },
    });
    expect(tz.status).toBe(400);
    const back = await postJson(PATHS.graph.events, {
      subject: 'Backwards',
      start: toGraphDateTime('2026-11-13T13:00:00Z'),
      end: toGraphDateTime('2026-11-13T12:00:00Z'),
    });
    expect(back.status).toBe(400);
    ErrorBody.parse(back.body);
  });
});

describe('fake Zoom chat', () => {
  it('lists all messages oldest first, from is exclusive', async () => {
    const all = ZoomChatMessageList.parse((await getJson(PATHS.zoom.messages)).body);
    expect(all.messages.map((m) => m.id)).toEqual(['c-1', 'c-2']);
    const after = ZoomChatMessageList.parse((await getJson(`${PATHS.zoom.messages}?from=2026-11-12T08:00:00.000Z`)).body);
    expect(after.messages.map((m) => m.id)).toEqual(['c-2']);
    expect(after.from).toBe('2026-11-12T08:00:00.000Z');
  });

  it('a dropped chat message shows up after the cursor', async () => {
    const r = await postJson(PATHS.control.chat, { sender: PRIYA, sender_display_name: 'Priya Shah', message: 'Harbor sent the census file.' });
    expect(r.status).toBe(201);
    const m = ZoomChatMessage.parse(r.body);
    expect(m.to_contact).toBe(PRIYA);
    expect(m.timestamp).toBe(Date.parse(m.date_time));
    expect(Date.parse(m.date_time)).toBeGreaterThan(Date.parse(NOW));
    const list = ZoomChatMessageList.parse((await getJson(`${PATHS.zoom.messages}?from=${encodeURIComponent(NOW)}`)).body);
    expect(list.messages).toEqual([m]);
  });

  it('drops into a channel', async () => {
    const r = await postJson(PATHS.control.chat, {
      sender: PRIYA,
      sender_display_name: 'Priya Shah',
      message: 'Morning all',
      to_channel: 'poc-channel-team-general',
      channel_name: 'team-general',
    });
    const m = ZoomChatMessage.parse(r.body);
    expect(m.to_channel).toBe('poc-channel-team-general');
    expect(m.to_contact).toBeUndefined();
    const both = await postJson(PATHS.control.chat, { sender: PRIYA, sender_display_name: 'P', message: 'x', to_channel: 'c', to_contact: PRIYA });
    expect(both.status).toBe(400);
  });
});

describe('control endpoints', () => {
  it('canned messages match the contract', async () => {
    const r = (await getJson(PATHS.control.canned)).body as unknown[];
    expect(r.map((c) => CannedMessage.parse(c).key)).toEqual(['acme-update-and-meeting']);
  });

  it('reset restores the initial seed state and leaves no temp files', async () => {
    const initial = {
      mail: (await getJson(messagesUrl({ $orderby: 'receivedDateTime asc' }))).body,
      sent: (await getJson(PATHS.control.sent)).body,
      chat: (await getJson(PATHS.zoom.messages)).body,
    };
    await dropMail();
    await postJson(PATHS.control.chat, { sender: PRIYA, sender_display_name: 'Priya Shah', message: 'Hi' });
    await postJson(PATHS.graph.sendMail, draftToSendMail({ to: [MICHAEL], cc: [], subject: 'Hi', body: 'Hello', replyToMessageId: null }));
    await postJson(PATHS.graph.events, { subject: 'Lunch', start: toGraphDateTime('2026-11-13T12:00:00Z'), end: toGraphDateTime('2026-11-13T12:30:00Z') });

    const r = await postJson(PATHS.control.reset);
    expect(r.status).toBe(200);
    ControlResetResponse.parse(r.body);

    expect((await getJson(messagesUrl({ $orderby: 'receivedDateTime asc' }))).body).toEqual(initial.mail);
    expect((await getJson(PATHS.control.sent)).body).toEqual(initial.sent);
    expect((await getJson(PATHS.zoom.messages)).body).toEqual(initial.chat);
    for (const rel of [DATA_LAYOUT.mocksMail, DATA_LAYOUT.mocksSent, DATA_LAYOUT.mocksCalendar, DATA_LAYOUT.mocksChat]) {
      expect(readFileSync(join(dir, rel), 'utf8')).toBe(readFileSync(join(dir, rel.replace('mocks/', 'mocks/initial/')), 'utf8'));
    }
    expect(readdirSync(join(dir, 'mocks')).filter((f) => f.includes('.tmp'))).toEqual([]);
  });

  it('refuses to start without a seed', () => {
    const empty = mkdtempSync(join(tmpdir(), 'poc-mocks-empty-'));
    try {
      expect(() => createApp({ dataDir: empty, tz: 'UTC', now: () => new Date(NOW) })).toThrow(/Run `npm --prefix poc run seed`/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

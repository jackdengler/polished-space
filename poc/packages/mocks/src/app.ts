/**
 * The mocks HTTP handler: fake Microsoft Graph mail and calendar, fake Zoom
 * Team Chat, demo control endpoints and the control page. Plain `node:http`,
 * no framework. Nothing here ever makes an outbound request: "sent" mail only
 * lands in `sent.json`.
 *
 * Graph and Zoom field names follow the contracts (plan section 3.3). They
 * could not be re-checked against the live docs at build time (no network to
 * learn.microsoft.com / developers.zoom.us from the build sandbox).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import {
  CalEvent,
  ControlChatDrop,
  ControlMailDrop,
  GraphMessage,
  GraphSendMailRequest,
  NewCalEvent,
  PATHS,
  ZoomChatMessage,
  eventSpanMs,
  makeBodyPreview,
  type Health,
  type ZoomChatMessageList,
} from '@poc/contracts';
import { Store } from './store';

export interface AppOptions {
  dataDir: string;
  /** The clock (resolveNow(POC_NOW) in production; fixed in tests). */
  now: () => Date;
  tz: string;
}

export const SERVICE_NAME = 'mocks';
const PAGE_URL = new URL('./page.html', import.meta.url);
const MAX_BODY = 1_000_000;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

export function createApp(opts: AppOptions): Handler {
  const store = new Store(opts.dataDir);
  store.assertSeeded();

  /**
   * Timestamp for a dropped item: `given` if it is newer than everything
   * stored, else 1 ms after max(now, newest stored). So a drop is always
   * strictly after every existing item and after "now" (which is also the
   * seed's intake cursor when POC_NOW is fixed), and `gt` cursors never miss it.
   */
  const stampAfter = (existing: string[], given?: string): string => {
    const newest = existing.reduce((m, iso) => Math.max(m, Date.parse(iso)), 0);
    if (given !== undefined && Date.parse(given) > newest) return given;
    return new Date(Math.max(opts.now().getTime(), newest) + 1).toISOString();
  };

  const routes: Route[] = [
    // ---- Fake Graph: mail ----
    get(PATHS.graph.messages, (_req, url) => {
      const items = listMessages(store.read('mail'), url.searchParams);
      return json(200, { value: items });
    }),
    get(PATHS.graph.sentMessages, () => {
      const value = [...store.read('sent')].sort((a, b) => (a.sentDateTime ?? a.receivedDateTime).localeCompare(b.sentDateTime ?? b.receivedDateTime));
      return json(200, { value });
    }),
    get(/^\/v1\.0\/me\/messages\/([^/]+)$/, (_req, _url, [id]) => {
      const found = [...store.read('mail'), ...store.read('sent')].find((m) => m.id === id);
      if (!found) throw new HttpError(404, `message not found: ${id}`);
      return json(200, found);
    }),
    post(PATHS.graph.sendMail, async (req) => {
      const { message } = parse(GraphSendMailRequest, await readJson(req));
      const sent = store.read('sent');
      const me = store.seedInfo().me;
      const at = stampAfter(sent.map((m) => m.receivedDateTime));
      const item: GraphMessage = {
        id: `poc-sent-${randomUUID()}`,
        conversationId: `poc-conv-${randomUUID()}`,
        subject: message.subject,
        from: { emailAddress: { name: me.name, address: me.email } },
        toRecipients: message.toRecipients,
        ccRecipients: message.ccRecipients,
        receivedDateTime: at,
        sentDateTime: at,
        body: message.body,
        bodyPreview: makeBodyPreview(message.body.content),
        isRead: true,
      };
      // Always filed in Sent (saveToSentItems is ignored): the demo needs to see it.
      store.write('sent', [...sent, item]);
      // Graph returns 202 with no body. The extra header lets a client learn the id.
      return { status: 202, headers: { 'x-poc-message-id': item.id } };
    }),

    // ---- Fake Graph: calendar ----
    get(PATHS.graph.calendarView, (_req, url) => {
      const start = requiredInstant(url.searchParams, 'startDateTime');
      const end = requiredInstant(url.searchParams, 'endDateTime');
      const value = store
        .read('calendar')
        .filter((e) => {
          const span = eventSpanMs(e);
          return span.start < end && span.end > start;
        })
        .sort((a, b) => eventSpanMs(a).start - eventSpanMs(b).start);
      return json(200, { value });
    }),
    post(PATHS.graph.events, async (req) => {
      const input = parse(NewCalEvent, await readJson(req));
      if (input.start.timeZone !== 'UTC' || input.end.timeZone !== 'UTC') {
        throw new HttpError(400, 'the mock only accepts timeZone "UTC" (use toGraphDateTime)');
      }
      const event = CalEvent.parse({
        id: `poc-event-${randomUUID()}`,
        subject: input.subject,
        start: input.start,
        end: input.end,
        attendees: input.attendees,
        showAs: input.showAs,
        categories: input.categories,
        bodyPreview: input.body ? makeBodyPreview(input.body.content) : '',
      });
      const span = eventSpanMs(event);
      if (!(span.end > span.start)) throw new HttpError(400, 'end must be after start');
      store.append('calendar', event);
      return json(201, event);
    }),

    // ---- Fake Zoom Team Chat ----
    get(PATHS.zoom.messages, (_req, url) => {
      const from = optionalInstant(url.searchParams, 'from');
      const to = optionalInstant(url.searchParams, 'to');
      const messages = store
        .read('chat')
        .filter((m) => (from === undefined || m.timestamp > from) && (to === undefined || m.timestamp <= to))
        .sort((a, b) => a.timestamp - b.timestamp);
      const body: ZoomChatMessageList = {
        ...(from !== undefined ? { from: new Date(from).toISOString() } : {}),
        ...(to !== undefined ? { to: new Date(to).toISOString() } : {}),
        page_size: messages.length,
        next_page_token: '',
        messages,
      };
      return json(200, body);
    }),

    // ---- Demo controls ----
    get(PATHS.control.health, () => {
      const body: Health & { tz: string } = { ok: true, service: SERVICE_NAME, now: opts.now().toISOString(), tz: opts.tz };
      return json(200, body);
    }),
    post(PATHS.control.mail, async (req) => {
      const drop = parse(ControlMailDrop, await readJson(req));
      const mail = store.read('mail');
      const me = store.seedInfo().me;
      const at = stampAfter(mail.map((m) => m.receivedDateTime), drop.receivedDateTime);
      const item: GraphMessage = GraphMessage.parse({
        id: `poc-mail-${randomUUID()}`,
        conversationId: drop.conversationId ?? `poc-conv-${randomUUID()}`,
        subject: drop.subject,
        from: { emailAddress: drop.from },
        toRecipients: (drop.to ?? [{ name: me.name, address: me.email }]).map((p) => ({ emailAddress: p })),
        ccRecipients: [],
        receivedDateTime: at,
        sentDateTime: at,
        body: { contentType: 'text', content: drop.body },
        bodyPreview: makeBodyPreview(drop.body),
        isRead: false,
      });
      store.write('mail', [...mail, item]);
      return json(201, item);
    }),
    post(PATHS.control.chat, async (req) => {
      const drop = parse(ControlChatDrop, await readJson(req));
      if (drop.to_contact && drop.to_channel) throw new HttpError(400, 'give to_contact or to_channel, not both');
      const chat = store.read('chat');
      const at = stampAfter(chat.map((m) => m.date_time), drop.date_time);
      const target = drop.to_channel
        ? { to_channel: drop.to_channel, ...(drop.channel_name ? { channel_name: drop.channel_name } : {}) }
        : { to_contact: drop.to_contact ?? drop.sender };
      const item = ZoomChatMessage.parse({
        id: `poc-chat-${randomUUID()}`,
        message: drop.message,
        sender: drop.sender,
        sender_display_name: drop.sender_display_name,
        date_time: at,
        timestamp: Date.parse(at),
        ...target,
      });
      store.write('chat', [...chat, item]);
      return json(201, item);
    }),
    post(PATHS.control.reset, () => {
      store.reset();
      return json(200, { ok: true });
    }),
    get(PATHS.control.canned, () => json(200, store.read('canned'))),
    get(PATHS.control.sent, () => json(200, store.read('sent'))),

    // ---- Control page ----
    get('/', () => ({
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      body: readFileSync(PAGE_URL, 'utf8'),
    })),
  ];

  return (req, res) => {
    void handle(routes, req, res);
  };
}

// ---------------------------------------------------------------- routing

interface Reply {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}
type RouteFn = (req: IncomingMessage, url: URL, params: string[]) => Reply | Promise<Reply>;
interface Route {
  method: string;
  match: (path: string) => string[] | null;
  fn: RouteFn;
}

const matcher = (pattern: string | RegExp) => (path: string) => {
  if (typeof pattern === 'string') return path === pattern ? [] : null;
  const m = pattern.exec(path);
  return m ? m.slice(1).map((s) => decodeURIComponent(s)) : null;
};
const get = (pattern: string | RegExp, fn: RouteFn): Route => ({ method: 'GET', match: matcher(pattern), fn });
const post = (pattern: string | RegExp, fn: RouteFn): Route => ({ method: 'POST', match: matcher(pattern), fn });

async function handle(routes: Route[], req: IncomingMessage, res: ServerResponse): Promise<void> {
  let reply: Reply;
  try {
    const url = new URL(req.url ?? '/', 'http://mocks.local');
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname;
    const method = req.method === 'HEAD' ? 'GET' : (req.method ?? 'GET');
    const hits = routes.map((r) => ({ r, params: r.match(path) })).filter((h) => h.params !== null);
    const hit = hits.find((h) => h.r.method === method);
    if (hit) reply = await hit.r.fn(req, url, hit.params!);
    else if (hits.length) reply = json(405, { error: `method ${req.method} not allowed on ${path}` });
    else reply = json(404, { error: `no route: ${req.method} ${path}` });
  } catch (err) {
    if (err instanceof HttpError) reply = json(err.status, { error: err.message });
    else {
      console.error('mocks: unexpected error', err);
      reply = json(500, { error: err instanceof Error ? err.message : String(err) });
    }
  }
  res.writeHead(reply.status, reply.headers);
  res.end(req.method === 'HEAD' ? undefined : reply.body);
}

function json(status: number, value: unknown): Reply {
  return { status, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(value) };
}

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, `invalid body: ${z.prettifyError(r.error)}`);
  return r.data;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'body too large');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) throw new HttpError(400, 'expected a JSON body');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'body is not valid JSON');
  }
}

// ---------------------------------------------------------------- query helpers

/**
 * A `+` written unencoded in a query string (e.g. by hand in curl) arrives as
 * a space: `2026-11-13T09:00:00 01:00`. Put it back before parsing.
 */
const fixPlus = (s: string) => s.trim().replace(/^(\d{4}-\d{2}-\d{2}T[\d:.]+) (\d{2}:?\d{2})$/, '$1+$2');

function instant(raw: string, name: string): number {
  const value = fixPlus(raw).replace(/^'(.*)'$/, '$1');
  // Graph also accepts a datetime with no offset (treated as UTC).
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  const ms = Date.parse(iso);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(ms)) throw new HttpError(400, `${name} is not an ISO date-time: ${raw}`);
  return ms;
}

function requiredInstant(q: URLSearchParams, name: string): number {
  const raw = q.get(name);
  if (!raw) throw new HttpError(400, `${name} is required`);
  return instant(raw, name);
}

function optionalInstant(q: URLSearchParams, name: string): number | undefined {
  const raw = q.get(name);
  if (!raw) return undefined;
  return instant(raw, name);
}

const COMPARE = {
  gt: (a: number, b: number) => a > b,
  ge: (a: number, b: number) => a >= b,
  lt: (a: number, b: number) => a < b,
  le: (a: number, b: number) => a <= b,
} as const;

/**
 * Graph-style list: `$filter` on receivedDateTime (gt/ge/lt/le, joined by
 * `and`), `$orderby=receivedDateTime [asc|desc]` (default desc, like Graph),
 * `$top`. Returns every match (no paging) unless `$top` is given.
 */
function listMessages(all: GraphMessage[], q: URLSearchParams): GraphMessage[] {
  let items = all;
  const filter = q.get('$filter');
  if (filter) {
    for (const clause of filter.split(/\s+and\s+/i)) {
      const m = /^\s*receivedDateTime\s+(gt|ge|lt|le)\s+(.+?)\s*$/i.exec(clause);
      if (!m) throw new HttpError(400, `unsupported $filter (only receivedDateTime gt|ge|lt|le <iso>): ${clause}`);
      const op = COMPARE[m[1]!.toLowerCase() as keyof typeof COMPARE];
      const at = instant(m[2]!, '$filter');
      items = items.filter((x) => op(Date.parse(x.receivedDateTime), at));
    }
  }
  const orderby = (q.get('$orderby') ?? 'receivedDateTime desc').trim();
  const om = /^receivedDateTime(?:\s+(asc|desc))?$/i.exec(orderby);
  if (!om) throw new HttpError(400, `unsupported $orderby (only receivedDateTime [asc|desc]): ${orderby}`);
  const dir = (om[1] ?? 'asc').toLowerCase() === 'desc' ? -1 : 1;
  items = [...items].sort((a, b) => dir * (Date.parse(a.receivedDateTime) - Date.parse(b.receivedDateTime)));
  const top = q.get('$top');
  if (top !== null) {
    const n = Number(top);
    if (!Number.isInteger(n) || n < 1) throw new HttpError(400, `$top must be a positive integer: ${top}`);
    items = items.slice(0, n);
  }
  return items;
}

/** Tiny fetch helpers for the connector clients. */

/** Which fake (later: real) service a URL belongs to, in words a person understands. */
export function serviceName(url: string): string {
  const path = (() => {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  })();
  if (/\/events|\/calendarView/.test(path)) return 'the calendar service';
  if (/\/messages|\/sendMail|\/mailFolders/.test(path)) return 'the mail service';
  if (/\/chat\//.test(path)) return 'the chat service';
  if (/\/files/.test(path)) return 'the file server';
  return 'a connected service';
}

/**
 * A 4xx/5xx from a connector. The message is for people (it ends up on a
 * failed card): the service's own `{ error }` sentence when it sent one, never
 * a URL or raw JSON. `status`, `url` and `body` stay available for logs.
 */
export class HttpError extends Error {
  override name = 'HttpError';
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    let said: string | null = null;
    try {
      const j = JSON.parse(body) as { error?: unknown };
      if (typeof j.error === 'string') said = j.error;
    } catch {
      /* not JSON */
    }
    const who = serviceName(url);
    super(said ? `${who.charAt(0).toUpperCase()}${who.slice(1)} said: ${said.replace(/\.?$/, '.')}` : `${who.charAt(0).toUpperCase()}${who.slice(1)} answered with an error (${status}).`);
  }
}

export interface HttpOptions {
  method?: string;
  body?: unknown;
  timeoutMs?: number;
}

export async function http(url: string, opts: HttpOptions = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: opts.body !== undefined ? { 'content-type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
  } catch (err) {
    const cause = (err as { cause?: { code?: string; message?: string } }).cause;
    const who = serviceName(url);
    throw new Error(`${who.charAt(0).toUpperCase()}${who.slice(1)} is not answering (${cause?.code ?? cause?.message ?? (err as Error).message}).`);
  }
  if (!res.ok) throw new HttpError(res.status, url, await res.text().catch(() => ''));
  return res;
}

export async function httpJson(url: string, opts: HttpOptions = {}): Promise<unknown> {
  const res = await http(url, opts);
  return res.json();
}

/** Join a base URL and a path, keeping any path prefix on the base. */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`;
}

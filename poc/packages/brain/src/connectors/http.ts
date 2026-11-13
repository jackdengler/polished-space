/** Tiny fetch helpers for the connector clients. */

export class HttpError extends Error {
  override name = 'HttpError';
  constructor(
    readonly status: number,
    readonly url: string,
    body: string,
  ) {
    super(`${status} from ${url}${body ? `: ${body.slice(0, 300)}` : ''}`);
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
    throw new Error(`could not reach ${new URL(url).origin}: ${cause?.code ?? cause?.message ?? (err as Error).message}`);
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

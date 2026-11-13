import { parseWorkspace, type Workspace } from '../model/schema';
import { ConflictError, type StorageAdapter } from './adapter';

/**
 * Reads/writes the workspace through a small HTTP API on the same origin
 * (the POC sandbox's pm-server, opened with `?storage=server`):
 *
 *   GET  /api/workspace          → { rev, workspace }
 *   PUT  /api/workspace          If-Match: <rev>, body { workspace } → { rev }, or 409
 *   GET  /api/events             server-sent events: { rev } on every change
 *   GET|PUT /api/logos/<name>    logo image bytes
 *   GET|PUT /api/personal/<id>   one person's JSON (null = none yet)
 */
export class ServerAdapter implements StorageAdapter {
  readonly kind = 'server' as const;
  readonly name = 'POC sandbox (test data)';
  /** rev of the server's workspace when we last read or wrote it. */
  private rev: number | null = null;
  /** The save in flight, so a change notice for our own write isn't mistaken for someone else's. */
  private saving: Promise<unknown> = Promise.resolve();

  constructor(private base = '/api') {}

  async load(): Promise<Workspace | null> {
    const res = await fetch(`${this.base}/workspace`, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`The server couldn't load the workspace (${res.status}).`);
    const body = (await res.json()) as { rev: number; workspace: unknown };
    this.rev = body.rev;
    return parseWorkspace(body.workspace);
  }

  save(ws: Workspace, opts: { force?: boolean } = {}): Promise<void> {
    const run = (async () => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (!opts.force && this.rev !== null) headers['If-Match'] = String(this.rev);
      const res = await fetch(`${this.base}/workspace`, { method: 'PUT', headers, body: JSON.stringify({ workspace: ws }) });
      if (res.status === 409) throw new ConflictError();
      if (!res.ok) throw new Error(await errorText(res));
      this.rev = ((await res.json()) as { rev: number }).rev;
    })();
    this.saving = run.catch(() => undefined);
    return run;
  }

  async writeLogo(clientId: string, image: Blob): Promise<string> {
    const name = `${clientId}-${Date.now()}.png`;
    const res = await fetch(`${this.base}/logos/${encodeURIComponent(name)}`, { method: 'PUT', headers: { 'Content-Type': image.type || 'image/png' }, body: image });
    if (!res.ok) throw new Error(await errorText(res));
    return name;
  }

  async readLogo(name: string): Promise<Blob | null> {
    const res = await fetch(`${this.base}/logos/${encodeURIComponent(name)}`);
    return res.ok ? res.blob() : null;
  }

  async loadPersonal(personId: string): Promise<unknown | null> {
    const res = await fetch(`${this.base}/personal/${encodeURIComponent(personId)}`, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await errorText(res));
    return res.json();
  }

  async savePersonal(personId: string, data: unknown): Promise<void> {
    const res = await fetch(`${this.base}/personal/${encodeURIComponent(personId)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!res.ok) throw new Error(await errorText(res));
  }

  /** Calls `onChange` when the server's rev moves past ours (someone else wrote). Revs only grow. */
  watch(onChange: () => void): () => void {
    const events = new EventSource(`${this.base}/events`);
    events.onmessage = (e) => {
      const { rev } = JSON.parse(e.data as string) as { rev: number };
      void this.saving.then(() => { if (this.rev !== null && rev > this.rev) onChange(); });
    };
    return () => events.close();
  }
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch { /* not JSON */ }
  return `The server refused the change (${res.status}).`;
}

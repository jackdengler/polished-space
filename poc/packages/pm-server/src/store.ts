/**
 * The one owner of the test copy's `workspace.json`. Every read and write
 * goes through one in-process queue: (re)load → change a copy → validate with
 * Planr's own parseWorkspace → atomic write (temp file, then rename) → rev + 1
 * → notify listeners (SSE).
 */
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SANDBOX_MARKER } from '@poc/contracts';
import { parseWorkspace, type Workspace } from '../../../../src/model/schema';

export const WORKSPACE_FILE = 'workspace.json';

/** The caller's rev is stale: someone else wrote since. */
export class RevConflict extends Error {
  constructor(readonly rev: number) {
    super('The workspace changed since you loaded it.');
  }
}

/** A request that cannot be applied (bad input, unknown id). */
export class BadRequest extends Error {}

/** Throws unless `pmDir` holds the sandbox marker. The guard against ever pointing this at live data. */
export function assertSandbox(pmDir: string): void {
  if (!existsSync(join(pmDir, SANDBOX_MARKER))) {
    throw new Error(`Refusing to start: ${join(pmDir, SANDBOX_MARKER)} is missing. pm-server only runs on POC sandbox data (run the seed first).`);
  }
}

let tmpCounter = 0;
/** Write via a temp file in the same folder, then rename, so readers never see half a file. */
export async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${++tmpCounter}`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

type Listener = (rev: number) => void;

export class WorkspaceStore {
  private ws!: Workspace;
  /** Grows by one per change. Starts at the boot time so it keeps growing across restarts. */
  private rev = Date.now();
  /** mtime and size of the file as we last read or wrote it, to notice outside edits (e.g. a re-seed). */
  private fileStamp = '';
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<Listener>();

  private constructor(readonly pmDir: string) {}

  get file() { return join(this.pmDir, WORKSPACE_FILE); }

  /** Checks the marker, then loads and validates the workspace. */
  static async open(pmDir: string): Promise<WorkspaceStore> {
    assertSandbox(pmDir);
    const store = new WorkspaceStore(pmDir);
    await store.reload();
    return store;
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get currentRev() { return this.rev; }

  /** The current workspace (a private copy) and its rev. */
  read(): Promise<{ rev: number; workspace: Workspace }> {
    return this.enqueue(async () => {
      await this.refresh();
      return { rev: this.rev, workspace: structuredClone(this.ws) };
    });
  }

  /**
   * Apply `change` to a copy of the workspace and save it. `change` may throw
   * (nothing is saved). With `ifMatch`, a stale rev throws RevConflict.
   */
  update<T>(change: (ws: Workspace) => T, opts: { ifMatch?: number } = {}): Promise<{ rev: number; result: T }> {
    return this.enqueue(async () => {
      await this.refresh();
      if (opts.ifMatch !== undefined && opts.ifMatch !== this.rev) throw new RevConflict(this.rev);
      const draft = structuredClone(this.ws);
      const result = change(draft);
      const next = parseWorkspace(draft);
      await this.write(next);
      return { rev: this.rev, result };
    });
  }

  /** Replace the whole workspace (Planr's save). The data is validated first. */
  replace(data: unknown, opts: { ifMatch?: number } = {}): Promise<{ rev: number }> {
    let next: Workspace;
    try {
      next = parseWorkspace(data);
    } catch (e) {
      return Promise.reject(new BadRequest((e as Error).message));
    }
    return this.enqueue(async () => {
      await this.refresh();
      if (opts.ifMatch !== undefined && opts.ifMatch !== this.rev) throw new RevConflict(this.rev);
      await this.write(next);
      return { rev: this.rev };
    });
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async stampOf(): Promise<string> {
    const s = await stat(this.file);
    return `${s.mtimeMs}:${s.size}`;
  }

  /** Re-read the file if something outside this process changed it. */
  private async refresh(): Promise<void> {
    if ((await this.stampOf()) !== this.fileStamp) {
      await this.reload();
      this.bump();
    }
  }

  private async reload(): Promise<void> {
    const text = await readFile(this.file, 'utf8');
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`${this.file} is not valid JSON.`);
    }
    this.ws = parseWorkspace(data);
    this.fileStamp = await this.stampOf();
  }

  private async write(next: Workspace): Promise<void> {
    await mkdir(this.pmDir, { recursive: true });
    await writeAtomic(this.file, JSON.stringify(next, null, 2) + '\n');
    this.ws = next;
    this.fileStamp = await this.stampOf();
    this.bump();
  }

  private bump() {
    this.rev += 1;
    for (const fn of this.listeners) fn(this.rev);
  }
}

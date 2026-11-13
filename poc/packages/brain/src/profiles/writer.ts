/**
 * The write side of the profile files (the core's `ctx.profiles` only reads).
 * Every update re-reads the file, applies edits in code (edit.ts), and writes
 * it back atomically (temp file in the same folder, then rename), one update
 * per file at a time so concurrent edits never lose each other's changes.
 * Profiles are the assistant's own notes: nothing here touches an outside system.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Clock } from '../config';
import type { ProfileFiles } from '../profileFiles';
import { applyProfileEdits, type EditOutcome } from './edit';

export async function writeFileAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, path);
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function mtimeIso(path: string): Promise<string | null> {
  try {
    return (await stat(path)).mtime.toISOString();
  } catch {
    return null;
  }
}

export class ProfileWriter {
  private chains = new Map<string, Promise<unknown>>();

  constructor(
    private files: ProfileFiles,
    private clock: Clock,
  ) {}

  /** Run `fn` with the file to itself (in this process). */
  private exclusive<T>(path: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(path) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => {});
    this.chains.set(path, tail);
    void tail.then(() => {
      if (this.chains.get(path) === tail) this.chains.delete(path);
    });
    return next;
  }

  /** Apply edits to one client's profile; creates the file if there is none yet. */
  apply(clientName: string, edits: unknown[], sourceLabel: string): Promise<EditOutcome> {
    const path = this.files.pathFor(clientName);
    return this.exclusive(path, async () => {
      const current = await readOrNull(path);
      const out = applyProfileEdits(current, edits, { clientName, at: this.clock.now().toISOString(), sourceLabel });
      if (out.changed) await writeFileAtomic(path, out.markdown);
      return out;
    });
  }
}

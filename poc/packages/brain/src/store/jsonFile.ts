/**
 * Small JSON file helpers: atomic writes (temp file + rename) and a
 * one-writer-at-a-time queue per file, so state survives a crash mid-write
 * and concurrent saves never interleave.
 */
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw new Error(`could not read ${path}: ${(err as Error).message}`);
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(tmp, path);
}

export async function appendLine(path: string, line: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${line}\n`);
}

/** Serialises saves of one file. `save(value)` resolves once that value (or a later one) is on disk. */
export class JsonFile<T> {
  private chain: Promise<void> = Promise.resolve();

  constructor(readonly path: string) {}

  load(fallback: T): Promise<T> {
    return readJson(this.path, fallback);
  }

  save(value: T): Promise<void> {
    const snapshot = structuredClone(value);
    const next = this.chain.then(() => writeJsonAtomic(this.path, snapshot));
    this.chain = next.catch(() => {});
    return next;
  }
}

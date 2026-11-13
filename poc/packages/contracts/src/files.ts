import { z } from 'zod';
import { IsoDateTime } from './common';

/**
 * Fake file server (`poc/data/files/<Client Folder>/...`). Paths are POSIX,
 * relative to the files root, e.g. `Acme Tooling/benchmark_matches.csv`.
 * `folder` is the client's top-level folder (Planr client `fileFolder`).
 * Only these four types exist in the POC (plan question 10).
 */

export const FileMimeType = z.enum(['text/plain', 'text/markdown', 'text/csv', 'application/pdf']);
export type FileMimeType = z.infer<typeof FileMimeType>;

export const FileInfo = z.object({
  path: z.string().min(1).refine((p) => !p.startsWith('/') && !p.split('/').includes('..'), 'relative path without ..'),
  name: z.string().min(1),
  folder: z.string().min(1),
  size: z.number().int().nonnegative(),
  modified: IsoDateTime,
  mimeType: FileMimeType,
});
export type FileInfo = z.infer<typeof FileInfo>;

/** File contents. Text types are `utf8`; PDFs are `base64` (ready for a Claude document block). */
export const FileContent = FileInfo.extend({
  encoding: z.enum(['utf8', 'base64']),
  content: z.string(),
});
export type FileContent = z.infer<typeof FileContent>;

const BY_EXT: Record<string, FileMimeType> = { '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.pdf': 'application/pdf' };

/** Mime type from a file name, or null for types the POC does not support. */
export function mimeTypeFor(name: string): FileMimeType | null {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? null : BY_EXT[name.slice(dot).toLowerCase()] ?? null;
}

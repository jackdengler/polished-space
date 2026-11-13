/**
 * FilesConnector over the fake file server folder (`data/files`). Read only.
 * V1 swaps this for a local indexer that respects folder permissions.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { mimeTypeFor, type FileContent, type FileInfo, type FilesConnector } from '@poc/contracts';

export class LocalFilesConnector implements FilesConnector {
  private root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private safe(rel: string): string {
    if (!rel || rel.startsWith('/') || rel.split('/').includes('..') || rel.includes('\\')) throw new Error(`path outside files root: ${rel}`);
    const abs = resolve(this.root, rel);
    if (abs !== this.root && !abs.startsWith(this.root + sep)) throw new Error(`path outside files root: ${rel}`);
    return abs;
  }

  private async info(abs: string): Promise<FileInfo | null> {
    const rel = relative(this.root, abs).split(sep).join('/');
    const name = rel.split('/').pop()!;
    const mimeType = mimeTypeFor(name);
    if (!mimeType) return null;
    const st = await stat(abs);
    return { path: rel, name, folder: rel.split('/')[0]!, size: st.size, modified: st.mtime.toISOString(), mimeType };
  }

  async list(folder: string): Promise<FileInfo[]> {
    let dir: string;
    try {
      dir = this.safe(folder);
    } catch {
      return [];
    }
    const out: FileInfo[] = [];
    const walk = async (d: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const abs = join(d, e.name);
        if (e.isDirectory()) await walk(abs);
        else if (e.isFile()) {
          const i = await this.info(abs);
          if (i) out.push(i);
        }
      }
    };
    await walk(dir);
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  async read(path: string): Promise<FileContent> {
    const abs = this.safe(path);
    const info = await this.info(abs);
    if (!info) throw new Error(`unsupported file type: ${path}`);
    const buf = await readFile(abs);
    return info.mimeType === 'application/pdf'
      ? { ...info, encoding: 'base64', content: buf.toString('base64') }
      : { ...info, encoding: 'utf8', content: buf.toString('utf8') };
  }
}

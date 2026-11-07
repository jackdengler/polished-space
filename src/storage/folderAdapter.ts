import { parseWorkspace, type Workspace } from '../model/schema';
import { ConflictError, type StorageAdapter } from './adapter';

const DATA_FILE = 'workspace.json';
const LOGO_DIR = 'logos';
const BACKUP_DIR = 'backups';
const BACKUP_EVERY_MS = 5 * 60_000;
const BACKUPS_KEPT = 20;

/**
 * Reads/writes a workspace folder on this computer via the File System Access API:
 *
 *   my-workspace/
 *     workspace.json
 *     logos/<file>.png
 *     backups/workspace-YYYYMMDD-HHMMSS.json   (last 20)
 *
 * Works the same on the Origin Private File System (used by the automated tests).
 */
export class FolderAdapter implements StorageAdapter {
  readonly kind = 'folder' as const;
  /** lastModified of workspace.json when we last read or wrote it. */
  private knownModified: number | null = null;
  private lastBackupAt = 0;

  constructor(private dir: FileSystemDirectoryHandle) {}

  get name() { return this.dir.name || 'Workspace'; }

  private async dataFile(create = false) {
    try {
      return await this.dir.getFileHandle(DATA_FILE, { create });
    } catch (e) {
      if (!create && (e as DOMException).name === 'NotFoundError') return null;
      throw e;
    }
  }

  async load(): Promise<Workspace | null> {
    const handle = await this.dataFile();
    if (!handle) return null;
    const file = await handle.getFile();
    this.knownModified = file.lastModified;
    const text = await file.text();
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('workspace.json is not valid JSON. Restore a copy from the backups folder.');
    }
    return parseWorkspace(data);
  }

  async save(ws: Workspace, opts: { force?: boolean } = {}): Promise<void> {
    const handle = (await this.dataFile(true))!;
    const current = await handle.getFile();
    const exists = current.size > 0;
    if (!opts.force && exists && this.knownModified !== null && current.lastModified !== this.knownModified) {
      throw new ConflictError();
    }
    if (exists && Date.now() - this.lastBackupAt > BACKUP_EVERY_MS) {
      await this.backup(await current.text());
    }
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(ws, null, 2) + '\n');
    await writable.close();
    this.knownModified = (await handle.getFile()).lastModified;
  }

  private async backup(text: string) {
    this.lastBackupAt = Date.now();
    try {
      const dir = await this.dir.getDirectoryHandle(BACKUP_DIR, { create: true });
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      const name = `workspace-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.json`;
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await w.write(text);
      await w.close();
      const names: string[] = [];
      for await (const key of dir.keys()) if (/^workspace-\d{8}-\d{6}\.json$/.test(key)) names.push(key);
      names.sort();
      for (const old of names.slice(0, Math.max(0, names.length - BACKUPS_KEPT))) await dir.removeEntry(old);
    } catch (e) {
      console.warn('Backup failed (the save itself continues):', e);
    }
  }

  async writeLogo(clientId: string, image: Blob): Promise<string> {
    const dir = await this.dir.getDirectoryHandle(LOGO_DIR, { create: true });
    const name = `${clientId}-${Date.now()}.png`;
    const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await w.write(image);
    await w.close();
    return name;
  }

  async readLogo(name: string): Promise<Blob | null> {
    try {
      const dir = await this.dir.getDirectoryHandle(LOGO_DIR);
      return await (await dir.getFileHandle(name)).getFile();
    } catch {
      return null;
    }
  }
}

import type { Workspace } from '../model/schema';

/**
 * Where the workspace lives. v1: a folder on this computer (FolderAdapter) or
 * memory (demo). Later: a ServerAdapter talking to the company server — the
 * rest of the app doesn't change.
 */
export interface StorageAdapter {
  readonly kind: 'folder' | 'memory';
  /** Shown in the UI, e.g. the folder name. */
  readonly name: string;
  /** null when the location has no workspace yet. Throws if the data is unreadable. */
  load(): Promise<Workspace | null>;
  /** Throws ConflictError if the data changed outside the app since the last load/save (unless force). */
  save(ws: Workspace, opts?: { force?: boolean }): Promise<void>;
  /** Store a logo image; returns the file name to keep on the client. */
  writeLogo(clientId: string, image: Blob): Promise<string>;
  readLogo(fileName: string): Promise<Blob | null>;
  /** Personal data for one person (e.g. their time entries), kept apart from the shared workspace. */
  loadPersonal(personId: string): Promise<unknown | null>;
  savePersonal(personId: string, data: unknown): Promise<void>;
}

export class ConflictError extends Error {
  constructor() {
    super('workspace.json was changed outside the app since it was opened.');
    this.name = 'ConflictError';
  }
}

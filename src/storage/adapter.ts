import type { Workspace } from '../model/schema';

/**
 * Where the workspace lives. v1: a folder on this computer (FolderAdapter) or
 * memory (demo), or a server (ServerAdapter, used by the POC sandbox's test copy).
 * The rest of the app doesn't change.
 */
export interface StorageAdapter {
  readonly kind: 'folder' | 'memory' | 'server';
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
  /** Optional: call `onChange` when the workspace changes outside this app. Returns an unsubscribe function. */
  watch?(onChange: () => void): () => void;
}

export class ConflictError extends Error {
  constructor() {
    super('workspace.json was changed outside the app since it was opened.');
    this.name = 'ConflictError';
  }
}

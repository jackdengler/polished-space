import { parseWorkspace, type Workspace } from '../model/schema';
import type { StorageAdapter } from './adapter';
import { blobToDataUrl, dataUrlToBlob } from './blobs';

/**
 * Keeps the workspace in memory. Given a key, it also keeps a copy (and the
 * logos) in this browser's localStorage, so it survives a reload. Used where a
 * folder isn't available, e.g. the hosted preview.
 */
export class MemoryAdapter implements StorageAdapter {
  readonly kind = 'memory' as const;
  readonly name = 'This browser';
  private logos = new Map<string, Blob>();
  /** `builtInLogos`: logo data URLs shipped with the page (file name → data URL). */
  constructor(private ws: Workspace | null = null, private storageKey?: string, private builtInLogos: Record<string, string> = {}) {}

  async load() { return this.ws; }

  async save(ws: Workspace) {
    this.ws = ws;
    if (this.storageKey) store(this.storageKey, JSON.stringify(ws));
  }

  async writeLogo(clientId: string, image: Blob) {
    const name = `${clientId}-${Date.now()}.png`;
    this.logos.set(name, image);
    if (this.storageKey) store(`${this.storageKey}:logo:${name}`, await blobToDataUrl(image));
    return name;
  }

  private personal = new Map<string, unknown>();
  async loadPersonal(personId: string) {
    if (this.personal.has(personId)) return this.personal.get(personId)!;
    if (!this.storageKey) return null;
    try { const t = localStorage.getItem(`${this.storageKey}:personal:${personId}`); return t ? JSON.parse(t) : null; } catch { return null; }
  }
  async savePersonal(personId: string, data: unknown) {
    this.personal.set(personId, data);
    if (this.storageKey) store(`${this.storageKey}:personal:${personId}`, JSON.stringify(data));
  }

  async readLogo(name: string) {
    const hit = this.logos.get(name);
    if (hit) return hit;
    let url: string | null | undefined = this.builtInLogos[name];
    if (!url && this.storageKey) {
      try { url = localStorage.getItem(`${this.storageKey}:logo:${name}`); } catch { url = null; }
    }
    return url ? dataUrlToBlob(url) : null;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    throw new Error("This browser's storage is full or turned off, so changes can't be kept after a reload.");
  }
}

/** The copy saved in this browser, if any. */
export function loadSavedBrowserWorkspace(key: string): Workspace | null {
  try {
    const text = localStorage.getItem(key);
    return text ? parseWorkspace(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

/** Erase the saved copy and its logos. */
export function clearSavedBrowserWorkspace(key: string) {
  try {
    for (const k of Object.keys(localStorage)) if (k === key || k.startsWith(`${key}:logo:`) || k.startsWith(`${key}:personal:`)) localStorage.removeItem(k);
  } catch { /* nothing to clear */ }
}

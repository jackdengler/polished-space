import { parseWorkspace, type Workspace } from '../model/schema';
import type { StorageAdapter } from './adapter';

/**
 * Keeps the workspace in memory — used for the demo. When given a key, it also
 * keeps a copy in this browser's localStorage so the demo survives a reload
 * (logos stay in memory only).
 */
export class MemoryAdapter implements StorageAdapter {
  readonly kind = 'memory' as const;
  readonly name = 'Demo';
  private logos = new Map<string, Blob>();
  constructor(private ws: Workspace | null = null, private storageKey?: string) {}

  async load() { return this.ws; }
  async save(ws: Workspace) {
    this.ws = ws;
    if (this.storageKey) {
      try { localStorage.setItem(this.storageKey, JSON.stringify(ws)); } catch { /* storage unavailable — memory only */ }
    }
  }
  async writeLogo(clientId: string, image: Blob) {
    const name = `${clientId}-${Date.now()}.png`;
    this.logos.set(name, image);
    return name;
  }
  async readLogo(name: string) { return this.logos.get(name) ?? null; }
}

/** The demo copy saved in this browser, if any. */
export function loadSavedDemo(key: string): Workspace | null {
  try {
    const text = localStorage.getItem(key);
    return text ? parseWorkspace(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

export function clearSavedDemo(key: string) {
  try { localStorage.removeItem(key); } catch { /* nothing to clear */ }
}

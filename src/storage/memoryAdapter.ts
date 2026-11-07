import type { Workspace } from '../model/schema';
import type { StorageAdapter } from './adapter';

/** Keeps everything in memory — used for the demo and tests. Nothing is saved. */
export class MemoryAdapter implements StorageAdapter {
  readonly kind = 'memory' as const;
  readonly name = 'Demo';
  private logos = new Map<string, Blob>();
  constructor(private ws: Workspace | null = null) {}

  async load() { return this.ws; }
  async save(ws: Workspace) { this.ws = ws; }
  async writeLogo(clientId: string, image: Blob) {
    const name = `${clientId}-${Date.now()}.png`;
    this.logos.set(name, image);
    return name;
  }
  async readLogo(name: string) { return this.logos.get(name) ?? null; }
}

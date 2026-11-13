/**
 * Intake cursors and processed ids (`data/brain/cursors.json`). An item is
 * marked processed only after its suggestions are stored, so a crash never
 * drops a message; a processed id or content fingerprint is never triaged again.
 */
import { JsonFile } from './jsonFile';

export type IntakeSource = 'mail' | 'chat';

interface CursorFile {
  cursors: Partial<Record<IntakeSource, string>>;
  /** `mail:<id>` / `chat:<id>`, newest last. */
  processed: string[];
  /** Content fingerprints of processed items (catches the same message dropped in again under a new id). */
  fingerprints: string[];
}

const KEEP = 5000;

export class CursorStore {
  private data: CursorFile = { cursors: {}, processed: [], fingerprints: [] };
  private processed = new Set<string>();
  private prints = new Set<string>();
  private file: JsonFile<CursorFile>;

  constructor(path: string) {
    this.file = new JsonFile(path);
  }

  async load(): Promise<void> {
    const raw = await this.file.load(this.data);
    this.data = { cursors: raw.cursors ?? {}, processed: raw.processed ?? [], fingerprints: raw.fingerprints ?? [] };
    this.processed = new Set(this.data.processed);
    this.prints = new Set(this.data.fingerprints);
  }

  cursor(source: IntakeSource): string | null {
    return this.data.cursors[source] ?? null;
  }

  isProcessed(source: IntakeSource, id: string): boolean {
    return this.processed.has(`${source}:${id}`);
  }

  hasFingerprint(fp: string): boolean {
    return this.prints.has(fp);
  }

  /** Record one item as done and move the cursor past it. */
  async markProcessed(source: IntakeSource, id: string, fingerprint: string | null, cursor: string | null): Promise<void> {
    const key = `${source}:${id}`;
    if (!this.processed.has(key)) {
      this.processed.add(key);
      this.data.processed.push(key);
    }
    if (fingerprint && !this.prints.has(fingerprint)) {
      this.prints.add(fingerprint);
      this.data.fingerprints.push(fingerprint);
    }
    if (cursor) this.data.cursors[source] = cursor;
    this.trim();
    await this.file.save(this.data);
  }

  async setCursor(source: IntakeSource, cursor: string): Promise<void> {
    this.data.cursors[source] = cursor;
    await this.file.save(this.data);
  }

  private trim() {
    if (this.data.processed.length > KEEP) {
      for (const k of this.data.processed.splice(0, this.data.processed.length - KEEP)) this.processed.delete(k);
    }
    if (this.data.fingerprints.length > KEEP) {
      for (const k of this.data.fingerprints.splice(0, this.data.fingerprints.length - KEEP)) this.prints.delete(k);
    }
  }
}

/**
 * Read-only access to client profile files (`data/profiles/<slug>.md`).
 * Core uses it for the triage prompt and for learned shorthand in the
 * pre-match. Writing profiles belongs to the profiles module (Phase 2C).
 * Files are re-read every time, so hand edits are always respected.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseProfile, profileSlug } from '@poc/contracts';

export class ProfileFiles {
  constructor(readonly dir: string) {}

  pathFor(clientName: string): string {
    return join(this.dir, `${profileSlug(clientName)}.md`);
  }

  async read(clientName: string): Promise<string | null> {
    try {
      return await readFile(this.pathFor(clientName), 'utf8');
    } catch {
      return null;
    }
  }

  /** Bullets under "Also known as" (learned shorthand), without placeholders. */
  async aliases(clientName: string): Promise<string[]> {
    const md = await this.read(clientName);
    if (!md) return [];
    const body = parseProfile(md).sections['Also known as'] ?? '';
    return body
      .split('\n')
      .map((l) => l.replace(/^\s*[-*]\s*/, '').trim())
      .filter((l) => l && l !== '(none yet)')
      .map((l) => l.replace(/^["“]|["”]$/g, ''));
  }
}

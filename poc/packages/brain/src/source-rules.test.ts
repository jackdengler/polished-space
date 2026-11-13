/**
 * Grep-style guards over the brain's own source (all of src/, including the
 * Phase 2 module folders, so they hold for future code too):
 * - never pm-server's storage API (only its MCP endpoint);
 * - only claude.ts imports the Anthropic SDK;
 * - only models.ts names Claude models;
 * - no API key material anywhere.
 */
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = dirname(fileURLToPath(import.meta.url));

async function sources(): Promise<{ path: string; text: string }[]> {
  const out: { path: string; text: string }[] = [];
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith('.ts')) out.push({ path: relative(SRC, p), text: await readFile(p, 'utf8') });
    }
  };
  await walk(SRC);
  return out;
}

const isTest = (p: string) => p.endsWith('.test.ts');

describe('brain source rules', () => {
  it("never references pm-server's storage API", async () => {
    const banned = [/\/api\/workspace/, /\/api\/personal/, /\/api\/logos/, /PATHS\.pm\.(workspace|events|logo|personal|health)/, /PORTS\.pmApp/, /DEFAULT_URLS\.pmApp/, /pmApp/, /:8080\b/, /workspace\.json/, /DATA_LAYOUT\.pm(Workspace|Marker)/];
    for (const f of await sources()) {
      if (f.path === 'source-rules.test.ts') continue;
      for (const re of banned) expect(re.test(f.text), `${f.path} matches ${re}`).toBe(false);
    }
  });

  it('only claude.ts imports the Anthropic SDK (tests may use its helpers)', async () => {
    for (const f of await sources()) {
      if (f.path === 'claude.ts' || isTest(f.path)) continue;
      const imports = [...f.text.matchAll(/from\s+['"](@anthropic-ai\/sdk[^'"]*)['"]/g)];
      const valueImports = imports.filter((m) => !new RegExp(`import\\s+type[^;]*${m[1]!.replace(/[/.]/g, '\\$&')}`).test(f.text));
      expect(valueImports.map((m) => m[1]), f.path).toEqual([]);
    }
  });

  it('only models.ts names Claude models', async () => {
    const re = /claude-(?:sonnet|opus|haiku|fable|mythos)-\d/;
    for (const f of await sources()) {
      if (f.path === 'models.ts' || isTest(f.path)) continue;
      expect(re.test(f.text), f.path).toBe(false);
    }
  });

  it('contains no API key material', async () => {
    for (const f of await sources()) expect(new RegExp(['sk', 'ant', ''].join('-')).test(f.text), f.path).toBe(false);
  });
});

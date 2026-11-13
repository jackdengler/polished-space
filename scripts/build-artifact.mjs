// Packs the production build into one self-contained HTML file (JS and CSS
// inlined) for hosting as a single page, e.g. a claude.ai artifact.
// Usage: npm run build:artifact  →  artifact/compensian-pm.html
//        SEED=/path/outside/repo/seed.json npm run build:artifact   (adds built-in data)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
let html = readFileSync(join(dist, 'index.html'), 'utf8');

html = html.replace(/<script type="module" crossorigin src="\.\/([^"]+)"><\/script>/, (_, file) => {
  const js = readFileSync(join(dist, file), 'utf8').replace(/<\/script/gi, '<\\/script');
  return `<script type="module">${js}</script>`;
});
html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/([^"]+)">/, (_, file) =>
  `<style>${readFileSync(join(dist, file), 'utf8')}</style>`);

if (/src="\.\/assets|href="\.\/assets/.test(html)) throw new Error('an asset was not inlined');

// The host adds its own document skeleton, so keep only what goes inside it.
const title = html.match(/<title>.*?<\/title>/)[0];
const styles = [...html.matchAll(/<style>[\s\S]*?<\/style>/g)].map((m) => m[0]).join('\n');
const scripts = [...html.matchAll(/<script type="module">[\s\S]*?<\/script>/g)].map((m) => m[0]).join('\n');
// The host supplies the tab icon, so the favicon <link> is left out.
// Optional built-in data (SEED=path/to/seed.json). Only ever injected here, never committed.
let seedScript = '';
if (process.env.SEED) {
  const seed = readFileSync(process.env.SEED, 'utf8');
  JSON.parse(seed); // fail fast on a bad file
  seedScript = `<script>window.__COMPENSIAN_SEED__=${seed.replace(/</g, '\\u003c')};</script>\n`;
}
const out = `${title}\n<meta name="color-scheme" content="light dark">\n${styles}\n<div id="root"></div>\n${seedScript}${scripts}\n`;

mkdirSync('artifact', { recursive: true });
// Guard against a half-copied tag swallowing the stylesheet: the CSS must open right after the head bits.
if (!/^<title>[^<]*<\/title>\n<meta[^>]*>\n<style>/.test(out)) throw new Error('unexpected markup before the stylesheet');
writeFileSync('artifact/compensian-pm.html', out);
console.log(`artifact/compensian-pm.html (${(out.length / 1024).toFixed(0)} KB)`);

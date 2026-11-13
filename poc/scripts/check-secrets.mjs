// Secret check (plan 3.4).
//
//   npm --prefix poc run check:secrets
//
// 1. No Anthropic key (sk-ant-...) in any file git tracks or would add (the whole repo).
// 2. No key in the POC's logs and test results (poc/data/logs, poc/test-results).
// 3. If a key is configured (ANTHROPIC_API_KEY or poc/.env), its exact value appears in
//    none of those files either. The value itself is never printed.
// 4. poc/.env is ignored by git and not tracked.
// 5. With a running Docker daemon: no key inside the built images (skipped otherwise).
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { POC_DIR, REPO_DIR, readDotEnv } from './dev.mjs';

const KEY_RE = /sk-ant-[A-Za-z0-9_-]{20,}/;
let failed = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => {
  failed++;
  console.log(`  ✗ ${m}`);
};
const git = (...args) => spawnSync('git', args, { cwd: REPO_DIR, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const configured = process.env.ANTHROPIC_API_KEY || readDotEnv().ANTHROPIC_API_KEY || '';
const hasSecret = (text) => KEY_RE.test(text) || (configured.length >= 8 && text.includes(configured));

console.log('Secret check');

// 1. Repo files (tracked, plus untracked files that are not ignored).
const files = git('ls-files', '-co', '--exclude-standard', '-z').stdout.split('\0').filter(Boolean);
const hits = [];
for (const f of files) {
  const p = join(REPO_DIR, f);
  try {
    const st = statSync(p);
    if (!st.isFile() || st.size > 20_000_000) continue;
    if (hasSecret(readFileSync(p, 'latin1'))) hits.push(f);
  } catch {
    /* deleted in the work tree */
  }
}
if (hits.length) bad(`key-like text in repo files: ${hits.join(', ')}`);
else ok(`no key in ${files.length} repo files (tracked or addable)`);

// 2 + 3. Logs and test results.
const walk = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])) : []);
const logFiles = [...walk(join(POC_DIR, 'data/logs')), ...walk(join(POC_DIR, 'test-results')).filter((f) => !/\.(png|jpe?g|webm|zip)$/i.test(f))];
const logHits = logFiles.filter((f) => statSync(f).size < 50_000_000 && hasSecret(readFileSync(f, 'latin1')));
if (logHits.length) bad(`key found in logs or results: ${logHits.map((f) => relative(REPO_DIR, f)).join(', ')}`);
else ok(`no key in ${logFiles.length} log and result files${configured ? ' (also checked for the configured key’s exact value)' : ''}`);

// 4. poc/.env is ignored and untracked.
if (git('check-ignore', '-q', 'poc/.env').status === 0) ok('poc/.env is ignored by git');
else bad('poc/.env is NOT ignored by git');
if (git('ls-files', '--error-unmatch', 'poc/.env').status === 0) bad('poc/.env is tracked by git');
else ok('poc/.env is not tracked');
if (git('check-ignore', '-q', 'poc/env.example').status === 0) bad('poc/env.example is ignored (it should be committed, without a key)');

// 5. Built images, when Docker is running.
const docker = spawnSync('docker', ['info'], { stdio: 'ignore' });
if (docker.error || docker.status !== 0) console.log('  - images: skipped (no Docker daemon here; run this on the laptop after `npm --prefix poc run up`)');
else {
  for (const img of ['planr-poc-node:dev', 'planr-poc-speech:dev', 'planr-poc-gateway:dev']) {
    if (spawnSync('docker', ['image', 'inspect', img], { stdio: 'ignore' }).status !== 0) {
      console.log(`  - ${img}: not built`);
      continue;
    }
    const r = spawnSync('docker', ['run', '--rm', '--network', 'none', '--entrypoint', 'sh', img, '-c', 'grep -rIlE "sk-ant-[A-Za-z0-9_-]{20,}" /repo /usr/share/nginx/html /etc/nginx 2>/dev/null | head -5'], { encoding: 'utf8' });
    if ((r.stdout ?? '').trim()) bad(`${img} contains key-like text in: ${r.stdout.trim().split('\n').join(', ')}`);
    else ok(`${img}: no key inside`);
  }
}

console.log(failed ? `\nSecret check FAILED (${failed}).` : '\nSecret check passed.');
process.exit(failed ? 1 : 0);

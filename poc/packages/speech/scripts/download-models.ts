/**
 * Downloads the speech models into the models dir (default
 * poc/packages/speech/models, gitignored; override with SPEECH_MODELS_DIR).
 *
 *   npm --prefix poc run models -w @poc/speech                   # default voice
 *   npm --prefix poc run models -w @poc/speech -- --voices cori,ljspeech
 *
 * Also run by Dockerfile.speech at image build time. Needs `curl`, `tar` and
 * `bzip2`. Each download is checked against its pinned SHA-256. Files already
 * in place (same SHA-256 marker) are skipped.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ASR_MODEL, DEFAULT_MODELS_DIR, DEFAULT_VOICE, TTS_VOICES, VAD_MODEL, isVoice, type ModelDownload } from '../src/models';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const modelsDir = path.resolve(arg('dir') ?? process.env.SPEECH_MODELS_DIR ?? DEFAULT_MODELS_DIR);
const voices = (arg('voices') ?? process.env.TTS_VOICE ?? DEFAULT_VOICE).split(',').map((v) => v.trim()).filter(Boolean);
for (const v of voices) if (!isVoice(v)) throw new Error(`unknown voice "${v}" (known: ${Object.keys(TTS_VOICES).join(', ')})`);

const wanted: ModelDownload[] = [ASR_MODEL, VAD_MODEL, ...voices.map((v) => TTS_VOICES[v as keyof typeof TTS_VOICES])];

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

async function install(m: ModelDownload): Promise<void> {
  const target = path.join(modelsDir, m.id);
  const marker = path.join(target, '.sha256');
  if (existsSync(marker) && readFileSync(marker, 'utf8').trim() === m.sha256) {
    console.log(`= ${m.id}: already installed`);
    return;
  }
  const work = path.join(modelsDir, '.download', m.id);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const file = path.join(work, path.basename(new URL(m.url).pathname));
  console.log(`> ${m.id}: downloading ${(m.bytes / 1e6).toFixed(0)} MB from ${m.url}`);
  execFileSync('curl', ['-fsSL', '--retry', '3', '--retry-delay', '2', '-o', file, m.url], { stdio: 'inherit' });
  const got = await sha256(file);
  if (got !== m.sha256) throw new Error(`${m.id}: SHA-256 mismatch (expected ${m.sha256}, got ${got})`);

  const staged = path.join(work, 'staged');
  mkdirSync(staged);
  if (m.file) {
    renameSync(file, path.join(staged, m.file));
  } else if (m.extract) {
    const members = Object.keys(m.extract);
    execFileSync('tar', ['-xjf', file, '-C', work, '--no-same-owner', ...members], { stdio: 'inherit' });
    for (const [from, to] of Object.entries(m.extract)) renameSync(path.join(work, from), path.join(staged, to));
  }
  writeFileSync(path.join(staged, '.sha256'), `${m.sha256}\n`);
  writeFileSync(path.join(staged, 'SOURCE.txt'), `${m.url}\nsha256 ${m.sha256}\nlicence: ${m.licence}\n`);
  rmSync(target, { recursive: true, force: true });
  renameSync(staged, target);
  rmSync(work, { recursive: true, force: true });
  console.log(`+ ${m.id}: installed in ${target}`);
}

mkdirSync(modelsDir, { recursive: true });
for (const m of wanted) await install(m);
rmSync(path.join(modelsDir, '.download'), { recursive: true, force: true });
console.log(`speech models ready in ${modelsDir} (voices: ${voices.join(', ')})`);

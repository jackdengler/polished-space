/**
 * Measures a running speech service (real models): STT event timing and
 * accuracy on the fixture, STT and TTS real-time factor, TTS time to first
 * audio, abort behaviour, and (with --pid) the server's memory and CPU.
 *
 *   npm --prefix poc run start -w @poc/speech &      # then:
 *   npm --prefix poc run measure -w @poc/speech -- [--url http://127.0.0.1:7100] [--pid <server pid>]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDIO, DEFAULT_URLS, PATHS, type SttEvent } from '@poc/contracts';
import { HttpSpeechToText, HttpTextToSpeech } from '../src/client';
import { decodeWav, float32ToPcm16 } from '../src/pcm';
import type { SpeechHealth } from '../src/server';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const url = arg('url') ?? process.env.SPEECH_URL ?? DEFAULT_URLS.speech.replace('speech', '127.0.0.1');
const pid = arg('pid');
const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = decodeWav(readFileSync(path.resolve(here, '..', 'fixtures', 'chase-michael-friday.wav')));
const RATE = AUDIO.sttSampleRate;
const FRAME = (RATE * AUDIO.sttFrameMs) / 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const health = async () => (await (await fetch(new URL(PATHS.speech.health, url))).json()) as SpeechHealth;

function procStats(): { rssMb: number; cpuTicks: number } | null {
  if (!pid) return null;
  const status = readFileSync(`/proc/${pid}/status`, 'utf8');
  const rss = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0) / 1024;
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]!.split(' ');
  return { rssMb: Math.round(rss), cpuTicks: Number(stat[11]) + Number(stat[12]) };
}

/** Streams the fixture to /stt (paced = real time, else as fast as possible). */
async function runStt(paced: boolean) {
  const stt = new HttpSpeechToText(url).open();
  const t0 = performance.now();
  const log: { type: string; text?: string; wallMs: number; audioMs: number }[] = [];
  let sent = 0;
  const done = (async () => {
    for await (const e of stt.events as AsyncIterable<SttEvent>) {
      log.push({ ...e, wallMs: Math.round(performance.now() - t0), audioMs: Math.round((sent / RATE) * 1000) });
      if (e.type === 'final') return;
    }
  })();
  const pcm = float32ToPcm16(fixture.samples);
  for (let i = 0; i < fixture.samples.length; i += FRAME) {
    stt.write(pcm.subarray(i * 2, (i + FRAME) * 2));
    sent = Math.min(fixture.samples.length, i + FRAME);
    if (paced) {
      const due = (sent / RATE) * 1000;
      const lag = due - (performance.now() - t0);
      if (lag > 0) await sleep(lag);
    }
  }
  await Promise.race([done, sleep(5000)]);
  const wall = performance.now() - t0;
  stt.close();
  return { log, wall };
}

const cpu0 = procStats();
const h0 = await health();
console.log(`service: ${h0.engine}, tts ${h0.ttsSampleRate} Hz, stt ${h0.sttSampleRate} Hz`);
console.log(`fixture: ${(fixture.samples.length / RATE).toFixed(2)} s, speech 0.50 s - 3.00 s ("Add a task to chase Michael on Friday.")`);

// 1. STT in real time: event timing relative to the audio.
const paced = await runStt(true);
console.log('\nSTT, real-time stream (audioMs = audio sent so far when the event arrived):');
for (const e of paced.log) console.log(`  ${e.type.padEnd(12)} audio ${String(e.audioMs).padStart(5)} ms  wall ${String(e.wallMs).padStart(5)} ms  ${e.text ?? ''}`);
const final = paced.log.find((e) => e.type === 'final');
const start = paced.log.find((e) => e.type === 'speech_start');
const ok = !!final && /chase/i.test(final.text!) && /friday/i.test(final.text!);
console.log(`  keywords chase+friday: ${ok ? 'PASS' : 'FAIL'}`);
if (start) console.log(`  speech_start ${start.wallMs - 500} ms after speech onset (onset at 500 ms)`);
if (final) console.log(`  final ${final.wallMs - 3000} ms after speech end (end at 3000 ms)`);

// 2. STT as fast as possible: real-time factor.
const fast = await runStt(false);
console.log(`\nSTT fast feed: ${fast.log.find((e) => e.type === 'final')?.text ?? '(no final)'}; RTF ${(fast.wall / 1000 / (fixture.samples.length / RATE)).toFixed(3)} (wall ${Math.round(fast.wall)} ms incl. socket)`);

// 3. TTS: time to first audio and real-time factor.
const tts = await HttpTextToSpeech.connect(url);
const sentences = [
  'Sure, I have added that task for Friday.',
  'You have three things due today, and the Harborlight report is the most urgent.',
  'Done.',
  'Your next meeting is with Acme Tooling at two o clock, so you have about forty minutes free.',
];
async function speakOnce(text: string) {
  const t0 = performance.now();
  let first = -1;
  let bytes = 0;
  for await (const c of tts.speak(text, new AbortController().signal)) {
    if (first < 0) first = performance.now() - t0;
    bytes += c.length;
  }
  const total = performance.now() - t0;
  const audio = bytes / 2 / tts.sampleRate;
  return { first, total, audio };
}
await speakOnce('Warming up.');
console.log('\nTTS (after warm-up):');
const firsts: number[] = [];
for (const s of sentences) {
  const r = await speakOnce(s);
  firsts.push(r.first);
  console.log(`  first audio ${String(Math.round(r.first)).padStart(4)} ms  total ${String(Math.round(r.total)).padStart(4)} ms  audio ${r.audio.toFixed(2)} s  RTF ${(r.total / 1000 / r.audio).toFixed(3)}  "${s}"`);
}
console.log(`  max first audio ${Math.round(Math.max(...firsts))} ms (target < 400): ${Math.max(...firsts) < 400 ? 'PASS' : 'FAIL'}`);

// 4. Abort mid-stream: synthesis stops.
const long = Array.from({ length: 8 }, (_, i) => `This is sentence number ${i + 1} of a long answer that should be cut off.`).join(' ');
const before = (await health()).tts;
const ac = new AbortController();
let chunks = 0;
const tA = performance.now();
for await (const _ of tts.speak(long, ac.signal)) {
  chunks++;
  if (chunks === 1) ac.abort();
}
await sleep(1500);
const after = (await health()).tts;
const synthesised = after.piecesSynthesised - before.piecesSynthesised;
console.log(
  `\nTTS abort: aborted after first chunk (${Math.round(performance.now() - tA - 1500)} ms); pieces synthesised ${synthesised} of 8, ` +
    `aborted jobs +${after.aborted - before.aborted}, active ${after.active}: ${synthesised <= 2 && after.aborted > before.aborted && after.active === 0 ? 'PASS' : 'FAIL'}`,
);

// 5. Process stats.
const cpu1 = procStats();
if (cpu0 && cpu1) console.log(`\nserver pid ${pid}: RSS ${cpu1.rssMb} MB; CPU used during this run ${((cpu1.cpuTicks - cpu0.cpuTicks) / 100).toFixed(1)} s`);

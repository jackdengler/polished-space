/**
 * `WS /api/voice`: live voice over the same chat pipeline as typed text.
 *
 *   browser --PCM16 16 kHz--> brain --> speech /stt
 *   speech: speech_start / partial / final --> brain --> stt.partial / stt.final
 *   final (non-empty) --> ChatPipeline (same conversation as typed turns)
 *   reply deltas --> SentenceChunker --> speech /tts (each piece at once)
 *   --> assistant.audio.start {sampleRate} + binary PCM16 frames --> browser
 *
 * Barge-in: `speech_start` while the assistant is thinking or speaking (the
 * reply is streaming, or audio sent is still playing by our estimate) sends
 * `interrupted {spokenText}`, mutes audio at once (no frame after it),
 * aborts the Claude stream and every TTS job, and keeps in history only the
 * text that was spoken. Listening carries on.
 *
 * Self-interruption guard (the browser does echo cancellation; this is the
 * server's share): an optional extra speech time before barge-in
 * (`bargeInMs`, env POC_VOICE_BARGE_IN_MS, default 0 because the speech
 * service already needs STT_MIN_SPEECH_MS of speech before `speech_start`),
 * during which a transcript that only repeats the assistant's own words does
 * not interrupt; and finals that only echo the reply are ignored.
 *
 * Every turn appends stage timings to `logs/voice-turns.jsonl`.
 */
import { join } from 'node:path';
import { VoiceClientMessage, type SpeechToText, type SttStream, type TextToSpeech, type VoiceServerMessage } from '@poc/contracts';
import type { WebSocket, RawData } from 'ws';
import type { ModuleContext } from '../modules/types';
import { appendLine } from '../store/jsonFile';
import type { ChatPipeline } from './pipeline';
import { SentenceChunker, speakable, type ChunkerOptions } from './sentences';

export const VOICE_TIMINGS_FILE = 'logs/voice-turns.jsonl';

export interface VoiceOptions {
  stt: SpeechToText;
  /** Resolves the TTS client (lazily, so the brain starts without the speech service). */
  tts: () => Promise<TextToSpeech>;
  /** Extra speech (ms) after `speech_start` before barging in; 0 = at once. */
  bargeInMs: number;
  /** Playback is treated as still going this long after the last audio should have ended. */
  playbackMarginMs: number;
  chunker?: ChunkerOptions;
  log: (msg: string) => void;
}

export interface VoiceTimings {
  ts: string;
  turnId: string | null;
  transcript: string;
  /** Epoch ms. lastPartialAt is the closest the brain sees to "end of speech". */
  speechStartAt: number | null;
  lastPartialAt: number | null;
  finalAt: number;
  firstTokenAt: number | null;
  firstPieceAt: number | null;
  firstAudioAt: number | null;
  audioDoneAt: number | null;
  doneAt: number | null;
  interrupted: boolean;
  /** Derived stage durations (ms); null when a stage did not happen. */
  ms: {
    speechEndToFinal: number | null;
    finalToFirstToken: number | null;
    firstTokenToFirstAudio: number | null;
    finalToFirstAudio: number | null;
    speechEndToFirstAudio: number | null;
  };
  pieces: number;
  audioBytes: number;
}

const diff = (a: number | null, b: number | null) => (a === null || b === null ? null : Math.round(b - a));

const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];

/** True when `heard` (3+ words) is mostly words of the assistant's own reply: likely echo. */
export function isEcho(heard: string, reply: string): boolean {
  const h = words(heard);
  if (h.length < 3) return false;
  const r = new Set(words(reply));
  const hits = h.filter((w) => r.has(w)).length;
  return hits / h.length >= 0.8;
}

interface Segment {
  piece: number;
  start: number;
  dur: number;
}

interface Piece {
  /** Raw text (a slice of the full reply, so pieces concatenate to its prefix). */
  raw: string;
  sentMs: number;
  ttsDone: boolean;
}

/** One assistant turn on the voice socket. */
class VoiceTurn {
  readonly ac = new AbortController();
  readonly chunker: SentenceChunker;
  readonly pieces: Piece[] = [];
  readonly segments: Segment[] = [];
  private jobs: Promise<AsyncIterator<Uint8Array> | null>[] = [];
  private sender: Promise<void> = Promise.resolve();
  /** Set on interruption: from then on no audio frame may be sent. */
  muted = false;
  audioStarted = false;
  playheadEnd = 0;
  running = true;
  frozenSpoken: string | null = null;
  fullText = '';
  ttsFailed = false;

  constructor(
    private session: VoiceSession,
    readonly timings: VoiceTimings,
    chunker: ChunkerOptions | undefined,
  ) {
    this.chunker = new SentenceChunker(chunker);
  }

  get signal(): AbortSignal {
    return this.ac.signal;
  }

  onDelta(text: string): void {
    this.fullText += text;
    for (const p of this.chunker.push(text)) this.speak(p);
  }

  /** Start synthesising a piece now; audio is sent in piece order. */
  speak(raw: string): void {
    const idx = this.pieces.length;
    const piece: Piece = { raw, sentMs: 0, ttsDone: false };
    this.pieces.push(piece);
    this.timings.firstPieceAt ??= Date.now();
    const text = speakable(raw);
    const job = text && !this.ttsFailed ? this.startJob(text) : Promise.resolve(null);
    this.jobs.push(job);
    this.sender = this.sender.then(() => this.drain(idx, job));
  }

  private async startJob(text: string): Promise<AsyncIterator<Uint8Array> | null> {
    try {
      const tts = await this.session.tts();
      if (this.signal.aborted) return null;
      // Start the request now (prefetch), buffering chunks until drain() reads them.
      const it = tts.speak(text, this.signal)[Symbol.asyncIterator]();
      const buf: IteratorResult<Uint8Array>[] = [];
      const waiter: { wake: (() => void) | null } = { wake: null };
      let failure: unknown = null;
      let ended = false;
      void (async () => {
        try {
          for (;;) {
            const r = await it.next();
            buf.push(r);
            waiter.wake?.();
            if (r.done) break;
          }
        } catch (e) {
          failure = e;
        } finally {
          ended = true;
          waiter.wake?.();
        }
      })();
      return {
        next: async () => {
          for (;;) {
            if (buf.length) return buf.shift()!;
            if (failure) throw failure;
            if (ended) return { done: true, value: undefined };
            await new Promise<void>((r) => (waiter.wake = r));
            waiter.wake = null;
          }
        },
      };
    } catch (e) {
      if (!this.ttsFailed && !this.signal.aborted) {
        this.ttsFailed = true;
        this.session.send({ type: 'error', error: `Voice output is unavailable: ${(e as Error).message}` });
      }
      return null;
    }
  }

  private async drain(idx: number, job: Promise<AsyncIterator<Uint8Array> | null>): Promise<void> {
    const piece = this.pieces[idx]!;
    const it = await job;
    try {
      while (it && !this.muted && !this.signal.aborted) {
        const r = await it.next();
        if (r.done) break;
        if (this.muted || this.signal.aborted) break;
        this.sendAudio(idx, r.value);
      }
    } catch (e) {
      if (!this.signal.aborted && !this.ttsFailed) {
        this.ttsFailed = true;
        this.session.send({ type: 'error', error: `Voice output failed: ${(e as Error).message}` });
      }
    }
    piece.ttsDone = true;
  }

  private sendAudio(idx: number, chunk: Uint8Array): void {
    if (this.muted || !chunk.length) return;
    const rate = this.session.ttsRate;
    if (!this.audioStarted) {
      this.audioStarted = true;
      this.session.send({ type: 'assistant.audio.start', sampleRate: rate });
      this.timings.firstAudioAt = Date.now();
    }
    if (!this.session.sendBinary(chunk)) return;
    this.timings.audioBytes += chunk.length;
    const now = Date.now();
    const dur = (chunk.length / 2 / rate) * 1000;
    const start = Math.max(this.playheadEnd, now);
    this.playheadEnd = start + dur;
    this.pieces[idx]!.sentMs += dur;
    this.segments.push({ piece: idx, start, dur });
  }

  /** Flush the rest of the reply to TTS and wait until all its audio is sent. */
  async finishAudio(): Promise<void> {
    const rest = this.chunker.flush();
    if (rest) this.speak(rest);
    await this.sender;
    this.timings.audioDoneAt = Date.now();
  }

  /** Resolve when the browser should have finished playing (or on abort). */
  waitPlayback(marginMs: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.signal.aborted) return resolve();
      const left = this.playheadEnd + marginMs - Date.now();
      if (left <= 0) return resolve();
      const t = setTimeout(done, left);
      const onAbort = () => done();
      function done() {
        clearTimeout(t);
        resolve();
      }
      this.signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * The part of the reply the user has heard by `now`: whole pieces whose
   * audio has played, then the words of the current piece in proportion.
   */
  spokenText(now = Date.now()): string {
    let out = '';
    for (let i = 0; i < this.pieces.length; i++) {
      const p = this.pieces[i]!;
      const segs = this.segments.filter((s) => s.piece === i);
      if (!segs.length) {
        // A piece with nothing to say aloud (markdown only) counts as heard once later audio has started.
        if (!speakable(p.raw) && this.segments.some((s) => s.piece > i && s.start <= now)) {
          out += p.raw;
          continue;
        }
        break;
      }
      const heard = segs.reduce((t, s) => t + Math.min(Math.max(now - s.start, 0), s.dur), 0);
      const total = p.ttsDone ? p.sentMs : Math.max(p.sentMs, speakable(p.raw).length * 65);
      if (p.ttsDone && heard >= total - 1) {
        out += p.raw;
        continue;
      }
      const chars = Math.floor((heard / Math.max(total, 1)) * p.raw.length);
      const cut = p.raw.slice(0, chars);
      const lastGap = cut.search(/\s+\S*$/);
      out += lastGap > 0 ? cut.slice(0, lastGap) : '';
      break;
    }
    return out;
  }
}

/** One browser connection. */
export class VoiceSession {
  private stt: SttStream | null = null;
  private turn: VoiceTurn | null = null;
  private utterance: { startAt: number; lastPartial: string; lastPartialAt: number | null; bargeTimer: NodeJS.Timeout | null } | null = null;
  private ttsClient: TextToSpeech | null = null;
  private closed = false;

  constructor(
    private ws: WebSocket,
    private ctx: ModuleContext,
    private pipeline: ChatPipeline,
    private opts: VoiceOptions,
  ) {
    ws.on('message', (data, isBinary) => this.onMessage(data, isBinary));
    ws.on('close', () => this.close());
    ws.on('error', (e) => opts.log(`voice socket error: ${e.message}`));
  }

  get ttsRate(): number {
    return this.ttsClient?.sampleRate ?? 22050;
  }

  async tts(): Promise<TextToSpeech> {
    this.ttsClient ??= await this.opts.tts();
    return this.ttsClient;
  }

  send(m: VoiceServerMessage): void {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(m));
  }

  sendBinary(b: Uint8Array): boolean {
    if (this.ws.readyState !== this.ws.OPEN) return false;
    this.ws.send(b, { binary: true });
    return true;
  }

  private onMessage(data: RawData, isBinary: boolean): void {
    if (isBinary) {
      const buf = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer);
      this.openStt().write(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
      return;
    }
    let msg: VoiceClientMessage;
    try {
      msg = VoiceClientMessage.parse(JSON.parse(String(data)));
    } catch {
      this.send({ type: 'error', error: 'expected {"type":"start"} or {"type":"stop"}' });
      return;
    }
    if (msg.type === 'start') this.openStt();
    else {
      this.closeStt();
      if (this.isActive()) this.interrupt('stop');
    }
  }

  private openStt(): SttStream {
    if (this.stt) return this.stt;
    const s = this.opts.stt.open();
    this.stt = s;
    void (async () => {
      try {
        for await (const e of s.events) {
          if (this.stt !== s) break;
          if (e.type === 'speech_start') this.onSpeechStart();
          else if (e.type === 'partial') this.onPartial(e.text);
          else this.onFinal(e.text);
        }
      } catch (err) {
        this.opts.log(`stt stream failed: ${(err as Error).message}`);
      }
      if (this.stt === s && !this.closed) {
        this.stt = null;
        this.send({ type: 'error', error: 'Speech recognition disconnected; it reconnects when you speak again.' });
      }
    })();
    return s;
  }

  private closeStt(): void {
    const s = this.stt;
    this.stt = null;
    s?.close();
  }

  /** The assistant is thinking, streaming, or (by our estimate) still playing audio. */
  isActive(now = Date.now()): boolean {
    const t = this.turn;
    if (!t || t.signal.aborted) return false;
    return t.running || now < t.playheadEnd + this.opts.playbackMarginMs;
  }

  private onSpeechStart(): void {
    if (this.utterance?.bargeTimer) clearTimeout(this.utterance.bargeTimer);
    this.utterance = { startAt: Date.now(), lastPartial: '', lastPartialAt: null, bargeTimer: null };
    if (!this.isActive()) return;
    if (this.opts.bargeInMs <= 0) {
      this.interrupt('speech_start');
      return;
    }
    const u = this.utterance;
    u.bargeTimer = setTimeout(() => {
      u.bargeTimer = null;
      if (this.utterance === u && this.isActive() && !isEcho(u.lastPartial, this.turn?.fullText ?? '')) this.interrupt('speech');
    }, this.opts.bargeInMs);
  }

  private onPartial(text: string): void {
    const u = this.utterance;
    if (u && text !== u.lastPartial) {
      u.lastPartial = text;
      u.lastPartialAt = Date.now();
    }
    this.send({ type: 'stt.partial', text });
    // A real word that is not our own echo confirms a pending barge-in early.
    if (u?.bargeTimer && text.trim() && this.isActive() && !isEcho(text, this.turn?.fullText ?? '')) {
      clearTimeout(u.bargeTimer);
      u.bargeTimer = null;
      this.interrupt('speech');
    }
  }

  private onFinal(raw: string): void {
    const text = raw.trim();
    const u = this.utterance;
    this.utterance = null;
    if (u?.bargeTimer) clearTimeout(u.bargeTimer);
    if (!text) return; // the speech service may end an utterance with nothing recognised
    if (this.isActive() && isEcho(text, this.turn?.fullText ?? '')) {
      this.opts.log(`ignored a final that echoes the reply: "${text}"`);
      return;
    }
    this.send({ type: 'stt.final', text });
    if (this.isActive()) this.interrupt('final');
    void this.startTurn(text, u, Date.now());
  }

  /** Barge-in. Sends `interrupted`, mutes audio, aborts Claude and TTS. */
  interrupt(why: string): void {
    const t = this.turn;
    if (!t || t.signal.aborted) return;
    t.muted = true;
    t.frozenSpoken = t.spokenText();
    t.timings.interrupted = true;
    this.send({ type: 'interrupted', spokenText: t.frozenSpoken.trim() });
    t.ac.abort();
    this.opts.log(`barge-in (${why}); kept ${t.frozenSpoken.length} of ${t.fullText.length} chars`);
  }

  private async startTurn(text: string, u: { startAt: number; lastPartialAt: number | null } | null, finalAt: number): Promise<void> {
    const timings: VoiceTimings = {
      ts: this.ctx.clock.now().toISOString(),
      turnId: null,
      transcript: text,
      speechStartAt: u?.startAt ?? null,
      lastPartialAt: u?.lastPartialAt ?? null,
      finalAt,
      firstTokenAt: null,
      firstPieceAt: null,
      firstAudioAt: null,
      audioDoneAt: null,
      doneAt: null,
      interrupted: false,
      ms: { speechEndToFinal: null, finalToFirstToken: null, firstTokenToFirstAudio: null, finalToFirstAudio: null, speechEndToFirstAudio: null },
      pieces: 0,
      audioBytes: 0,
    };
    const t = new VoiceTurn(this, timings, this.opts.chunker);
    this.turn = t;
    // Warm the TTS client while Claude thinks.
    void this.tts().catch(() => {});
    try {
      const result = await this.pipeline.run({
        text,
        via: 'voice',
        signal: t.signal,
        handlers: {
          onFirstToken: () => (timings.firstTokenAt ??= Date.now()),
          onDelta: (d) => {
            if (t.muted) return;
            this.send({ type: 'assistant.delta', text: d });
            t.onDelta(d);
          },
        },
        keep: () => t.frozenSpoken ?? t.spokenText(),
        settle: async ({ fullText, error }) => {
          if (error) {
            this.send({ type: 'error', error });
            if (!fullText.trim()) t.onDelta(error);
          }
          await t.finishAudio();
          t.running = false;
          if (!t.signal.aborted) this.send({ type: 'assistant.done', text: t.fullText });
          await t.waitPlayback(this.opts.playbackMarginMs);
        },
      });
      timings.turnId = result.id;
    } catch (e) {
      this.send({ type: 'error', error: (e as Error).message });
    } finally {
      t.running = false;
      if (this.turn === t) this.turn = null;
      timings.doneAt = Date.now();
      timings.pieces = t.pieces.length;
      const end = timings.lastPartialAt;
      timings.ms = {
        speechEndToFinal: diff(end, timings.finalAt),
        finalToFirstToken: diff(timings.finalAt, timings.firstTokenAt),
        firstTokenToFirstAudio: diff(timings.firstTokenAt, timings.firstAudioAt),
        finalToFirstAudio: diff(timings.finalAt, timings.firstAudioAt),
        speechEndToFirstAudio: diff(end, timings.firstAudioAt),
      };
      await appendLine(join(this.ctx.config.dataDir, VOICE_TIMINGS_FILE), JSON.stringify(timings)).catch((e) => this.opts.log(`timings log failed: ${(e as Error).message}`));
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeStt();
    const t = this.turn;
    if (t && !t.signal.aborted) {
      t.muted = true;
      t.frozenSpoken = t.spokenText();
      t.ac.abort();
    }
  }
}

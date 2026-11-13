import { AUDIO, PATHS, VoiceServerMessage, type VoiceClientMessage } from '@poc/contracts';
import captureUrl from './capture.worklet.js?url';
import playbackUrl from './playback.worklet.js?url';

/**
 * Live voice over `WS /api/voice` (contract: voice.ts).
 *
 * Up: `{type:'start'}`, then binary PCM16 LE mono 16 kHz frames of 20 ms
 * (captured by an AudioWorklet with echo cancellation on), `{type:'stop'}`.
 * Down: `stt.partial`, `stt.final`, `assistant.delta`,
 * `assistant.audio.start {sampleRate}` followed by binary PCM16 frames,
 * `interrupted {spokenText}` (drop the playback queue at once),
 * `assistant.done {text}`, `error {error}`.
 */

export type VoiceUiStatus = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'off' | 'error';

export interface VoiceHandlers {
  status(s: VoiceUiStatus): void;
  partial(text: string): void;
  final(text: string): void;
  delta(text: string): void;
  done(text: string): void;
  interrupted(spokenText: string): void;
  error(message: string): void;
}

/** Where decoded assistant audio goes. The real one is an AudioWorklet queue. */
export interface PlaybackSink {
  /** Sample rate of the PCM that follows (from `assistant.audio.start`). */
  setInputRate(rate: number): void;
  push(pcm: Int16Array): void;
  /** Drop everything queued, immediately. */
  flush(): void;
  /** Reports `playing` when audio starts coming out and `drained` when the queue runs dry. */
  onState: ((s: 'playing' | 'drained') => void) | null;
  close(): void;
}

export interface SocketLike {
  binaryType: string;
  readyState: number;
  send(data: string | ArrayBuffer): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface MicCapture {
  /** Frames of PCM16 16 kHz mono, 640 bytes each. */
  onFrame: ((buf: ArrayBuffer) => void) | null;
  close(): void;
}

export interface VoiceDeps {
  openSocket(url: string): SocketLike;
  /** Open the mic and the audio graph: returns the capture and the playback sink. */
  openAudio(): Promise<{ mic: MicCapture; sink: PlaybackSink }>;
}

const OPEN = 1;

/** Linear-interpolating resampler that keeps its phase across chunks. */
export class Resampler {
  private last = 0;
  private pos = 0;
  constructor(
    private from: number,
    private readonly to: number,
  ) {}
  setFrom(rate: number): void {
    if (rate !== this.from) {
      this.from = rate;
      this.pos = 0;
    }
  }
  reset(): void {
    this.last = 0;
    this.pos = 0;
  }
  process(input: Float32Array): Float32Array {
    if (this.from === this.to) return input;
    const step = this.from / this.to;
    const out: number[] = [];
    // pos is measured in input samples, relative to the start of `input`; -1 is `last`.
    while (this.pos < input.length - 1 + 1e-9) {
      const i = Math.floor(this.pos);
      const frac = this.pos - i;
      const a = i < 0 ? this.last : input[i]!;
      const b = input[i + 1] ?? input[input.length - 1]!;
      out.push(a + (b - a) * frac);
      this.pos += step;
    }
    this.pos -= input.length;
    this.last = input[input.length - 1] ?? this.last;
    return Float32Array.from(out);
  }
}

export function pcm16ToFloat(pcm: Int16Array): Float32Array {
  const f = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) f[i] = pcm[i]! / 0x8000;
  return f;
}

/** Real audio: getUserMedia + AudioWorklets. */
export async function openBrowserAudio(): Promise<{ mic: MicCapture; sink: PlaybackSink }> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  try {
    await ctx.audioWorklet.addModule(captureUrl);
    await ctx.audioWorklet.addModule(playbackUrl);
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
    throw e;
  }
  if (ctx.state === 'suspended') await ctx.resume();

  const source = ctx.createMediaStreamSource(stream);
  const captureNode = new AudioWorkletNode(ctx, 'pcm-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
  // The capture node must be pulled by the graph; route it through a muted gain.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(captureNode).connect(mute).connect(ctx.destination);

  const playNode = new AudioWorkletNode(ctx, 'pcm-playback', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
  playNode.connect(ctx.destination);

  const mic: MicCapture = {
    onFrame: null,
    close: () => {
      captureNode.port.postMessage({ type: 'stop' });
      stream.getTracks().forEach((t) => t.stop());
    },
  };
  captureNode.port.onmessage = (e: MessageEvent<ArrayBuffer>) => mic.onFrame?.(e.data);

  const resampler = new Resampler(22050, ctx.sampleRate);
  const sink: PlaybackSink = {
    onState: null,
    setInputRate: (rate) => {
      resampler.setFrom(rate);
      resampler.reset();
    },
    push: (pcm) => {
      const samples = resampler.process(pcm16ToFloat(pcm));
      playNode.port.postMessage({ type: 'audio', samples }, [samples.buffer]);
    },
    flush: () => {
      playNode.port.postMessage({ type: 'flush' });
      resampler.reset();
    },
    close: () => {
      void ctx.close();
    },
  };
  playNode.port.onmessage = (e: MessageEvent<{ type: 'playing' | 'drained' }>) => sink.onState?.(e.data.type);
  return { mic, sink };
}

export const browserDeps: VoiceDeps = {
  openSocket: (url) => new WebSocket(url) as unknown as SocketLike,
  openAudio: openBrowserAudio,
};

export function voiceUrl(loc: { protocol: string; host: string } = location): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}${PATHS.brain.voice}`;
}

export class VoiceClient {
  private ws: SocketLike | null = null;
  private mic: MicCapture | null = null;
  private sink: PlaybackSink | null = null;
  /** True between `assistant.audio.start` and `interrupted`/the next turn: audio frames are accepted. */
  private acceptingAudio = false;
  private playing = false;
  private turnDone = true;
  private status: VoiceUiStatus = 'off';
  framesSent = 0;
  framesReceived = 0;

  constructor(
    private readonly h: VoiceHandlers,
    private readonly deps: VoiceDeps = browserDeps,
  ) {}

  get active(): boolean {
    return this.ws !== null;
  }

  private setStatus(s: VoiceUiStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.h.status(s);
  }

  async start(url = voiceUrl()): Promise<void> {
    if (this.ws) return;
    this.setStatus('connecting');
    let audio: { mic: MicCapture; sink: PlaybackSink };
    try {
      audio = await this.deps.openAudio();
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      this.setStatus('error');
      this.h.error(name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in the browser to talk.' : 'Could not open the microphone.');
      return;
    }
    this.mic = audio.mic;
    this.sink = audio.sink;
    this.sink.onState = (s) => {
      this.playing = s === 'playing';
      if (this.playing) this.setStatus('speaking');
      else if (this.turnDone) this.setStatus('listening');
      else this.setStatus('thinking');
    };

    const ws = this.deps.openSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.send({ type: 'start' });
      this.setStatus('listening');
      this.mic!.onFrame = (buf) => {
        if (ws.readyState === OPEN) {
          ws.send(buf);
          this.framesSent++;
        }
      };
    };
    ws.onmessage = (ev) => this.handleMessage(ev.data);
    ws.onerror = () => {
      /* onclose follows and reports */
    };
    ws.onclose = () => {
      if (this.ws === ws) {
        this.teardown();
        this.setStatus('error');
        this.h.error('The voice connection closed.');
      }
    };
  }

  stop(): void {
    if (!this.ws) return;
    this.send({ type: 'stop' });
    const ws = this.ws;
    this.ws = null;
    ws.close();
    this.teardown();
    this.setStatus('off');
  }

  private teardown(): void {
    this.ws = null;
    this.mic?.close();
    this.mic = null;
    this.sink?.flush();
    this.sink?.close();
    this.sink = null;
    this.acceptingAudio = false;
    this.playing = false;
    this.turnDone = true;
  }

  private send(m: VoiceClientMessage): void {
    if (this.ws && this.ws.readyState === OPEN) this.ws.send(JSON.stringify(m));
  }

  /** Handle one frame from the server (public so tests can drive it). */
  handleMessage(data: unknown): void {
    if (data instanceof ArrayBuffer) {
      this.framesReceived++;
      // Only play audio announced by assistant.audio.start; nothing after `interrupted`.
      if (this.acceptingAudio && this.sink && data.byteLength >= 2) this.sink.push(new Int16Array(data, 0, data.byteLength >> 1));
      return;
    }
    if (typeof data !== 'string') return;
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      return;
    }
    const parsed = VoiceServerMessage.safeParse(raw);
    if (!parsed.success) {
      console.warn('[sidebar] unknown voice message', raw);
      return;
    }
    const m = parsed.data;
    switch (m.type) {
      case 'stt.partial':
        this.h.partial(m.text);
        break;
      case 'stt.final':
        this.turnDone = false;
        this.acceptingAudio = false;
        this.h.final(m.text);
        if (!this.playing) this.setStatus('thinking');
        break;
      case 'assistant.delta':
        this.h.delta(m.text);
        break;
      case 'assistant.audio.start':
        this.acceptingAudio = true;
        this.sink?.setInputRate(m.sampleRate);
        break;
      case 'interrupted':
        // Barge-in: drop the queue first, then update the UI.
        this.acceptingAudio = false;
        this.sink?.flush();
        this.playing = false;
        this.turnDone = true;
        this.h.interrupted(m.spokenText);
        this.setStatus('listening');
        break;
      case 'assistant.done':
        this.turnDone = true;
        this.h.done(m.text);
        if (!this.playing) this.setStatus('listening');
        break;
      case 'error':
        this.h.error(m.error);
        break;
    }
  }
}

export const VOICE_FRAME_BYTES = (AUDIO.sttSampleRate * AUDIO.sttFrameMs * 2) / 1000;

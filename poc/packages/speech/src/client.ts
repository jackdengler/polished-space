import WebSocket from 'ws';
import {
  AUDIO,
  PATHS,
  SttEvent,
  type SpeechToText,
  type SttStream,
  type TextToSpeech,
} from '@poc/contracts';

/**
 * Clients for the speech service that implement the contract interfaces
 * (`SpeechToText`, `TextToSpeech`). Import from '@poc/speech/client'. They
 * use only `ws` and `fetch`, never the native engine.
 */

/** Push-based async iterable. */
class EventQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: ((r: IteratorResult<T>) => void)[] = [];
  private ended = false;

  push(item: T): void {
    if (this.ended) return;
    const w = this.waiters.shift();
    if (w) w({ value: item, done: false });
    else this.items.push(item);
  }

  end(): void {
    this.ended = true;
    for (const w of this.waiters.splice(0)) w({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item !== undefined) return Promise.resolve({ value: item, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
      return: () => {
        this.end();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}

function wsUrl(baseUrl: string, path: string): string {
  const u = new URL(path, baseUrl);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.toString();
}

/** One `/stt` WebSocket per `open()`. Audio written before the socket opens is buffered. */
export class HttpSpeechToText implements SpeechToText {
  constructor(private readonly baseUrl: string, private readonly onError: (e: Error) => void = () => {}) {}

  open(): SttStream {
    const ws = new WebSocket(wsUrl(this.baseUrl, PATHS.speech.stt));
    const events = new EventQueue<SttEvent>();
    const pending: Uint8Array[] = [];
    ws.on('open', () => { for (const p of pending.splice(0)) ws.send(p); });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const parsed = SttEvent.safeParse(JSON.parse(String(data)));
      if (parsed.success) events.push(parsed.data);
    });
    ws.on('close', () => events.end());
    ws.on('error', (e) => { this.onError(e); events.end(); });
    return {
      write(pcm) {
        if (ws.readyState === WebSocket.OPEN) ws.send(pcm);
        else if (ws.readyState === WebSocket.CONNECTING) pending.push(pcm);
      },
      events,
      close() {
        if (ws.readyState === WebSocket.CONNECTING) ws.terminate();
        else ws.close();
        events.end();
      },
    };
  }
}

/** `POST /tts`. Aborting the signal closes the request, which stops synthesis on the server. */
export class HttpTextToSpeech implements TextToSpeech {
  constructor(private readonly baseUrl: string, public sampleRate: number) {}

  /** Asks the service's health endpoint for its TTS sample rate. */
  static async connect(baseUrl: string): Promise<HttpTextToSpeech> {
    const res = await fetch(new URL(PATHS.speech.health, baseUrl));
    if (!res.ok) throw new Error(`speech health returned ${res.status}`);
    const body = (await res.json()) as { ttsSampleRate?: number };
    if (!body.ttsSampleRate) throw new Error('speech health has no ttsSampleRate');
    return new HttpTextToSpeech(baseUrl, body.ttsSampleRate);
  }

  async *speak(text: string, signal: AbortSignal): AsyncIterable<Uint8Array> {
    if (signal.aborted) return;
    let res: Response;
    try {
      res = await fetch(new URL(PATHS.speech.tts, this.baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal,
      });
    } catch (e) {
      if (signal.aborted) return;
      throw e;
    }
    if (!res.ok || !res.body) throw new Error(`speech /tts returned ${res.status}`);
    const rate = Number(res.headers.get(AUDIO.ttsSampleRateHeader));
    if (rate > 0) this.sampleRate = rate;
    const reader = res.body.getReader();
    let carry: Uint8Array | null = null;
    try {
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        // Keep chunks sample-aligned (2 bytes per sample).
        let chunk: Uint8Array = value;
        if (carry) {
          const merged = new Uint8Array(carry.length + chunk.length);
          merged.set(carry);
          merged.set(chunk, carry.length);
          chunk = merged;
          carry = null;
        }
        if (chunk.length % 2) {
          carry = chunk.subarray(chunk.length - 1);
          chunk = chunk.subarray(0, chunk.length - 1);
        }
        if (chunk.length) yield chunk;
      }
    } catch (e) {
      if (!signal.aborted) throw e;
    } finally {
      reader.cancel().catch(() => {});
    }
  }
}

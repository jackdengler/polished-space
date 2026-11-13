/** Test helpers for the chat and voice module (used by *.test.ts only). */
import type { AddressInfo } from 'node:net';
import { PATHS, type VoiceServerMessage } from '@poc/contracts';
import { FakeSpeechToText, FakeTextToSpeech } from '@poc/contracts/testing';
import WebSocket from 'ws';
import { makeHarness, type Harness, type HarnessOptions } from '../testing/harness';
import { createChatModule, type ChatModule, type ChatModuleOptions } from './index';

export interface ChatRig {
  h: Harness;
  base: string;
  mod: ChatModule;
  stt: FakeSpeechToText;
  tts: FakeTextToSpeech;
}

export async function upChat(opts: { module?: ChatModuleOptions; harness?: HarnessOptions; tts?: FakeTextToSpeech } = {}): Promise<ChatRig> {
  const stt = new FakeSpeechToText();
  const tts = opts.tts ?? new FakeTextToSpeech({ chunksPerText: 3, chunkDelayMs: 2 });
  // With a speechUrl the module talks to that (real) speech service instead of the fakes.
  const mod = createChatModule(opts.module?.speechUrl ? opts.module : { stt, tts: async () => tts, ...opts.module });
  const h = await makeHarness({ ...opts.harness, modules: [mod] });
  await new Promise<void>((r) => h.brain.server.listen(0, '127.0.0.1', () => r()));
  return { h, base: `http://127.0.0.1:${(h.brain.server.address() as AddressInfo).port}`, mod, stt, tts };
}

export interface SseEvent {
  event: string;
  data: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** POST /api/chat and read the SSE stream to the end. */
export async function postChat(base: string, text: string): Promise<SseEvent[]> {
  const res = await fetch(base + PATHS.brain.chat, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
  if (res.status !== 200) throw new Error(`chat answered ${res.status}: ${await res.text()}`);
  const body = await res.text();
  return body
    .split('\n\n')
    .map((chunk) => ({ event: /^event: (.+)$/m.exec(chunk)?.[1], data: /^data: (.+)$/m.exec(chunk)?.[1] }))
    .filter((e): e is { event: string; data: string } => !!e.event && !!e.data)
    .map((e) => ({ event: e.event, data: JSON.parse(e.data) }));
}

export type Received = { kind: 'json'; m: VoiceServerMessage; at: number } | { kind: 'bin'; bytes: number; at: number };

export class VoiceTestClient {
  readonly got: Received[] = [];
  private waiters: (() => void)[] = [];
  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data, isBinary) => {
      const at = Date.now();
      if (isBinary) this.got.push({ kind: 'bin', bytes: (data as Buffer).length, at });
      else this.got.push({ kind: 'json', m: JSON.parse(String(data)) as VoiceServerMessage, at });
      for (const w of this.waiters.splice(0)) w();
    });
  }

  static async connect(base: string): Promise<VoiceTestClient> {
    const ws = new WebSocket(base.replace(/^http/, 'ws') + PATHS.brain.voice);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    return new VoiceTestClient(ws);
  }

  json(): VoiceServerMessage[] {
    return this.got.flatMap((g) => (g.kind === 'json' ? [g.m] : []));
  }

  types(): string[] {
    return this.got.map((g) => (g.kind === 'json' ? g.m.type : 'bin'));
  }

  send(m: unknown): void {
    this.ws.send(JSON.stringify(m));
  }

  /** Wait until `pred` holds (re-checked on every message), or fail after `ms`. */
  async waitFor(pred: () => boolean, ms = 4000, what = 'condition'): Promise<void> {
    const deadline = Date.now() + ms;
    while (!pred()) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`timed out waiting for ${what}; got ${JSON.stringify(this.types())}`);
      await new Promise<void>((r) => {
        const t = setTimeout(r, Math.min(left, 50));
        this.waiters.push(() => {
          clearTimeout(t);
          r();
        });
      });
    }
  }

  close(): void {
    this.ws.close();
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

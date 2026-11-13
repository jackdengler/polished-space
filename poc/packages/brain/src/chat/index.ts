/**
 * Phase 2D: streaming chat (`POST /api/chat`, SSE) and live voice
 * (`WS /api/voice`), one conversation for both. See ./pipeline.ts and ./voice.ts.
 *
 * Settings (env, read once when the module is created):
 *   POC_VOICE_BARGE_IN_MS     extra speech before barge-in, ms (default 0: the
 *                             speech service's STT_MIN_SPEECH_MS already applies)
 *   POC_VOICE_PLAYBACK_MARGIN_MS  how long after the estimated end of playback
 *                             the assistant still counts as speaking (default 300)
 *   POC_STT_ENDPOINT_MS       the speech service's STT_ENDPOINT_MS (default 400), used
 *                             only to estimate end of speech in the timings log
 *   POC_CHAT_THINKING         'disabled' (default, fastest first token) or 'adaptive'
 */
import { ChatBody, PATHS, type SpeechToText, type Suggestion, type TextToSpeech } from '@poc/contracts';
import { HttpSpeechToText, HttpTextToSpeech } from '@poc/speech/client';
import { WebSocketServer } from 'ws';
import { HttpProblem } from '../httpProblem';
import { sendJson } from '../server';
import type { ThinkingMode } from '../models';
import type { BrainModule, ModuleContext } from '../modules/types';
import { ChatPipeline, type PipelineOptions } from './pipeline';
import type { ChunkerOptions } from './sentences';
import { VoiceSession } from './voice';

export interface ChatModuleOptions extends PipelineOptions {
  /** Speech clients; default: the speech service at `ctx.config.speechUrl` (or `speechUrl`). */
  stt?: SpeechToText;
  tts?: () => Promise<TextToSpeech>;
  speechUrl?: string;
  bargeInMs?: number;
  playbackMarginMs?: number;
  sttEndpointMs?: number;
  chunker?: ChunkerOptions;
}

function envNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v.trim() === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number (got "${v}")`);
  return n;
}

/** The module, with its parts exposed for tests. */
export interface ChatModule extends BrainModule {
  pipeline(): ChatPipeline;
}

export function createChatModule(opts: ChatModuleOptions = {}): ChatModule {
  let pipeline: ChatPipeline | null = null;
  const sessions = new Set<VoiceSession>();
  let wss: WebSocketServer | null = null;
  const thinkingEnv = process.env.POC_CHAT_THINKING as ThinkingMode | undefined;

  return {
    name: 'chat',
    pipeline() {
      if (!pipeline) throw new Error('chat module not initialised');
      return pipeline;
    },
    init(ctx: ModuleContext) {
      const p = new ChatPipeline(ctx, { thinking: thinkingEnv === 'adaptive' ? 'adaptive' : undefined, ...opts });
      pipeline = p;
      const speechUrl = opts.speechUrl ?? ctx.config.speechUrl;
      const stt = opts.stt ?? new HttpSpeechToText(speechUrl, (e) => ctx.log(`stt: ${e.message}`));
      let ttsClient: Promise<TextToSpeech> | null = null;
      const tts =
        opts.tts ??
        (() => {
          ttsClient ??= HttpTextToSpeech.connect(speechUrl).catch((e) => {
            ttsClient = null; // try again next time
            throw e;
          });
          return ttsClient;
        });
      const voiceOpts = {
        stt,
        tts,
        bargeInMs: opts.bargeInMs ?? envNum('POC_VOICE_BARGE_IN_MS', 0),
        playbackMarginMs: opts.playbackMarginMs ?? envNum('POC_VOICE_PLAYBACK_MARGIN_MS', 300),
        sttEndpointMs: opts.sttEndpointMs ?? envNum('POC_STT_ENDPOINT_MS', 400),
        chunker: opts.chunker,
        log: (m: string) => ctx.log(`voice: ${m}`),
      };

      // The chat history for the Chat tab after a reload (D10): typed and spoken turns, with interrupted markers.
      ctx.routes.add('GET', PATHS.brain.conversation, async ({ res }) => {
        await p.conversation.load();
        sendJson(res, 200, { turns: p.conversation.turns.slice(-100).map(({ messageStart: _a, messageEnd: _b, ...t }) => t) });
      });

      ctx.routes.add('POST', PATHS.brain.chat, async ({ res, body }) => {
        const parsed = ChatBody.safeParse(await body());
        if (!parsed.success) throw new HttpProblem(400, 'expected { text }');
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
        const send = (event: string, data: unknown) => {
          if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        const ac = new AbortController();
        // The client went away before the reply finished: stop the stream; keep what was sent.
        res.on('close', () => {
          if (!res.writableFinished) ac.abort();
        });
        const result = await p.run({
          text: parsed.data.text,
          via: 'text',
          signal: ac.signal,
          handlers: {
            onDelta: (text) => send('delta', { text }),
            onSuggestion: (suggestion: Suggestion) => send('suggestion', { suggestion }),
          },
        });
        if (result.error) send('error', { error: result.error });
        send('done', { text: result.text });
        res.end();
      });

      wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
      ctx.upgrades.add(PATHS.brain.voice, (req, socket, head) => {
        wss!.handleUpgrade(req, socket, head, (ws) => {
          const s = new VoiceSession(ws, ctx, p, voiceOpts);
          sessions.add(s);
          ws.on('close', () => sessions.delete(s));
        });
      });
    },
    async stop() {
      await Promise.all([...sessions].map((s) => s.close()));
      sessions.clear();
      if (wss) {
        for (const c of wss.clients) c.terminate();
        wss.close();
      }
    },
  };
}


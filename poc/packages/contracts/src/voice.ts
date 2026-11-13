import { z } from 'zod';

/**
 * Live voice (plan section 6).
 *
 * Sidebar <-> brain: `WS /api/voice`.
 *   Client -> server: binary frames of PCM16 LE, mono, 16 kHz (20 ms = 640
 *   bytes each), and JSON text frames `VoiceClientMessage`.
 *   Server -> client: JSON text frames `VoiceServerMessage`, and binary audio
 *   frames (PCM16 LE mono at the sample rate given by the latest
 *   `assistant.audio.start`).
 *
 * Brain <-> speech: `WS /stt` (binary PCM16 16 kHz in, JSON `SttEvent` out)
 * and `POST /tts` (`TtsRequest` in, streamed raw PCM16 out, sample rate in
 * the `X-Sample-Rate` response header).
 */

export const VoiceClientMessage = z.discriminatedUnion('type', [
  /** Start listening (mic opened). */
  z.object({ type: z.literal('start') }),
  /** Stop listening (mic closed). Any reply in progress is stopped too. */
  z.object({ type: z.literal('stop') }),
]);
export type VoiceClientMessage = z.infer<typeof VoiceClientMessage>;

export const VoiceServerMessage = z.discriminatedUnion('type', [
  /** Live transcript of what the user is saying; replaces the previous partial. */
  z.object({ type: z.literal('stt.partial'), text: z.string() }),
  /** The user finished an utterance; it now goes through the chat pipeline. */
  z.object({ type: z.literal('stt.final'), text: z.string() }),
  /** Next piece of the assistant's reply text (same as chat `delta`). */
  z.object({ type: z.literal('assistant.delta'), text: z.string() }),
  /** Binary audio frames follow, at this sample rate, until `assistant.done` or `interrupted`. */
  z.object({ type: z.literal('assistant.audio.start'), sampleRate: z.number().int().positive() }),
  /**
   * Barge-in: the user started speaking. The browser must drop its audio queue
   * at once. No audio frame is sent after this until the next `assistant.audio.start`.
   * `spokenText` is the part of the reply kept in history.
   */
  z.object({ type: z.literal('interrupted'), spokenText: z.string() }),
  /** End of the assistant's turn. `text` is the full reply text. */
  z.object({ type: z.literal('assistant.done'), text: z.string() }),
  z.object({ type: z.literal('error'), error: z.string() }),
]);
export type VoiceServerMessage = z.infer<typeof VoiceServerMessage>;

/** Events from the speech service's `/stt` socket (and from `SttStream`). */
export const SttEvent = z.discriminatedUnion('type', [
  /** Voice activity started (used for barge-in). */
  z.object({ type: z.literal('speech_start') }),
  z.object({ type: z.literal('partial'), text: z.string() }),
  /** End of utterance after ~300-500 ms of silence. */
  z.object({ type: z.literal('final'), text: z.string() }),
]);
export type SttEvent = z.infer<typeof SttEvent>;

export const TtsRequest = z.object({ text: z.string().trim().min(1) });
export type TtsRequest = z.infer<typeof TtsRequest>;

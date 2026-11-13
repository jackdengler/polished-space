import { z } from 'zod';
import { IsoDateTime } from './common';

/**
 * Fake Zoom Team Chat, shaped like Zoom's "List user's chat messages"
 * response (`GET /v2/chat/users/{userId}/messages`).
 *
 * POC simplification: real Zoom requires `to_contact` or `to_channel` and
 * lists one conversation at a time. The mock also accepts just `from` and
 * returns messages across all of the user's chats, oldest first, each
 * carrying its `to_contact` or `to_channel`. A V1 connector would loop over
 * conversations behind the same `ChatConnector` interface.
 *
 * The team uses personal chats and general channels only. There are no
 * per-client channels, so the client is tagged per message.
 */

export const ZoomChatMessage = z
  .object({
    id: z.string().min(1),
    message: z.string(),
    /** Sender's email. Messages sent by "me" appear too; the brain should skip its own user's. */
    sender: z.email(),
    sender_display_name: z.string(),
    date_time: IsoDateTime,
    /** Epoch milliseconds (Zoom sends both). */
    timestamp: z.number().int(),
    /** Personal chat: the other person's email (from "me"'s point of view). */
    to_contact: z.email().optional(),
    /** Channel chat: the channel id. */
    to_channel: z.string().optional(),
    /** Not in Zoom's message payload; added by the mock so labels can show "#team-general". */
    channel_name: z.string().optional(),
  })
  .refine((m) => (m.to_contact === undefined) !== (m.to_channel === undefined), {
    message: 'exactly one of to_contact or to_channel',
  });
export type ZoomChatMessage = z.infer<typeof ZoomChatMessage>;
export const ChatMessage = ZoomChatMessage;
export type ChatMessage = ZoomChatMessage;

export const ZoomChatMessageList = z.object({
  from: IsoDateTime.optional(),
  to: IsoDateTime.optional(),
  page_size: z.number().int(),
  next_page_token: z.string(),
  messages: z.array(ZoomChatMessage),
});
export type ZoomChatMessageList = z.infer<typeof ZoomChatMessageList>;

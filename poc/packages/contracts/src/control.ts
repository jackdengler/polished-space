import { z } from 'zod';
import { ClientConfidence, Direction, IsoDateTime, Person, TaskType } from './common';

/**
 * Demo controls on the mocks service (never used by the brain), and the
 * seed's info file.
 */

/**
 * `POST /_control/mail`: drop an email into the fake inbox. The mock fills
 * `id`, `conversationId` (new unless given), `bodyPreview`, and
 * `receivedDateTime` (now unless given; always later than the newest stored
 * message so `gt` cursors never miss it). Responds 201 with the GraphMessage.
 */
export const ControlMailDrop = z.object({
  from: Person,
  /** Defaults to "me". */
  to: z.array(Person).optional(),
  subject: z.string().min(1),
  /** Plain text body. */
  body: z.string().min(1),
  receivedDateTime: IsoDateTime.optional(),
  conversationId: z.string().optional(),
});
export type ControlMailDrop = z.infer<typeof ControlMailDrop>;

/**
 * `POST /_control/chat`: drop a chat message. The mock fills `id`,
 * `date_time`/`timestamp` (now unless given) and, when neither target is
 * given, `to_contact` = `sender` (a personal chat with the sender, which is
 * how Zoom names a 1:1 conversation from "me"'s side). Responds 201 with the
 * ZoomChatMessage.
 */
export const ControlChatDrop = z.object({
  sender: z.email(),
  sender_display_name: z.string().min(1),
  message: z.string().min(1),
  to_contact: z.email().optional(),
  to_channel: z.string().optional(),
  channel_name: z.string().optional(),
  date_time: IsoDateTime.optional(),
});
export type ControlChatDrop = z.infer<typeof ControlChatDrop>;

/**
 * A canned demo message (one-click buttons on the control page, and used by
 * e2e). Exactly one of `mail` / `chat` is set. Served by `GET /_control/canned`
 * from `data/mocks/canned.json`, written by the seed.
 */
export const CannedMessage = z
  .object({
    key: z.string().regex(/^[a-z0-9-]+$/),
    /** Demo-script step it belongs to (section 8), or null for extras. */
    step: z.number().int().min(1).max(11).nullable(),
    /** One line for the button / test name. */
    description: z.string().min(1),
    /** What the brain should do with it, for e2e assertions and humans. Not shown to Claude. */
    expect: z.object({
      clientId: z.string().nullable(),
      confidence: ClientConfidence,
      taskTypes: z.array(TaskType).default([]),
      directions: z.array(Direction).default([]),
      /** Key of the canned message this one repeats (expect duplicateOf). */
      duplicateOfKey: z.string().nullable().default(null),
    }),
    mail: ControlMailDrop.optional(),
    chat: ControlChatDrop.optional(),
  })
  .refine((c) => (c.mail === undefined) !== (c.chat === undefined), { message: 'exactly one of mail or chat' });
export type CannedMessage = z.infer<typeof CannedMessage>;

/** `POST /_control/reset`: restore mocks to the seeded state. Responds `{ ok: true }`. */
export const ControlResetResponse = z.object({ ok: z.literal(true) });

/** `data/seed-info.json`, written by the seed. */
export const SeedInfo = z.object({
  /** When the seed ran (real clock). */
  seededAt: IsoDateTime,
  /** The "now" the seed built relative data from (POC_NOW or the clock). */
  now: IsoDateTime,
  tz: z.string(),
  me: z.object({ id: z.string(), name: z.string(), email: z.email() }),
  internalClientId: z.string(),
  /**
   * Suggested starting cursor for mail and chat intake: items at or before
   * this time are seeded history (context), not new work. Equal to `now`.
   */
  intakeCursor: IsoDateTime,
});
export type SeedInfo = z.infer<typeof SeedInfo>;

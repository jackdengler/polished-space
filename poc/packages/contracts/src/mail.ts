import { z } from 'zod';
import { IsoDateTime, Person } from './common';

/**
 * Fake Outlook mail, shaped like Microsoft Graph v1.0 `message`
 * (https://learn.microsoft.com/graph/api/resources/message). Only the fields
 * the POC uses are modelled. Graph returns more; parsers here keep only these
 * (zod strips unknown keys), so the real API can be swapped in later.
 *
 * POC decision: `body.contentType` is always lower-case `text` or `html`,
 * which is what Graph returns. Graph accepts either case on input.
 */

export const GraphEmailAddress = z.object({ name: z.string(), address: z.email() });
export type GraphEmailAddress = z.infer<typeof GraphEmailAddress>;

export const GraphRecipient = z.object({ emailAddress: GraphEmailAddress });
export type GraphRecipient = z.infer<typeof GraphRecipient>;

export const GraphItemBody = z.object({ contentType: z.enum(['text', 'html']), content: z.string() });
export type GraphItemBody = z.infer<typeof GraphItemBody>;

/** One mail message. `MailMessage` is the name the brain uses for it. */
export const GraphMessage = z.object({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  subject: z.string(),
  from: GraphRecipient,
  toRecipients: z.array(GraphRecipient),
  ccRecipients: z.array(GraphRecipient).default([]),
  receivedDateTime: IsoDateTime,
  sentDateTime: IsoDateTime.optional(),
  body: GraphItemBody,
  /** First ~255 characters of the body as plain text. */
  bodyPreview: z.string(),
  isRead: z.boolean().default(false),
});
export type GraphMessage = z.infer<typeof GraphMessage>;
export const MailMessage = GraphMessage;
export type MailMessage = GraphMessage;

/** Graph collection response: `{ value: [...] }`, optionally with a next link. */
export const graphList = <T extends z.ZodType>(item: T) =>
  z.object({ value: z.array(item), '@odata.nextLink': z.string().optional() });
export const GraphMessageList = graphList(GraphMessage);
export type GraphMessageList = z.infer<typeof GraphMessageList>;

/**
 * Body of `POST /v1.0/me/sendMail`, as Graph defines it. The mock stores the
 * message in its Sent folder (sent.json) and returns 202 with no body.
 */
export const GraphSendMailRequest = z.object({
  message: z.object({
    subject: z.string(),
    body: GraphItemBody,
    toRecipients: z.array(GraphRecipient).min(1),
    ccRecipients: z.array(GraphRecipient).default([]),
  }),
  saveToSentItems: z.boolean().default(true),
});
export type GraphSendMailRequest = z.infer<typeof GraphSendMailRequest>;

/**
 * A reply or new email the assistant drafted. This is the POC's own shape
 * (not Graph). Body is plain text. `replyToMessageId` links the draft to the
 * message it answers; it is not sent to Graph (sendMail has no such field),
 * the subject carries "Re: ..." instead.
 */
export const MailDraft = z
  .object({
    to: z.array(Person).min(1, 'add at least one recipient').max(10, 'at most 10 recipients'),
    cc: z.array(Person).max(10, 'at most 10 people in cc').default([]),
    subject: z.string().trim().min(1, 'add a subject').max(300),
    body: z.string().trim().min(1, 'the message is empty'),
    replyToMessageId: z.string().nullable().default(null),
  })
  .refine((d) => new Set([...d.to, ...d.cc].map((p) => p.address.toLowerCase())).size === d.to.length + d.cc.length, { message: 'the same address is listed twice', path: ['to'] });
export type MailDraft = z.infer<typeof MailDraft>;

const toRecipient = (p: Person): GraphRecipient => ({ emailAddress: { name: p.name, address: p.address } });

/** Turn a draft into the Graph `sendMail` request body. */
export function draftToSendMail(draft: MailDraft): GraphSendMailRequest {
  return {
    message: {
      subject: draft.subject,
      body: { contentType: 'text', content: draft.body },
      toRecipients: draft.to.map(toRecipient),
      ccRecipients: draft.cc.map(toRecipient),
    },
    saveToSentItems: true,
  };
}

/** Graph's bodyPreview: whitespace collapsed, first 255 characters. */
export function makeBodyPreview(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 255);
}

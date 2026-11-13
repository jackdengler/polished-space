/**
 * Seeded mail and chat history (before "now"), and the canned demo messages
 * dropped in live during the demo. History is context, not new work: the
 * brain should start its intake cursor at SeedInfo.intakeCursor (= now).
 */
import { makeBodyPreview, type CannedMessage, type ControlChatDrop, type ControlMailDrop, type GraphMessage, type ZoomChatMessage } from '@poc/contracts';
import { ACME, HARBORLIGHT, QUILLON, TESSERA, contact, me, teammate, DANA, MARCUS, PRIYA, ME } from './people';

type Person = { name: string; address: string };
const HOUR = 3_600_000;

function mail(id: string, conv: string, from: Person, to: Person[], subject: string, body: string, at: Date): GraphMessage {
  return {
    id,
    conversationId: conv,
    subject,
    from: { emailAddress: from },
    toRecipients: to.map((p) => ({ emailAddress: p })),
    ccRecipients: [],
    receivedDateTime: at.toISOString(),
    sentDateTime: at.toISOString(),
    body: { contentType: 'text', content: body },
    bodyPreview: makeBodyPreview(body),
    isRead: true,
  };
}

/** The fake inbox: received mail, oldest first. */
export function buildInbox(now: Date): GraphMessage[] {
  const ago = (h: number) => new Date(now.getTime() - h * HOUR);
  const michael = contact(ACME, 'Michael Okafor');
  const lena = contact(ACME, 'Lena Hartwell');
  const dmitri = contact(HARBORLIGHT, 'Dmitri Vance');
  const priscilla = contact(HARBORLIGHT, 'Priscilla Mbeki');
  const renata = contact(QUILLON, 'Renata Solis');
  const gareth = contact(TESSERA, 'Gareth Lindqvist');
  return [
    mail('poc-mail-1', 'poc-conv-quillon-levels', renata, [me], 'Job levels: timing',
      `Hi Alex,\n\nThanks for the call. We'd like to see the draft job levels before the readout so our engineering leads can react. Anything you can share early is welcome.\n\nRenata`, ago(24 * 8)),
    mail('poc-mail-2', 'poc-conv-tessera-comparators', gareth, [me, teammate(DANA)], 'Comparator groups',
      `Alex, Dana,\n\nBefore you run the model: should warehouse leads sit with the supervisors group or on their own? Our view is on their own, but we'd value your take.\n\nThanks,\nGareth`, ago(24 * 4)),
    mail('poc-mail-3', 'poc-conv-acme-sow', lena, [me], 'Revised SOW?',
      `Hi Alex,\n\nFinance is asking for the revised SOW with the salary structure phase added. Could you send it over this week? Michael will sign once it's in.\n\nBest,\nLena`, ago(24 * 3)),
    mail('poc-mail-4', 'poc-conv-harbor-census', dmitri, [me, teammate(PRIYA)], 'Driver census sample',
      `Hi both,\n\nI've put a sample of the driver census in the shared folder (driver_census_sample.csv). Overtime fields are still missing; payroll is working on them.\n\nDmitri`, ago(48)),
    mail('poc-mail-5', 'poc-conv-harbor-scheduling', priscilla, [me], 'Scheduling for the driver pay review',
      `Hi Alex,\n\nPlease send meeting invites through me so I can hold Dmitri's calendar. Mornings work best for him.\n\nThanks,\nPriscilla`, ago(26)),
    mail('poc-mail-6', 'poc-conv-internal-training', teammate(DANA), [me], 'Training slides',
      `Alex, I've started the pay equity basics slides for the team training. Can you look at the outline before Wednesday?\n\nDana`, ago(20)),
    mail('poc-mail-7', 'poc-conv-acme-pricing', michael, [me], 'Thanks for the kickoff',
      `Alex,\n\nGood to get going. Our board meets at the start of next month, so the pricing summary matters. Lena is your day-to-day contact; loop me in on anything about scope.\n\nMichael`, ago(24 * 12)),
  ].sort((a, b) => a.receivedDateTime.localeCompare(b.receivedDateTime));
}

/**
 * The fake Sent folder. Two of these went unanswered, which gives the demo
 * someone quiet to chase: Michael (job match sign-off) and Renata (job levels).
 */
export function buildSent(now: Date): GraphMessage[] {
  const ago = (h: number) => new Date(now.getTime() - h * HOUR);
  return [
    mail('poc-sent-1', 'poc-conv-quillon-levels', me, [contact(QUILLON, 'Renata Solis')], 'Job levels draft for your review',
      `Hi Renata,\n\nAttached is the draft job levels framework (Job Levels Draft in the shared folder). Could you send feedback by the end of the week, especially on the staff and principal engineer levels?\n\nThanks,\nAlex`, ago(24 * 6)),
    mail('poc-sent-2', 'poc-conv-acme-matches', me, [contact(ACME, 'Michael Okafor')], 'Job match sign-off',
      `Hi Michael,\n\nThe benchmark job matches are ready for sign-off. Two roles have weak matches, flagged in the file. Could you confirm you're comfortable so we can finalise the pricing summary?\n\nBest,\nAlex`, ago(24 * 5)),
  ];
}

function chat(id: string, from: { name: string; email: string }, text: string, at: Date, target: { to_contact: string } | { to_channel: string; channel_name: string }): ZoomChatMessage {
  return { id, message: text, sender: from.email, sender_display_name: from.name, date_time: at.toISOString(), timestamp: at.getTime(), ...target };
}

/** Personal chats with teammates plus one general channel. No per-client channels. */
export function buildChat(now: Date): ZoomChatMessage[] {
  const ago = (h: number) => new Date(now.getTime() - h * HOUR);
  // to_contact is the other person in a 1:1 chat, seen from "me"'s side.
  const withP = (t: { email: string }) => ({ to_contact: t.email });
  const general = { to_channel: 'poc-channel-team-general', channel_name: 'team-general' };
  return [
    chat('poc-chat-1', PRIYA, 'Tess call moved to Thursday, I updated the invite.', ago(50), withP(PRIYA)),
    chat('poc-chat-2', ME, 'Thanks Priya!', ago(49.5), withP(PRIYA)),
    chat('poc-chat-3', MARCUS, 'Acme matches are in the folder. Two jobs still weak: maintenance planner and CNC lead.', ago(22), withP(MARCUS)),
    chat('poc-chat-4', DANA, 'Reminder: timesheets due Friday.', ago(6), general),
    chat('poc-chat-5', PRIYA, 'Did you see Priscilla wants invites to go through her for Dmitri?', ago(3), withP(PRIYA)),
  ];
}

/** Canned demo messages (control page buttons and e2e). */
export function buildCanned(): CannedMessage[] {
  const michael = contact(ACME, 'Michael Okafor');
  const dmitri = contact(HARBORLIGHT, 'Dmitri Vance');
  const gareth = contact(TESSERA, 'Gareth Lindqvist');
  const m = (drop: ControlMailDrop) => drop;
  const ch = (from: { name: string; email: string }, message: string): ControlChatDrop => ({ sender: from.email, sender_display_name: from.name, message, to_contact: from.email });
  return [
    {
      key: 'acme-update-and-meeting',
      step: 2,
      description: 'Michael Okafor (Acme) asks for an update and a meeting',
      expect: { clientId: ACME.id, confidence: 'high', taskTypes: ['reply_email', 'schedule_meeting'], directions: ['i_owe'], duplicateOfKey: null },
      mail: m({
        from: michael,
        subject: 'Market pricing: where are we? And time to meet',
        body: `Hi Alex,\n\nCould you send me a quick update on where the market pricing analysis stands? Our board pack closes soon and I want to know if the summary will be ready.\n\nI'd also like to get 45 minutes with you next week to walk through the early numbers. Tuesday or Wednesday afternoon would suit me best.\n\nThanks,\nMichael`,
      }),
    },
    {
      key: 'harbor-file-review',
      step: 5,
      description: 'Priya mentions "Harbor" and a file to review (Zoom)',
      expect: { clientId: HARBORLIGHT.id, confidence: 'high', taskTypes: ['review_file'], directions: ['i_owe'], duplicateOfKey: null },
      chat: ch(PRIYA, 'Harbor sent over "HLF Driver Pay Structure Draft.pdf". Can you give it a read before Thursday? They want our take on the regional differentials.'),
    },
    {
      key: 'ambiguous-robo-team',
      step: 5,
      description: 'Marcus mentions "the robo team" (no client named; should land in Inbox)',
      expect: { clientId: QUILLON.id, confidence: 'low', taskTypes: [], directions: [], duplicateOfKey: null },
      chat: ch(MARCUS, 'The robo team asked again whether the revised levels are coming this week. Want me to chase anything on our side?'),
    },
    {
      key: 'acme-update-repeat',
      step: 5,
      description: 'Michael repeats the step 2 ask in different words (should be a duplicate)',
      expect: { clientId: ACME.id, confidence: 'high', taskTypes: ['reply_email', 'schedule_meeting'], directions: ['i_owe'], duplicateOfKey: 'acme-update-and-meeting' },
      mail: m({
        from: michael,
        subject: 'Following up',
        body: `Alex, just checking in again. How is the pricing work coming along? And let's lock in a time to talk it through next week.\n\nMichael`,
      }),
    },
    {
      key: 'harbor-census-owed',
      step: 5,
      description: 'Dmitri promises the updated census by Wednesday (an "owed to me" task)',
      expect: { clientId: HARBORLIGHT.id, confidence: 'high', taskTypes: [], directions: ['owed_to_me'], duplicateOfKey: null },
      mail: m({
        from: dmitri,
        subject: 'Updated driver census',
        body: `Hi Alex,\n\nPayroll has pulled the overtime fields. We'll send you the updated driver census by Wednesday.\n\nDmitri`,
      }),
    },
    {
      key: 'tessera-quick-question',
      step: null,
      description: 'Gareth asks a quick question (an easy reply)',
      expect: { clientId: TESSERA.id, confidence: 'high', taskTypes: ['reply_email'], directions: ['i_owe'], duplicateOfKey: null },
      mail: m({
        from: gareth,
        subject: 'Quick one on the memo',
        body: `Alex, will the pay equity memo include a recommended budget for adjustments, or just the findings? Need to tell our CFO.\n\nGareth`,
      }),
    },
  ];
}

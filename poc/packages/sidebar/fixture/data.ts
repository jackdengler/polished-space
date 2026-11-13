/**
 * Fixture data for the sidebar's stand-in brain. Every person, company and
 * address is invented (the same invented clients as poc/seed). Dates are
 * built relative to the fixture's "now" so the sections always fill.
 */
import {
  addDaysIso,
  nextWeekday,
  renderProfile,
  profileSlug,
  toGraphDateTime,
  weekStart,
  zonedTime,
  type CalEvent,
  type MailDraft,
  type Nudge,
  type PreparedStatus,
  type PreparedWork,
  type SidebarTask,
  type Suggestion,
  type UsageSummary,
} from '@poc/contracts';

export const ME = { id: 'poc-member-alex', name: 'Alex Rivera', address: 'alex.rivera@brightline-advisory.example' };
export const INTERNAL_ID = 'poc-client-internal';

export const CLIENTS = [
  { id: 'poc-client-acme', name: 'Acme Tooling Co.' },
  { id: 'poc-client-harborlight', name: 'Harborlight Freight' },
  { id: 'poc-client-quillon', name: 'Quillon Robotics' },
  { id: 'poc-client-tessera', name: 'Tessera Foods' },
  { id: INTERNAL_ID, name: 'Internal' },
];
export const clientName = (id: string) => CLIENTS.find((c) => c.id === id)?.name ?? id;

const P = {
  michael: { name: 'Michael Okafor', address: 'michael.okafor@acmetooling.example' },
  lena: { name: 'Lena Hartwell', address: 'lena.hartwell@acmetooling.example' },
  dmitri: { name: 'Dmitri Vance', address: 'dmitri.vance@harborlight.example' },
  priscilla: { name: 'Priscilla Mbeki', address: 'priscilla.mbeki@harborlight.example' },
  renata: { name: 'Renata Solis', address: 'renata.solis@quillon.example' },
  gareth: { name: 'Gareth Lindqvist', address: 'gareth.lindqvist@tesserafoods.example' },
};
export const PEOPLE = P;

export interface TaskRec extends SidebarTask {
  prepared: PreparedWork | null;
  /** When preparing: the ms timestamp it becomes ready. */
  readyAt?: number;
}

const draft = (to: { name: string; address: string }[], subject: string, body: string, replyTo: string | null = null): MailDraft => ({
  to,
  cc: [],
  subject,
  body,
  replyToMessageId: replyTo,
});

export interface FixtureWorld {
  tasks: TaskRec[];
  suggestions: Suggestion[];
  nudges: Nudge[];
  calendar: CalEvent[];
  usage: UsageSummary;
  profiles: { clientId: string; clientName: string; slug: string; updatedAt: string; markdown: string }[];
}

export function buildWorld(now: Date, tz = 'UTC'): FixtureWorld {
  const nowIso = now.toISOString();
  const today = nowIso.slice(0, 10);
  const at = (day: string, h: number, m = 0) => zonedTime(day, h * 60 + m, tz).toISOString();
  const minsAgo = (n: number) => new Date(now.getTime() - n * 60000).toISOString();
  const nextMon = addDaysIso(weekStart(today), 7);

  const base = (t: Partial<TaskRec> & Pick<TaskRec, 'taskId' | 'title' | 'clientId'>): TaskRec => ({
    clientName: clientName(t.clientId),
    dueDate: null,
    done: false,
    assigneeIds: [ME.id],
    taskType: 'other',
    direction: 'i_owe',
    onHold: false,
    order: null,
    quickWin: false,
    reason: null,
    source: null,
    preparedStatus: 'none' as PreparedStatus,
    preparedSuggestionId: null,
    prepared: null,
    ...t,
  });

  const tasks: TaskRec[] = [
    base({
      taskId: 't-acme-pricing',
      title: 'Send Michael the revised market pricing summary',
      clientId: 'poc-client-acme',
      dueDate: today,
      taskType: 'reply_email',
      order: 0,
      reason: 'Michael has asked twice and you meet Acme on Friday. Draft is ready to send.',
      source: { connector: 'mail', id: 'mail-1001', label: 'Email from Michael Okafor: Pricing summary?', threadId: 'conv-acme-1' },
      preparedStatus: 'ready',
      preparedSuggestionId: 'sg-prep-acme-pricing',
      prepared: {
        type: 'reply_email',
        draft: draft(
          [P.michael],
          'Re: Pricing summary?',
          'Hi Michael,\n\nThanks for your patience. Attached is the revised market pricing summary (draft v2). The main change is the updated survey cut for the engineering roles, which moves the midpoints up about 3%.\n\nHappy to walk through it on Friday, or sooner if that helps.\n\nBest,\nAlex',
          'mail-1001',
        ),
      },
    }),
    base({
      taskId: 't-quill-levels',
      title: 'Review the Quillon job levels draft',
      clientId: 'poc-client-quillon',
      dueDate: today,
      taskType: 'review_file',
      order: 1,
      reason: 'Fits the free hour before your 11:30 call.',
      source: { connector: 'files', id: 'Quillon Robotics/Job Levels Draft.md', label: 'Job Levels Draft.md' },
      preparedStatus: 'ready',
      preparedSuggestionId: 'sg-prep-quill-levels',
      prepared: {
        type: 'review_file',
        path: 'Quillon Robotics/Job Levels Draft.md',
        summary:
          'A six-level framework for engineering, from Associate Engineer to Principal. Scope and impact are well defined; the jump from Senior to Staff leans on title rather than scope, and two levels share the same pay range.',
        keyPoints: [
          'Levels 4 and 5 share one pay range, which will cause compression.',
          'Staff criteria are about tenure; Renata asked for scope-based criteria.',
          'Manager track is missing; the call notes say it is needed by Q1.',
        ],
      },
    }),
    base({
      taskId: 't-tess-chase',
      title: 'Chase Gareth for the comparator group data',
      clientId: 'poc-client-tessera',
      dueDate: today,
      taskType: 'follow_up',
      direction: 'owed_to_me',
      order: 2,
      quickWin: true,
      reason: 'Two-minute email and it unblocks the pay equity memo.',
      source: { connector: 'chat', id: 'chat-2201', label: 'Chat with Dana Kim' },
      preparedStatus: 'ready',
      preparedSuggestionId: 'sg-prep-tess-chase',
      prepared: {
        type: 'follow_up',
        draft: draft(
          [P.gareth],
          'Comparator group data',
          'Hi Gareth,\n\nJust checking in on the comparator group file we discussed last week. Once we have it, we can finish the pay equity memo outline.\n\nWould end of day Monday work?\n\nThanks,\nAlex',
        ),
      },
    }),
    base({
      taskId: 't-harbor-meet',
      title: 'Set up the driver census review with Dmitri',
      clientId: 'poc-client-harborlight',
      dueDate: today,
      taskType: 'schedule_meeting',
      order: 3,
      reason: 'Dmitri asked to meet this week; two of the slots are tomorrow.',
      source: { connector: 'mail', id: 'mail-1002', label: 'Email from Dmitri Vance: Census review', threadId: 'conv-harbor-1' },
      preparedStatus: 'ready',
      preparedSuggestionId: 'sg-prep-harbor-meet',
      prepared: {
        type: 'schedule_meeting',
        slots: [
          { start: at(addDaysIso(today, 1), 10), end: at(addDaysIso(today, 1), 10, 45) },
          { start: at(addDaysIso(today, 1), 14), end: at(addDaysIso(today, 1), 14, 45) },
          { start: at(addDaysIso(today, 2), 9, 30), end: at(addDaysIso(today, 2), 10, 15) },
        ],
        draft: draft(
          [P.dmitri],
          'Re: Census review',
          'Hi Dmitri,\n\nHappy to go through the driver census together. Any of these work on my side:\n\n- Tomorrow 10:00–10:45\n- Tomorrow 14:00–14:45\n\nLet me know which suits and I will send an invite.\n\nBest,\nAlex',
          'mail-1002',
        ),
      },
    }),
    base({
      taskId: 't-acme-survey',
      title: 'Pull together notes for the Acme benefits survey',
      clientId: 'poc-client-acme',
      dueDate: today,
      taskType: 'other',
      order: 4,
      reason: 'Background work; no deadline pressure today.',
      preparedStatus: 'ready',
      preparedSuggestionId: 'sg-prep-acme-survey',
      prepared: {
        type: 'other',
        context: [
          { label: 'From the kickoff notes', text: 'Acme wants a benefits benchmark against 12 regional manufacturers, results by end of quarter.', source: { connector: 'files', id: 'Acme Tooling/Kickoff notes.txt', label: 'Kickoff notes.txt' } },
          { label: 'Lena, by email', text: 'Lena can share last year’s survey responses once legal signs off, probably next week.', source: { connector: 'mail', id: 'mail-0950', label: 'Email from Lena Hartwell: Survey data' } },
          { label: 'Client profile', text: 'Prefers calls to long emails. Reports due by the 1st of each month.', source: null },
        ],
      },
    }),
    base({
      taskId: 't-tess-outline',
      title: 'Send Tessera the pay equity memo outline',
      clientId: 'poc-client-tessera',
      dueDate: addDaysIso(today, -2),
      taskType: 'reply_email',
      source: { connector: 'mail', id: 'mail-0901', label: 'Email from Gareth Lindqvist: Memo outline' },
    }),
    base({ taskId: 't-harbor-gaps', title: 'Look into gaps in the Harbor driver census', clientId: 'poc-client-harborlight', taskType: 'review_file', source: { connector: 'chat', id: 'chat-2150', label: 'Chat with Priya Shah' } }),
    base({ taskId: 't-quill-bonus', title: 'Quillon bonus plan redesign', clientId: 'poc-client-quillon', dueDate: addDaysIso(today, 3), onHold: true }),
    base({ taskId: 't-acme-friday', title: 'Prep slides for Friday’s Acme check-in', clientId: 'poc-client-acme', dueDate: addDaysIso(today, 1) }),
    base({ taskId: 't-harbor-plan', title: 'Update the Harborlight project plan', clientId: 'poc-client-harborlight', dueDate: addDaysIso(today, 2) }),
    base({ taskId: 't-tess-data', title: 'Confirm data request with Gareth', clientId: 'poc-client-tessera', dueDate: addDaysIso(today, 2), direction: 'owed_to_me', taskType: 'follow_up' }),
    base({ taskId: 't-quill-titles', title: 'Map engineering titles to the new levels', clientId: 'poc-client-quillon', dueDate: addDaysIso(nextMon, 1) }),
    base({ taskId: 't-acme-final', title: 'Final market pricing report to Acme', clientId: 'poc-client-acme', dueDate: addDaysIso(nextMon, 9), taskType: 'reply_email' }),
    base({ taskId: 't-harbor-qbr', title: 'Harborlight quarterly review deck', clientId: 'poc-client-harborlight', dueDate: addDaysIso(nextMon, 16) }),
    base({ taskId: 't-int-util', title: 'Update the team utilisation tracker', clientId: INTERNAL_ID, dueDate: addDaysIso(today, 1) }),
    base({ taskId: 't-int-train', title: 'Book the survey tools training', clientId: INTERNAL_ID }),
  ];

  const sg = (s: Omit<Suggestion, 'status' | 'decidedAt' | 'error' | 'clientConfidence' | 'nudge'> & Partial<Pick<Suggestion, 'status' | 'error' | 'clientConfidence' | 'nudge'>>): Suggestion =>
    ({ status: 'pending', decidedAt: null, error: null, clientConfidence: 'high', nudge: '', ...s }) as Suggestion;

  const mailSrc = { connector: 'mail' as const, id: 'mail-1010', label: 'Email from Michael Okafor: Update and a meeting?', threadId: 'conv-acme-2' };
  const fitStart = at(today, 10);
  const lunchStart = at(today, 12, 30);

  const suggestions: Suggestion[] = [
    // Prepared work, one per prepared task (contract: TaskMeta.preparedSuggestionId).
    sg({ id: 'sg-prep-acme-pricing', kind: 'send_reply', title: 'Send the pricing summary to Michael', clientId: 'poc-client-acme', source: tasks[0]!.source, taskType: 'reply_email', createdAt: minsAgo(50), payload: { draft: (tasks[0]!.prepared as { draft: MailDraft }).draft, taskId: 't-acme-pricing' } }),
    sg({ id: 'sg-prep-quill-levels', kind: 'complete_task', title: 'Mark the job levels review done', clientId: 'poc-client-quillon', source: tasks[1]!.source, taskType: 'review_file', createdAt: minsAgo(45), payload: { taskId: 't-quill-levels' } }),
    sg({ id: 'sg-prep-tess-chase', kind: 'send_reply', title: 'Send the chaser to Gareth', clientId: 'poc-client-tessera', source: tasks[2]!.source, taskType: 'follow_up', direction: 'owed_to_me', createdAt: minsAgo(44), payload: { draft: (tasks[2]!.prepared as { draft: MailDraft }).draft, taskId: 't-tess-chase' } }),
    sg({ id: 'sg-prep-harbor-meet', kind: 'send_reply', title: 'Offer Dmitri times for the census review', clientId: 'poc-client-harborlight', source: tasks[3]!.source, taskType: 'schedule_meeting', createdAt: minsAgo(40), payload: { draft: (tasks[3]!.prepared as { draft: MailDraft }).draft, taskId: 't-harbor-meet' } }),
    sg({ id: 'sg-prep-acme-survey', kind: 'complete_task', title: 'Mark the survey notes done', clientId: 'poc-client-acme', source: null, taskType: 'other', createdAt: minsAgo(38), payload: { taskId: 't-acme-survey' } }),

    // From Michael's new email (the demo's step 2-3).
    sg({ id: 'sg-acme-update', kind: 'create_task', title: 'Send Michael a project status update', clientId: 'poc-client-acme', source: mailSrc, direction: 'i_owe', taskType: 'reply_email', createdAt: minsAgo(2), payload: { title: 'Send Michael a project status update', dueDate: today, assigneeIds: [ME.id] } }),
    sg({ id: 'sg-acme-meet', kind: 'create_task', title: 'Find a time to meet Michael next week', clientId: 'poc-client-acme', source: mailSrc, direction: 'i_owe', taskType: 'schedule_meeting', createdAt: minsAgo(2), payload: { title: 'Find a time to meet Michael next week', dueDate: addDaysIso(today, 1), assigneeIds: [ME.id] } }),
    sg({ id: 'sg-acme-dup', kind: 'create_task', title: 'Send Michael the pricing summary', clientId: 'poc-client-acme', source: mailSrc, direction: 'i_owe', taskType: 'reply_email', duplicateOf: { kind: 'task', id: 't-acme-pricing' }, createdAt: minsAgo(2), payload: { title: 'Send Michael the pricing summary', dueDate: today, assigneeIds: [ME.id] } }),

    // Calendar awareness.
    sg({ id: 'sg-lunch', kind: 'calendar_block', title: 'Block 30 minutes for lunch', clientId: null, source: { connector: 'calendar', id: 'cal-today', label: 'Your calendar today' }, createdAt: minsAgo(6), payload: { subject: 'Lunch', start: lunchStart, end: at(today, 13), purpose: 'lunch', taskId: null } }),
    sg({ id: 'sg-focus', kind: 'calendar_block', title: 'Hold 10:00–11:00 to review the job levels draft', clientId: 'poc-client-quillon', source: { connector: 'calendar', id: 'cal-today', label: 'Your calendar today' }, createdAt: minsAgo(6), payload: { subject: 'Focus: Quillon job levels review', start: fitStart, end: at(today, 11), purpose: 'focus', taskId: 't-quill-levels' } }),

    // Zoom chat with no clear client: Inbox.
    sg({ id: 'sg-confirm', kind: 'confirm_client', title: 'Is “the robo team” Quillon Robotics?', nudge: 'Priya mentioned “the robo team” in chat. I think that’s Quillon, but want to check.', clientId: null, clientConfidence: 'low', source: { connector: 'chat', id: 'chat-2230', label: 'Chat with Priya Shah' }, createdAt: minsAgo(12), payload: { candidateClientIds: ['poc-client-quillon', 'poc-client-harborlight'], alias: 'the robo team', relatedSuggestionIds: ['sg-robo-deck'] } }),
    sg({ id: 'sg-robo-deck', kind: 'create_task', title: 'Send the robo team the levelling deck', nudge: 'From Priya’s chat: someone owes “the robo team” the levelling deck.', clientId: null, clientConfidence: 'low', source: { connector: 'chat', id: 'chat-2230', label: 'Chat with Priya Shah' }, direction: 'i_owe', taskType: 'other', createdAt: minsAgo(12), payload: { title: 'Send the robo team the levelling deck', dueDate: null, assigneeIds: [ME.id] } }),

    // Other kinds, standing alone.
    sg({ id: 'sg-reschedule', kind: 'reschedule_task', title: 'Move the Harborlight project plan to Monday', nudge: 'Priscilla said their numbers will be late, so the plan update can wait until Monday.', clientId: 'poc-client-harborlight', source: { connector: 'chat', id: 'chat-2241', label: 'Chat with Priscilla Mbeki' }, createdAt: minsAgo(20), payload: { taskId: 't-harbor-plan', dueDate: nextMon } }),
    sg({ id: 'sg-complete', kind: 'complete_task', title: 'Mark “Confirm data request with Gareth” done', nudge: 'Gareth confirmed the data request in his reply this morning.', clientId: 'poc-client-tessera', source: { connector: 'mail', id: 'mail-1005', label: 'Email from Gareth Lindqvist: Re: Data request' }, createdAt: minsAgo(25), payload: { taskId: 't-tess-data' } }),
    sg({ id: 'sg-reply', kind: 'send_reply', title: 'Reply to Renata about the call notes', nudge: 'Renata asked whether the call notes went out. Here’s a short reply.', clientId: 'poc-client-quillon', source: { connector: 'mail', id: 'mail-1007', label: 'Email from Renata Solis: Call notes?' }, direction: 'i_owe', taskType: 'reply_email', createdAt: minsAgo(30), payload: { draft: draft([P.renata], 'Re: Call notes?', 'Hi Renata,\n\nYes, they went out yesterday afternoon. I have re-sent them just in case, with the levels draft attached.\n\nBest,\nAlex', 'mail-1007'), taskId: null } }),
    sg({ id: 'sg-failed', kind: 'reschedule_task', status: 'failed', error: 'The PM app did not answer in time, so nothing was changed.', title: 'Move “Update the team utilisation tracker” to Friday', clientId: INTERNAL_ID, source: { connector: 'manual', id: 'manual-77', label: 'You typed it' }, createdAt: minsAgo(35), payload: { taskId: 't-int-util', dueDate: addDaysIso(today, 2) } }),
  ];

  const nudges: Nudge[] = [
    {
      id: 'n-acme',
      kind: 'new_item',
      text: 'Michael Okafor just emailed asking for a status update and a meeting next week. Want me to set up the tasks and find times?',
      createdAt: minsAgo(2),
      source: mailSrc,
      suggestionIds: ['sg-acme-update', 'sg-acme-meet', 'sg-acme-dup'],
      taskId: null,
    },
    {
      id: 'n-fit',
      kind: 'fit_now',
      text: 'You’ve got a free hour before your 11:30 with Harborlight. Good time to review the Quillon job levels draft. Shall I block it, and lunch at 12:30?',
      createdAt: minsAgo(6),
      source: { connector: 'calendar', id: 'cal-today', label: 'Your calendar today' },
      suggestionIds: ['sg-focus', 'sg-lunch'],
      taskId: 't-quill-levels',
    },
    {
      id: 'n-robo',
      kind: 'new_item',
      text: 'Priya mentioned “the robo team” in chat. I think that’s Quillon Robotics, but I want to check before I file it.',
      createdAt: minsAgo(12),
      source: { connector: 'chat', id: 'chat-2230', label: 'Chat with Priya Shah' },
      suggestionIds: [],
      taskId: null,
    },
  ];

  const ev = (id: string, subject: string, s: string, e: string, extra: Partial<CalEvent> = {}): CalEvent => ({
    id,
    subject,
    start: toGraphDateTime(s),
    end: toGraphDateTime(e),
    attendees: [],
    showAs: 'busy',
    isAllDay: false,
    categories: [],
    bodyPreview: '',
    ...extra,
  });
  const calendar: CalEvent[] = [
    ev('ev-standup', 'Team stand-up', at(today, 9), at(today, 9, 15)),
    ev('ev-harbor', 'Harborlight weekly', at(today, 11, 30), at(today, 12, 15)),
    ev('ev-acme', 'Acme pricing review', at(today, 15), at(today, 16)),
  ];

  const usage: UsageSummary = {
    day: today,
    calls: 23,
    inputTokens: 61840,
    outputTokens: 9120,
    cacheCreationInputTokens: 12400,
    cacheReadInputTokens: 38800,
    estUsd: 0.4134,
    byCall: {
      triage: { calls: 14, inputTokens: 38200, outputTokens: 4100, cacheCreationInputTokens: 8000, cacheReadInputTokens: 26000, estUsd: 0.21 },
      prioritise: { calls: 5, inputTokens: 12000, outputTokens: 1600, cacheCreationInputTokens: 2400, cacheReadInputTokens: 9800, estUsd: 0.06 },
      prepare: { calls: 4, inputTokens: 11640, outputTokens: 3420, cacheCreationInputTokens: 2000, cacheReadInputTokens: 3000, estUsd: 0.1434 },
    },
  };

  const profiles = [
    {
      clientId: 'poc-client-acme',
      clientName: 'Acme Tooling Co.',
      content: {
        'Also known as': ['Acme', 'ATC'],
        'Key contacts': ['Michael Okafor (VP HR): owns the engagement, signs off on reports', 'Lena Hartwell (Compensation Manager): day-to-day data and survey questions'],
        'Active projects': ['Market pricing study: draft v2 with Michael, final due in two weeks', 'Benefits survey: kickoff done, waiting on last year’s data'],
        'Commitments: we owe': ['Revised pricing summary to Michael (today)', 'Status update and meeting times to Michael (asked today)'],
        'Commitments: they owe': ['Lena: last year’s survey responses, after legal sign-off'],
        'Preferences and quirks': ['Prefers calls to long emails', 'Reports due by the 1st of each month'],
        'Recent decisions': ['Use the regional manufacturing survey cut for engineering roles'],
        'Change log': [`${minsAgo(2)} Added: status update and meeting request from Michael`, `${minsAgo(90)} Added: Lena owes survey data`],
      },
    },
    {
      clientId: 'poc-client-harborlight',
      clientName: 'Harborlight Freight',
      content: {
        'Also known as': ['Harbor', 'HLF'],
        'Key contacts': ['Dmitri Vance (Director of Total Rewards)', 'Priscilla Mbeki (HR Business Partner)'],
        'Active projects': ['Driver pay census review: sample received, gaps being checked'],
        'Commitments: we owe': ['Census review call with Dmitri this week'],
        'Commitments: they owe': ['Priscilla: updated headcount numbers (running late)'],
        'Preferences and quirks': [],
        'Recent decisions': [],
        'Change log': [`${minsAgo(20)} Priscilla’s numbers will be late`],
      },
    },
    {
      clientId: 'poc-client-quillon',
      clientName: 'Quillon Robotics',
      content: {
        'Also known as': ['Quill'],
        'Key contacts': ['Renata Solis (Head of People)'],
        'Active projects': ['Engineering job levels: draft under review'],
        'Commitments: we owe': ['Job levels review notes to Renata'],
        'Commitments: they owe': [],
        'Preferences and quirks': ['Wants scope-based level criteria, not tenure'],
        'Recent decisions': [],
        'Change log': [],
      },
    },
    {
      clientId: 'poc-client-tessera',
      clientName: 'Tessera Foods',
      content: {
        'Also known as': ['Tess', 'TF'],
        'Key contacts': ['Gareth Lindqvist (Reward Lead)'],
        'Active projects': ['Pay equity review: memo outline in progress'],
        'Commitments: we owe': ['Pay equity memo outline (overdue)'],
        'Commitments: they owe': ['Gareth: comparator group data'],
        'Preferences and quirks': [],
        'Recent decisions': [],
        'Change log': [],
      },
    },
  ].map((p) => ({ clientId: p.clientId, clientName: p.clientName, slug: profileSlug(p.clientName), updatedAt: minsAgo(2), markdown: renderProfile(p.clientName, p.content) }));

  return { tasks, suggestions, nudges, calendar, usage, profiles };
}

/** The canned "new email" dropped live by `POST /__fixture/drop`. */
export function droppedEmail(now: Date, n: number): { nudge: Nudge; suggestions: Suggestion[] } {
  const nowIso = now.toISOString();
  const today = nowIso.slice(0, 10);
  const src = { connector: 'mail' as const, id: `mail-drop-${n}`, label: 'Email from Lena Hartwell: Survey data is ready', threadId: `conv-drop-${n}` };
  const suggestion: Suggestion = {
    id: `sg-drop-${n}`,
    kind: 'create_task',
    status: 'pending',
    title: 'Review Lena’s survey responses',
    nudge: '',
    clientId: 'poc-client-acme',
    clientConfidence: 'high',
    source: src,
    direction: 'i_owe',
    taskType: 'review_file',
    duplicateOf: null,
    createdAt: nowIso,
    decidedAt: null,
    error: null,
    payload: { title: 'Review Lena’s survey responses', dueDate: today, assigneeIds: [ME.id] },
  };
  return {
    nudge: { id: `n-drop-${n}`, kind: 'new_item', text: 'Lena Hartwell just sent last year’s survey responses. Want me to add a review task for today?', createdAt: nowIso, source: src, suggestionIds: [suggestion.id], taskId: null },
    suggestions: [suggestion],
  };
}

export function fridayOf(today: string): string {
  return nextWeekday(today, 4);
}

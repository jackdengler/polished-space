/**
 * One valid and one invalid sample for every schema. The contracts tests
 * parse all of them; other packages can reuse the valid ones as fixtures
 * (e.g. the sidebar's fixture brain). All names and domains are invented.
 */
import type { z } from 'zod';
import * as c from '../index';

const NOW = '2026-11-13T09:00:00.000Z';
const michael = { name: 'Michael Okafor', address: 'michael.okafor@acmetooling.example' };
const alex = { name: 'Alex Rivera', address: 'alex.rivera@brightline-advisory.example' };
const draft = { to: [michael], cc: [], subject: 'Re: Pricing update', body: 'Hi Michael, here is where we are.', replyToMessageId: 'mail-1' };
const source = { connector: 'mail' as const, id: 'mail-1', label: 'Email from Michael Okafor: Pricing update', threadId: 'conv-1' };

const graphMessage = {
  id: 'mail-1',
  conversationId: 'conv-1',
  subject: 'Pricing update',
  from: { emailAddress: michael },
  toRecipients: [{ emailAddress: alex }],
  ccRecipients: [],
  receivedDateTime: NOW,
  body: { contentType: 'text', content: 'Could you send an update?' },
  bodyPreview: 'Could you send an update?',
  isRead: false,
};
const calEvent = {
  id: 'evt-1',
  subject: 'Acme Tooling check-in',
  start: { dateTime: '2026-11-13T15:00:00.0000000', timeZone: 'UTC' },
  end: { dateTime: '2026-11-13T15:30:00.0000000', timeZone: 'UTC' },
  attendees: [{ emailAddress: michael, type: 'required' }],
  showAs: 'busy',
  isAllDay: false,
  categories: [],
  bodyPreview: '',
};
const chatMessage = {
  id: 'chat-1',
  message: 'Harbor wants the driver pay draft by Thursday.',
  sender: 'priya.shah@brightline-advisory.example',
  sender_display_name: 'Priya Shah',
  date_time: NOW,
  timestamp: Date.parse(NOW),
  to_contact: alex.address,
};
const fileInfo = { path: 'Acme Tooling/benchmark_matches.csv', name: 'benchmark_matches.csv', folder: 'Acme Tooling', size: 120, modified: NOW, mimeType: 'text/csv' };
const pmTask = {
  id: 'task-1',
  title: 'Reply to Michael about pricing',
  done: false,
  dueDate: '2026-11-13',
  assigneeIds: ['poc-member-alex'],
  clientId: 'poc-client-acme',
  clientName: 'Acme Tooling Co.',
  boardId: 'adhoc',
  boardLabel: 'Ad-hoc',
  deliverableId: 'deliv-1',
  deliverableTitle: 'General',
  updatedAt: NOW,
};
const pmClient = {
  id: 'poc-client-acme',
  name: 'Acme Tooling Co.',
  archived: false,
  nicknames: ['Acme', 'ATC'],
  emailDomains: ['acmetooling.example'],
  contacts: [{ name: 'Michael Okafor', email: michael.address, role: 'VP HR' }],
  fileFolder: 'Acme Tooling',
  projects: [{ meetingId: 'm-1', title: 'Market data review', date: { kind: 'exact', date: '2026-11-20' }, deliverables: ['Market pricing analysis'] }],
};
const suggestion = {
  id: 'sug-1',
  kind: 'create_task',
  status: 'pending',
  title: 'Reply to Michael about the pricing update',
  nudge: 'Michael just asked where the pricing work stands. Want me to draft a reply?',
  clientId: 'poc-client-acme',
  clientConfidence: 'high',
  source,
  direction: 'i_owe',
  taskType: 'reply_email',
  duplicateOf: null,
  payload: { title: 'Reply to Michael about pricing', dueDate: '2026-11-13', assigneeIds: ['poc-member-alex'] },
  createdAt: NOW,
  decidedAt: null,
  error: null,
};
const usageLine = {
  ts: NOW,
  call: 'triage',
  model: 'claude-sonnet-5-5',
  sourceId: 'mail-1',
  input_tokens: 1200,
  output_tokens: 300,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 800,
  ms: 1500,
  estUsd: 0.01,
};
const totals = { calls: 1, inputTokens: 1200, outputTokens: 300, cacheCreationInputTokens: 0, cacheReadInputTokens: 800, estUsd: 0.01 };
const usageSummary = { day: '2026-11-13', ...totals, byCall: { triage: totals } };
const sidebarTask = {
  taskId: 'task-1',
  title: 'Reply to Michael about pricing',
  clientId: 'poc-client-acme',
  clientName: 'Acme Tooling Co.',
  dueDate: '2026-11-13',
  done: false,
  assigneeIds: ['poc-member-alex'],
  taskType: 'reply_email',
  direction: 'i_owe',
  onHold: false,
  order: 0,
  quickWin: true,
  reason: 'Michael is waiting and it takes five minutes.',
  source,
  preparedStatus: 'ready',
  preparedSuggestionId: 'sug-2',
};
const nudge = { id: 'n-1', kind: 'new_item', text: 'Michael just reached out about the pricing work. Want me to reply?', createdAt: NOW, source, suggestionIds: ['sug-1'], taskId: null };
const profileSummary = { clientId: 'poc-client-acme', clientName: 'Acme Tooling Co.', slug: 'acme-tooling-co', updatedAt: NOW };

interface Sample {
  schema: z.ZodType;
  valid: unknown;
  invalid: unknown;
}

export const SAMPLES: Record<string, Sample> = {
  IsoDate: { schema: c.IsoDate, valid: '2026-11-13', invalid: '13/11/2026' },
  IsoDateTime: { schema: c.IsoDateTime, valid: '2026-11-13T09:00:00+01:00', invalid: '2026-11-13T09:00:00' },
  ConnectorKind: { schema: c.ConnectorKind, valid: 'next_step', invalid: 'sms' },
  ClientConfidence: { schema: c.ClientConfidence, valid: 'low', invalid: 'medium' },
  GraphEmailAddress: { schema: c.GraphEmailAddress, valid: michael, invalid: { name: 'Michael Okafor' } },
  GraphRecipient: { schema: c.GraphRecipient, valid: { emailAddress: michael }, invalid: michael },
  GraphItemBody: { schema: c.GraphItemBody, valid: { contentType: 'html', content: '<p>Hi</p>' }, invalid: { contentType: 'rtf', content: 'x' } },
  GraphDateTimeTimeZone: { schema: c.GraphDateTimeTimeZone, valid: calEvent.start, invalid: { dateTime: '2026-11-13 15:00', timeZone: 'UTC' } },
  GraphAttendee: { schema: c.GraphAttendee, valid: { emailAddress: michael, type: 'optional' }, invalid: { emailAddress: michael, type: 'vip' } },
  ShowAs: { schema: c.ShowAs, valid: 'tentative', invalid: 'away' },
  FileMimeType: { schema: c.FileMimeType, valid: 'text/markdown', invalid: 'application/msword' },
  ClientContact: { schema: c.ClientContact, valid: { name: 'Lena Hartwell', email: 'lena.hartwell@acmetooling.example' }, invalid: { name: 'Lena Hartwell', address: 'lena.hartwell@acmetooling.example' } },
  PmProject: { schema: c.PmProject, valid: pmClient.projects[0], invalid: { ...pmClient.projects[0], deliverables: 'Market pricing analysis' } },
  PmClient: { schema: c.PmClient, valid: pmClient, invalid: { ...pmClient, nicknames: undefined } },
  PmTask: { schema: c.PmTask, valid: pmTask, invalid: { ...pmTask, dueDate: 'Friday' } },
  SuggestionKind: { schema: c.SuggestionKind, valid: 'confirm_client', invalid: 'delete_task' },
  SuggestionStatus: { schema: c.SuggestionStatus, valid: 'applied', invalid: 'maybe' },
  PreparedStatus: { schema: c.PreparedStatus, valid: 'preparing', invalid: 'stale' },
  ClaudeCall: { schema: c.ClaudeCall, valid: 'prioritise', invalid: 'prioritize' },
  UsageTotals: { schema: c.UsageTotals, valid: totals, invalid: { ...totals, calls: -1 } },
  ControlResetResponse: { schema: c.ControlResetResponse, valid: { ok: true }, invalid: { ok: false } },
  SourceRef: { schema: c.SourceRef, valid: source, invalid: { ...source, connector: 'fax' } },
  TaskType: { schema: c.TaskType, valid: 'review_file', invalid: 'water_plants' },
  Direction: { schema: c.Direction, valid: 'owed_to_me', invalid: 'they_owe' },
  Person: { schema: c.Person, valid: michael, invalid: { name: 'Michael Okafor', address: 'not-an-email' } },
  TimeSlot: { schema: c.TimeSlot, valid: { start: NOW, end: '2026-11-13T10:00:00.000Z' }, invalid: { start: NOW, end: NOW } },
  Health: { schema: c.Health, valid: { ok: true, service: 'mocks', now: NOW }, invalid: { ok: 'yes', service: 'mocks', now: NOW } },
  ErrorBody: { schema: c.ErrorBody, valid: { error: 'not found' }, invalid: { message: 'not found' } },

  GraphMessage: { schema: c.GraphMessage, valid: graphMessage, invalid: { ...graphMessage, receivedDateTime: 'yesterday' } },
  GraphMessageList: { schema: c.GraphMessageList, valid: { value: [graphMessage] }, invalid: { items: [graphMessage] } },
  GraphSendMailRequest: { schema: c.GraphSendMailRequest, valid: c.draftToSendMail(c.MailDraft.parse(draft)), invalid: { message: { subject: 'x', body: { contentType: 'text', content: 'x' }, toRecipients: [] } } },
  MailDraft: { schema: c.MailDraft, valid: draft, invalid: { ...draft, to: [] } },

  CalEvent: { schema: c.CalEvent, valid: calEvent, invalid: { ...calEvent, start: { dateTime: '2026-11-13T15:00:00Z', timeZone: 'UTC' } } },
  CalEventList: { schema: c.CalEventList, valid: { value: [calEvent] }, invalid: { value: [{ id: 'x' }] } },
  NewCalEvent: { schema: c.NewCalEvent, valid: { subject: 'Lunch', start: calEvent.start, end: calEvent.end }, invalid: { subject: '', start: calEvent.start, end: calEvent.end } },

  ZoomChatMessage: { schema: c.ZoomChatMessage, valid: chatMessage, invalid: { ...chatMessage, to_channel: 'team-general' } },
  ZoomChatMessageList: { schema: c.ZoomChatMessageList, valid: { page_size: 50, next_page_token: '', messages: [chatMessage] }, invalid: { page_size: 50, messages: [chatMessage] } },

  FileInfo: { schema: c.FileInfo, valid: fileInfo, invalid: { ...fileInfo, path: '../etc/passwd' } },
  FileContent: { schema: c.FileContent, valid: { ...fileInfo, encoding: 'utf8', content: 'a,b\n1,2\n' }, invalid: { ...fileInfo, encoding: 'hex', content: '00' } },
  FileView: { schema: c.FileView, valid: { ...fileInfo, text: 'a,b\n1,2\n', textSource: 'file', truncated: false, rawUrl: '/api/files/raw?path=x' }, invalid: { ...fileInfo, text: 'x', textSource: 'ocr', truncated: false, rawUrl: '' } },

  FlexDate: { schema: c.FlexDate, valid: { kind: 'range', label: 'Q1 2027', start: '2027-01-01', end: '2027-03-31' }, invalid: { kind: 'exact', date: '11/20/26' } },
  ListClientsInput: { schema: c.ListClientsInput, valid: {}, invalid: null },
  ListClientsOutput: { schema: c.ListClientsOutput, valid: { clients: [pmClient] }, invalid: { clients: [{ ...pmClient, fileFolder: undefined }] } },
  ListTasksInput: { schema: c.ListTasksInput, valid: { clientId: 'poc-client-acme', dueFrom: '2026-11-13' }, invalid: { dueTo: 'Friday' } },
  ListTasksOutput: { schema: c.ListTasksOutput, valid: { tasks: [pmTask] }, invalid: { tasks: [{ ...pmTask, clientId: undefined }] } },
  CreateTaskInput: { schema: c.CreateTaskInput, valid: { clientId: 'poc-client-acme', title: 'Chase Michael', dueDate: '2026-11-20' }, invalid: { clientId: 'poc-client-acme', title: '   ' } },
  CreateTaskOutput: { schema: c.CreateTaskOutput, valid: { task: pmTask }, invalid: { task: null } },
  CompleteTaskInput: { schema: c.CompleteTaskInput, valid: { taskId: 'task-1' }, invalid: { taskId: '' } },
  RescheduleTaskInput: { schema: c.RescheduleTaskInput, valid: { taskId: 'task-1', dueDate: null }, invalid: { taskId: 'task-1' } },

  CreateTaskPayload: { schema: c.CreateTaskPayload, valid: suggestion.payload, invalid: { title: 'x' } },
  CompleteTaskPayload: { schema: c.CompleteTaskPayload, valid: { taskId: 'task-1' }, invalid: {} },
  RescheduleTaskPayload: { schema: c.RescheduleTaskPayload, valid: { taskId: 'task-1', dueDate: '2026-11-20' }, invalid: { taskId: 'task-1', dueDate: 'soon' } },
  CalendarBlockPayload: { schema: c.CalendarBlockPayload, valid: { subject: 'Lunch', start: '2026-11-13T12:00:00.000Z', end: '2026-11-13T12:30:00.000Z', purpose: 'lunch' }, invalid: { subject: 'Lunch', start: NOW, end: NOW, purpose: 'nap' } },
  SendReplyPayload: { schema: c.SendReplyPayload, valid: { draft, taskId: 'task-1' }, invalid: { draft: { ...draft, body: '' } } },
  ConfirmClientPayload: { schema: c.ConfirmClientPayload, valid: { candidateClientIds: ['poc-client-quillon'], alias: 'the robo team' }, invalid: { candidateClientIds: 'poc-client-quillon' } },
  DuplicateRef: { schema: c.DuplicateRef, valid: { kind: 'suggestion', id: 'sug-1' }, invalid: { kind: 'email', id: 'mail-1' } },
  Suggestion: { schema: c.Suggestion, valid: suggestion, invalid: { ...suggestion, kind: 'calendar_block' } },
  ApproveBody: { schema: c.ApproveBody, valid: { edits: { title: 'Reply today', payload: { dueDate: '2026-11-14' } } }, invalid: { edits: { title: '' } } },
  DecisionResponse: { schema: c.DecisionResponse, valid: { suggestion: { ...suggestion, status: 'applied', decidedAt: NOW } }, invalid: { suggestion: { ...suggestion, status: 'done' } } },
  PreparedWork: { schema: c.PreparedWork, valid: { type: 'review_file', path: fileInfo.path, summary: 'Matches look sound.', keyPoints: ['Two weak matches', 'Data aged to 1 Jan'] }, invalid: { type: 'review_file', path: fileInfo.path, summary: 'x', keyPoints: [] } },
  TaskMeta: { schema: c.TaskMeta, valid: { taskId: 'task-1', source, direction: 'i_owe', taskType: 'reply_email' }, invalid: { taskId: 'task-1', source, direction: 'i_owe', taskType: 'reply_email', order: -1 } },
  PreparedResponse: { schema: c.PreparedResponse, valid: { taskId: 'task-1', status: 'ready', prepared: { type: 'reply_email', draft }, suggestion: null }, invalid: { taskId: 'task-1', status: 'done', prepared: null, suggestion: null } },
  HoldBody: { schema: c.HoldBody, valid: { onHold: true }, invalid: { onHold: 'yes' } },
  InputBody: { schema: c.InputBody, valid: { text: 'add a task to chase Michael on Friday' }, invalid: { text: '  ' } },
  InputResponse: { schema: c.InputResponse, valid: { suggestions: [suggestion] }, invalid: { suggestions: [{}] } },
  ProfileEdit: { schema: c.ProfileEdit, valid: { section: 'Commitments: we owe', op: 'add', text: 'Send pricing update by Friday' }, invalid: { section: 'Change log', op: 'add', text: 'x' } },

  ProfileSummary: { schema: c.ProfileSummary, valid: profileSummary, invalid: { ...profileSummary, updatedAt: 'now' } },
  ProfileListResponse: { schema: c.ProfileListResponse, valid: { profiles: [profileSummary] }, invalid: { profiles: profileSummary } },
  ProfileDoc: { schema: c.ProfileDoc, valid: { ...profileSummary, markdown: '# Acme Tooling Co.\n' }, invalid: profileSummary },

  UsageLine: { schema: c.UsageLine, valid: usageLine, invalid: { ...usageLine, call: 'gossip' } },
  UsageSummary: { schema: c.UsageSummary, valid: usageSummary, invalid: { ...usageSummary, byCall: { gossip: totals } } },
  UsageResponse: { schema: c.UsageResponse, valid: { today: usageSummary, days: [usageSummary] }, invalid: { today: usageSummary } },

  SectionKey: { schema: c.SectionKey, valid: 'day-2026-11-15', invalid: 'someday' },
  SidebarTask: { schema: c.SidebarTask, valid: sidebarTask, invalid: { ...sidebarTask, preparedStatus: 'cooking' } },
  SidebarSection: { schema: c.SidebarSection, valid: { key: 'today', label: 'Today', items: [sidebarTask] }, invalid: { key: 'today', label: 'Today' } },
  Nudge: { schema: c.Nudge, valid: nudge, invalid: { ...nudge, text: '' } },
  SidebarState: {
    schema: c.SidebarState,
    valid: {
      now: NOW,
      today: '2026-11-13',
      me: { id: 'poc-member-alex', name: 'Alex Rivera' },
      clients: [{ id: 'poc-client-acme', name: 'Acme Tooling Co.' }],
      sections: c.sectionKeys('2026-11-13').map((key) => ({ key, label: c.sectionLabel(key), items: key === 'today' ? [sidebarTask] : [] })),
      suggestions: [suggestion],
      nudges: [nudge],
      calendarToday: [calEvent],
      usageToday: usageSummary,
    },
    invalid: { now: NOW, sections: [] },
  },
  ChatBody: { schema: c.ChatBody, valid: { text: 'What is on today?' }, invalid: {} },

  VoiceClientMessage: { schema: c.VoiceClientMessage, valid: { type: 'start' }, invalid: { type: 'pause' } },
  VoiceServerMessage: { schema: c.VoiceServerMessage, valid: { type: 'interrupted', spokenText: 'You have an hour before' }, invalid: { type: 'assistant.audio.start', sampleRate: 0 } },
  SttEvent: { schema: c.SttEvent, valid: { type: 'final', text: 'add a task to chase Michael Friday' }, invalid: { type: 'final' } },
  TtsRequest: { schema: c.TtsRequest, valid: { text: 'Hello.' }, invalid: { text: '' } },

  ControlMailDrop: { schema: c.ControlMailDrop, valid: { from: michael, subject: 'Pricing update', body: 'Any news?' }, invalid: { from: michael, subject: 'Pricing update' } },
  ControlChatDrop: { schema: c.ControlChatDrop, valid: { sender: chatMessage.sender, sender_display_name: 'Priya Shah', message: 'Hi' }, invalid: { sender: 'Priya', sender_display_name: 'Priya Shah', message: 'Hi' } },
  CannedMessage: {
    schema: c.CannedMessage,
    valid: { key: 'acme-update-and-meeting', step: 2, description: 'Michael asks for an update and a meeting', expect: { clientId: 'poc-client-acme', confidence: 'high', taskTypes: ['reply_email', 'schedule_meeting'] }, mail: { from: michael, subject: 'Pricing update', body: 'Any news?' } },
    invalid: { key: 'Bad Key', step: 2, description: 'x', expect: { clientId: null, confidence: 'low' } },
  },
  SeedInfo: {
    schema: c.SeedInfo,
    valid: { seededAt: NOW, now: NOW, tz: 'UTC', me: { id: 'poc-member-alex', name: 'Alex Rivera', email: alex.address }, internalClientId: 'poc-client-internal', intakeCursor: NOW },
    invalid: { seededAt: NOW, now: NOW, tz: 'UTC' },
  },
};

/** Every exported zod schema name, so a test can check SAMPLES covers them all. */
export const SAMPLE_NAMES = Object.keys(SAMPLES);

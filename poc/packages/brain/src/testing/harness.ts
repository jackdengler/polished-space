/**
 * Test harness: a Brain wired to FakeClaude and the in-memory fake
 * connectors, in a temp data dir, with a fixed clock (Friday 2026-11-13
 * 13:47 UTC). All names are invented (same cast as the seed).
 *
 * Every connector write is recorded by a spy, with the approval scope it ran
 * in (null = outside any approval), so tests can prove writes only happen
 * from the approve path.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderProfile, type PmClient, type PmTask } from '@poc/contracts';
import { FakeCalendarConnector, FakeChatConnector, FakeClaude, FakeFilesConnector, FakeMailConnector, FakePmConnector } from '@poc/contracts/testing';
import { Brain } from '../brain';
import type { AnthropicLike } from '../claude';
import { makeClock, type BrainConfig } from '../config';
import { currentApproval, type Connectors } from '../guard';
import type { BrainModule } from '../modules/types';

export const NOW = '2026-11-13T13:47:00.000Z'; // a Friday
export const TODAY = '2026-11-13';
export const ME = { id: 'poc-member-alex', name: 'Alex Rivera', email: 'alex.rivera@brightline-advisory.example' };

export const MICHAEL = { name: 'Michael Okafor', address: 'michael.okafor@acmetooling.example' };
export const DMITRI = { name: 'Dmitri Vance', address: 'dmitri.vance@harborlight.example' };
export const PRIYA = { sender: 'priya.shah@brightline-advisory.example', sender_display_name: 'Priya Shah' };
export const MARCUS = { sender: 'marcus.lee@brightline-advisory.example', sender_display_name: 'Marcus Lee' };

export const CLIENTS: PmClient[] = [
  {
    id: 'poc-client-acme',
    name: 'Acme Tooling Co.',
    archived: false,
    nicknames: ['Acme', 'ATC'],
    emailDomains: ['acmetooling.example'],
    contacts: [
      { name: 'Michael Okafor', email: MICHAEL.address, role: 'VP HR' },
      { name: 'Lena Hartwell', email: 'lena.hartwell@acmetooling.example', role: 'Compensation Manager' },
    ],
    fileFolder: 'Acme Tooling',
    projects: [{ meetingId: 'm-acme-1', title: 'Market data review', date: { kind: 'exact', date: '2026-11-20' }, deliverables: ['Market pricing analysis'] }],
  },
  {
    id: 'poc-client-harborlight',
    name: 'Harborlight Freight',
    archived: false,
    nicknames: ['Harbor', 'HLF'],
    emailDomains: ['harborlight.example'],
    contacts: [{ name: 'Dmitri Vance', email: DMITRI.address, role: 'Director of Total Rewards' }],
    fileFolder: 'Harborlight Freight',
    projects: [],
  },
  {
    id: 'poc-client-quillon',
    name: 'Quillon Robotics',
    archived: false,
    nicknames: ['Quill'],
    emailDomains: ['quillon.example'],
    contacts: [{ name: 'Renata Solis', email: 'renata.solis@quillon.example', role: 'Head of People' }],
    fileFolder: 'Quillon Robotics',
    projects: [],
  },
  { id: 'poc-client-internal', name: 'Internal', archived: false, nicknames: [], emailDomains: [], contacts: [], fileFolder: null, projects: [] },
];

export function task(id: string, clientId: string, title: string, dueDate: string | null, assignee = ME.id): PmTask {
  const c = CLIENTS.find((x) => x.id === clientId)!;
  return { id, title, done: false, dueDate, assigneeIds: [assignee], clientId, clientName: c.name, boardId: 'adhoc', boardLabel: 'Ad-hoc', deliverableId: `d-${clientId}`, deliverableTitle: 'General', updatedAt: NOW };
}

export interface WriteRecord {
  method: 'createTask' | 'completeTask' | 'rescheduleTask' | 'sendMail' | 'createEvent';
  args: unknown;
  /** Suggestion id of the approval it ran under, or null if outside any approval. */
  approval: string | null;
}

/** Wrap connectors so every write is recorded with its approval scope. */
export function spyWrites(c: Connectors, log: WriteRecord[], fail: Partial<Record<WriteRecord['method'], Error>> = {}): Connectors {
  const rec = async <T>(method: WriteRecord['method'], args: unknown, run: () => Promise<T>): Promise<T> => {
    log.push({ method, args, approval: currentApproval() });
    if (fail[method]) throw fail[method];
    return run();
  };
  return {
    pm: {
      listClients: () => c.pm.listClients(),
      listTasks: (q) => c.pm.listTasks(q),
      createTask: (i) => rec('createTask', i, () => c.pm.createTask(i)),
      completeTask: (id) => rec('completeTask', id, () => c.pm.completeTask(id)),
      rescheduleTask: (id, d) => rec('rescheduleTask', [id, d], () => c.pm.rescheduleTask(id, d)),
    },
    mail: { listSince: (x) => c.mail.listSince(x), get: (id) => c.mail.get(id), send: (d) => rec('sendMail', d, () => c.mail.send(d)) },
    calendar: { view: (s, e) => c.calendar.view(s, e), createEvent: (e) => rec('createEvent', e, () => c.calendar.createEvent(e)) },
    chat: c.chat,
    files: c.files,
  };
}

export interface HarnessOptions {
  maxUsdPerDay?: number;
  tasks?: PmTask[];
  modules?: BrainModule[];
  fail?: Partial<Record<WriteRecord['method'], Error>>;
  dataDir?: string;
  fallbacks?: boolean;
}

export interface Harness {
  brain: Brain;
  claude: FakeClaude;
  pm: FakePmConnector;
  mail: FakeMailConnector;
  chat: FakeChatConnector;
  calendar: FakeCalendarConnector;
  writes: WriteRecord[];
  dataDir: string;
  config: BrainConfig;
  logs: string[];
}

export async function makeDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'poc-brain-'));
  await mkdir(join(dir, 'profiles'), { recursive: true });
  await writeFile(
    join(dir, 'profiles', 'acme-tooling-co.md'),
    renderProfile('Acme Tooling Co.', {
      'Also known as': ['Acme', 'ATC'],
      'Key contacts': ['Michael Okafor (VP HR): sponsor'],
      'Active projects': ['Market pricing analysis: summary draft in progress'],
    }),
  );
  await writeFile(join(dir, 'profiles', 'quillon-robotics.md'), renderProfile('Quillon Robotics', { 'Also known as': ['Quill', 'the robo team'] }));
  return dir;
}

export async function makeHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const dataDir = opts.dataDir ?? (await makeDataDir());
  const clock = makeClock('UTC', null, () => new Date(NOW));
  const config: BrainConfig = {
    port: 0,
    host: '127.0.0.1',
    dataDir,
    pmMcpUrl: 'http://unused.invalid/mcp',
    mocksUrl: 'http://unused.invalid',
    speechUrl: 'http://unused.invalid',
    anthropicBaseUrl: undefined,
    clock,
    maxUsdPerDay: opts.maxUsdPerDay ?? 5,
    pollMs: 2500,
    claudeFallbacks: opts.fallbacks ?? true,
    me: ME,
    internalClientId: 'poc-client-internal',
    intakeCursor: NOW,
  };
  const claude = new FakeClaude();
  const pm = new FakePmConnector({ clients: CLIENTS, tasks: opts.tasks ?? [] }, () => NOW);
  const mail = new FakeMailConnector([], NOW);
  const chat = new FakeChatConnector([], NOW);
  const calendar = new FakeCalendarConnector([FakeCalendarConnector.event('evt-1', 'Acme Tooling check-in', '2026-11-13T15:30:00.000Z', '2026-11-13T16:00:00.000Z')]);
  const files = new FakeFilesConnector({ 'Harborlight Freight/HLF Driver Pay Structure Draft.pdf': new Uint8Array([37, 80, 68, 70]), 'Acme Tooling/benchmark_matches.csv': 'job,match\n' });
  const writes: WriteRecord[] = [];
  const logs: string[] = [];
  const brain = new Brain({
    config,
    anthropic: claude as unknown as AnthropicLike,
    connectors: spyWrites({ pm, mail, calendar, chat, files }, writes, opts.fail),
    modules: opts.modules ?? [],
    log: (m) => logs.push(m),
  });
  await brain.init();
  return { brain, claude, pm, mail, chat, calendar, writes, dataDir, config, logs };
}

/** A triage answer, with defaults for the fields a test does not care about. */
export function triage(over: Record<string, unknown> = {}) {
  return {
    clientId: 'poc-client-acme',
    confidence: 'high',
    alias: null,
    nudge: 'Michael just asked where the pricing work stands and wants to meet. Want me to draft a reply?',
    tasks: [
      { title: 'Reply to Michael with a pricing update', direction: 'i_owe', taskType: 'reply_email', dueDate: '2026-11-16', duplicateOf: null },
      { title: 'Set up a 45-minute call with Michael', direction: 'i_owe', taskType: 'schedule_meeting', dueDate: null, duplicateOf: null },
    ],
    meetingRequest: true,
    profileEdits: [{ section: 'Commitments: we owe', op: 'add', text: 'Pricing update to Michael' }],
    ...over,
  };
}

export const michaelMail = { from: MICHAEL, subject: 'Market pricing: where are we? And time to meet', body: 'Hi Alex,\n\nCould you send me a quick update on the market pricing analysis? I would also like 45 minutes next week.\n\nMichael' };

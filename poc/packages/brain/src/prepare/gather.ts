/**
 * Context gathering for prepared work, all in code and read-only:
 * the task, its client and profile, the source message and thread, the
 * people involved, the client file, the calendar.
 *
 * Recipients are always chosen here, from the source message's sender or the
 * client's contacts in Planr, never from text Claude writes or a message
 * contains. So untrusted content can shape a draft but never redirect it.
 */
import { parseProfile, type ChatMessage, type FileContent, type FileInfo, type MailMessage, type PmClient, type PmTask, type Person, type SourceRef, type TaskMeta } from '@poc/contracts';
import type { ModuleContext } from '../modules/types';

export class PrepareError extends Error {
  override name = 'PrepareError';
}

export interface Gathered {
  task: PmTask;
  meta: TaskMeta;
  client: PmClient | null;
  profile: string | null;
  sourceMail: MailMessage | null;
  sourceChat: ChatMessage | null;
  /** Plain text of the source item (mail body, chat text, typed text). */
  sourceText: string;
  /** Mail in the source thread (oldest first, source included), at most 6. */
  thread: MailMessage[];
  /** The whole inbox, newest last, capped (for "latest from" lookups). */
  inbox: MailMessage[];
}

const INBOX_CAP = 300;

export async function gather(ctx: ModuleContext, taskId: string): Promise<Gathered> {
  const { tasks } = await ctx.read.pm.listTasks({ includeDone: true });
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new PrepareError(`No task ${taskId} in Planr.`);
  const meta = ctx.taskMeta.get(taskId) ?? (await ctx.taskMeta.upsert(taskId, {}));
  const client = (await ctx.clients()).find((c) => c.id === task.clientId) ?? null;
  const profile = client ? await ctx.profiles.read(client.name) : null;
  const inbox = (await ctx.read.mail.listSince('')).items.slice(-INBOX_CAP);

  let sourceMail: MailMessage | null = null;
  let sourceChat: ChatMessage | null = null;
  let sourceText = '';
  const src = meta.source;
  if (src?.connector === 'mail') {
    sourceMail = await ctx.read.mail.get(src.id).catch(() => null);
    sourceText = sourceMail ? mailText(sourceMail) : '';
  } else if (src?.connector === 'chat') {
    const { items } = await ctx.read.chat.listSince('');
    sourceChat = items.find((m) => m.id === src.id) ?? null;
    sourceText = sourceChat?.message ?? '';
  } else if (src && (src.connector === 'manual' || src.connector === 'voice' || src.connector === 'next_step')) {
    sourceText = src.label;
  }
  const thread = sourceMail ? inbox.filter((m) => m.conversationId === sourceMail.conversationId && m.id !== sourceMail.id).concat(sourceMail).slice(-6) : [];
  return { task, meta, client, profile, sourceMail, sourceChat, sourceText, thread, inbox };
}

export function mailText(m: MailMessage): string {
  const body = m.body.contentType === 'html' ? m.body.content.replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ') : m.body.content;
  return body.trim();
}

export function mailRef(m: MailMessage): SourceRef {
  return { connector: 'mail', id: m.id, label: `Email from ${m.from.emailAddress.name}: ${m.subject}`, threadId: m.conversationId };
}

const norm = (s: string) => s.toLowerCase();
const wordIn = (word: string, text: string) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text);

/** A client contact named in `text` (full name first, then first name). */
export function contactNamed(client: PmClient | null, text: string): Person | null {
  if (!client) return null;
  const full = client.contacts.find((c) => wordIn(c.name, text));
  const first = full ?? client.contacts.find((c) => wordIn(c.name.split(/\s+/)[0]!, text));
  return first ? { name: first.name, address: first.email } : null;
}

/** Resolve a name Claude gave (e.g. "Lena") to a client contact, or to one of `extra`; null when unknown. */
export function resolvePerson(name: string | null, client: PmClient | null, extra: Person[] = []): Person | null {
  if (!name?.trim()) return null;
  const n = name.trim();
  const exact = [...(client?.contacts.map((c) => ({ name: c.name, address: c.email })) ?? []), ...extra].find(
    (p) => norm(p.name) === norm(n) || norm(p.address) === norm(n) || norm(p.name.split(/\s+/)[0]!) === norm(n.split(/\s+/)[0]!),
  );
  return exact ?? null;
}

function isFirm(ctx: ModuleContext, address: string): boolean {
  const firm = ctx.config.me.email.split('@')[1]?.toLowerCase();
  return !!firm && address.toLowerCase().endsWith(`@${firm}`);
}

function sender(m: MailMessage): Person {
  return { name: m.from.emailAddress.name, address: m.from.emailAddress.address };
}

function fromClient(client: PmClient | null, m: MailMessage): boolean {
  if (!client) return false;
  const a = m.from.emailAddress.address.toLowerCase();
  return client.emailDomains.some((d) => a.endsWith(`@${d.toLowerCase()}`)) || client.contacts.some((c) => c.email.toLowerCase() === a);
}

/** Who a reply goes to and which message it answers. */
export function replyTarget(ctx: ModuleContext, g: Gathered): { to: Person; replyTo: MailMessage | null } {
  if (g.sourceMail && !isFirm(ctx, g.sourceMail.from.emailAddress.address)) return { to: sender(g.sourceMail), replyTo: g.sourceMail };
  const named = contactNamed(g.client, `${g.task.title}\n${g.sourceText}`);
  const fromNamed = named ? [...g.inbox].reverse().find((m) => m.from.emailAddress.address.toLowerCase() === named.address.toLowerCase()) : undefined;
  if (named) return { to: named, replyTo: fromNamed ?? null };
  const latest = [...g.inbox].reverse().find((m) => fromClient(g.client, m));
  if (latest) return { to: sender(latest), replyTo: latest };
  const first = g.client?.contacts[0];
  if (first) return { to: { name: first.name, address: first.email }, replyTo: null };
  throw new PrepareError('I could not work out who to reply to: the task has no source email and the client has no contacts.');
}

/** The quiet person to chase, plus the last message sent to them and the last one from them. */
export async function chaseTarget(ctx: ModuleContext, g: Gathered): Promise<{ to: Person; lastSent: MailMessage | null; lastFrom: MailMessage | null }> {
  let to = contactNamed(g.client, `${g.task.title}\n${g.sourceText}`);
  if (!to && g.sourceMail && !isFirm(ctx, g.sourceMail.from.emailAddress.address)) to = sender(g.sourceMail);
  if (!to && g.client?.contacts[0]) to = { name: g.client.contacts[0].name, address: g.client.contacts[0].email };
  if (!to) throw new PrepareError('I could not work out who to chase: no contact is named and the client has no contacts.');
  const addr = to.address.toLowerCase();
  // A Sent folder outage should not block the chaser; it is then written from the task and profile.
  const sent = await ctx.read.mail.listSent().catch((err) => {
    ctx.log(`sent folder unavailable: ${(err as Error).message}`);
    return [] as MailMessage[];
  });
  const lastSent =
    sent
      .filter((m) => m.toRecipients.some((r) => r.emailAddress.address.toLowerCase() === addr))
      .sort((a, b) => (a.sentDateTime ?? a.receivedDateTime).localeCompare(b.sentDateTime ?? b.receivedDateTime))
      .pop() ?? null;
  const lastFrom = [...g.inbox].reverse().find((m) => m.from.emailAddress.address.toLowerCase() === addr) ?? null;
  return { to, lastSent, lastFrom };
}

/** The client file the task is about: named in the title or source, else the newest in the client's folder. */
export async function findFile(ctx: ModuleContext, g: Gathered): Promise<FileContent> {
  if (!g.client?.fileFolder) throw new PrepareError(`${g.task.clientName} has no file folder, so there is no file to review.`);
  const files = await ctx.read.files.list(g.client.fileFolder);
  if (!files.length) throw new PrepareError(`There are no files in the ${g.client.fileFolder} folder to review.`);
  const pick = mentionedFiles(files, `${g.task.title}\n${g.sourceText}`)[0] ?? [...files].sort((a, b) => b.modified.localeCompare(a.modified))[0]!;
  return ctx.read.files.read(pick.path);
}

/** Files whose name (or name without extension) appears in `text`, longest match first. */
export function mentionedFiles(files: FileInfo[], text: string): FileInfo[] {
  const t = norm(text);
  return files
    .map((f) => {
      const stem = f.name.replace(/\.[^.]+$/, '');
      const hit = t.includes(norm(f.name)) ? f.name.length + 1 : stem.length >= 4 && t.includes(norm(stem)) ? stem.length : 0;
      return { f, hit };
    })
    .filter((x) => x.hit > 0)
    .sort((a, b) => b.hit - a.hit)
    .map((x) => x.f);
}

/** Profile sections worth showing for an "other" task, as (label, text) pairs. */
export function profileExcerpts(markdown: string | null): { label: string; text: string }[] {
  if (!markdown) return [];
  const { sections } = parseProfile(markdown);
  const keep = ['Key contacts', 'Active projects', 'Commitments: we owe', 'Commitments: they owe', 'Preferences and quirks', 'Recent decisions'] as const;
  return keep.flatMap((k) => {
    const body = sections[k]?.trim();
    return body && body !== '- (none yet)' ? [{ label: `Profile: ${k}`, text: body }] : [];
  });
}

/** Latest inbox messages from the client, newest first, excluding `exceptId`. */
export function relatedMail(g: Gathered, exceptId: string | null, n = 3): MailMessage[] {
  // The same email delivered twice (same sender, subject and text) is context once.
  const seen = new Set<string>();
  return [...g.inbox]
    .reverse()
    .filter((m) => {
      if (m.id === exceptId || !fromClient(g.client, m)) return false;
      const key = `${m.from.emailAddress.address.toLowerCase()}\u0000${m.subject.trim()}\u0000${mailText(m).replace(/\s+/g, ' ')}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, n);
}

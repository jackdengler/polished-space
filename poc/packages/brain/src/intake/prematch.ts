/**
 * Deterministic pre-match: which clients could a message be about? Runs in
 * code before the triage call, so Claude only sees the candidates' profiles,
 * and so obvious signals (sender domain, a contact's address) are never left
 * to chance. Claude makes the final call; low confidence goes to the Inbox.
 */
import { createHash } from 'node:crypto';
import type { PmClient } from '@poc/contracts';

export interface PrematchInput {
  /** Sender address (mail or chat), if any. */
  sender?: string | null;
  /** Other addresses on the message (to/cc), if any. */
  participants?: string[];
  /** Subject + body, or the chat text, or the typed text. */
  text: string;
}

export interface PrematchExtras {
  /** Learned shorthand per client id (profile "Also known as"). */
  aliases?: Record<string, string[]>;
  /** File names per client id (from the client's folder). */
  files?: Record<string, string[]>;
}

export interface Candidate {
  clientId: string;
  score: number;
  reasons: string[];
}

const W = { domain: 10, contactEmail: 10, participant: 4, name: 6, nickname: 6, alias: 6, contactName: 5, file: 6, project: 4, firstName: 2 } as const;

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whole-word match. Short all-caps tokens ("TF", "ATC") match case-sensitively
 * so ordinary words do not trigger them; longer terms ignore case.
 */
export function mentions(text: string, term: string): boolean {
  const t = term.trim();
  if (t.length < 2) return false;
  const caseSensitive = t.length <= 3;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escape(t)}(?![\\p{L}\\p{N}])`, caseSensitive ? 'u' : 'iu').test(text);
}

const domainOf = (addr: string) => addr.split('@')[1]?.toLowerCase() ?? '';
const stem = (name: string) => name.replace(/\.[a-z0-9]+$/i, '');

export function prematch(input: PrematchInput, clients: PmClient[], extras: PrematchExtras = {}): Candidate[] {
  const text = input.text;
  const sender = input.sender?.toLowerCase() ?? null;
  const others = (input.participants ?? []).map((p) => p.toLowerCase());
  const out: Candidate[] = [];
  for (const c of clients) {
    if (c.archived) continue;
    const reasons: string[] = [];
    let score = 0;
    const hit = (w: number, why: string) => {
      score += w;
      reasons.push(why);
    };
    const domains = c.emailDomains.map((d) => d.toLowerCase());
    if (sender && domains.includes(domainOf(sender))) hit(W.domain, `sender domain ${domainOf(sender)}`);
    if (sender && c.contacts.some((k) => k.email.toLowerCase() === sender)) hit(W.contactEmail, `sender is a contact`);
    if (others.some((a) => domains.includes(domainOf(a)))) hit(W.participant, 'a client address is on the message');
    if (mentions(text, c.name)) hit(W.name, `names "${c.name}"`);
    for (const n of c.nicknames) if (mentions(text, n)) hit(W.nickname, `nickname "${n}"`);
    for (const a of extras.aliases?.[c.id] ?? []) {
      if (c.nicknames.includes(a)) continue;
      if (mentions(text, a)) hit(W.alias, `learned shorthand "${a}"`);
    }
    for (const k of c.contacts) {
      if (mentions(text, k.name)) hit(W.contactName, `mentions ${k.name}`);
      else {
        const first = k.name.split(/\s+/)[0] ?? '';
        if (first.length >= 3 && mentions(text, first)) hit(W.firstName, `mentions "${first}"`);
      }
    }
    for (const f of extras.files?.[c.id] ?? []) {
      const s = stem(f);
      if (text.toLowerCase().includes(f.toLowerCase()) || (s.length >= 15 && text.toLowerCase().includes(s.toLowerCase()))) hit(W.file, `names file "${f}"`);
    }
    const projectTerms = new Set([...c.projects.map((p) => p.title), ...c.projects.flatMap((p) => p.deliverables)]);
    for (const p of projectTerms) if (p.length >= 8 && mentions(text, p)) hit(W.project, `project "${p}"`);
    if (score > 0) out.push({ clientId: c.id, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score || a.clientId.localeCompare(b.clientId));
}

/** Content fingerprint: the same message dropped in again (new id, same words) is not triaged twice. */
export function fingerprint(kind: string, sender: string | null, subject: string, body: string): string {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha256').update([kind, norm(sender ?? ''), norm(subject), norm(body)].join('\u0000')).digest('hex');
}

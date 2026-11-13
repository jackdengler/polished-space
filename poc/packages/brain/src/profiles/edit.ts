/**
 * Pure, line-based editing of a client profile file. The file is the team's
 * document: everything a person wrote (extra lines, extra `##` sections, notes
 * between bullets, their own order of sections) is kept byte for byte. Code
 * only touches the bullet it adds, replaces or removes, and appends one line
 * to `## Change log` per applied change. A missing standard heading is
 * recreated in its standard position; a missing title is put back on top.
 */
import { EDITABLE_PROFILE_SECTIONS, PROFILE_SECTIONS, ProfileEdit, renderProfile, type ProfileSection } from '@poc/contracts';
import { z } from 'zod';

/**
 * A ProfileEdit, plus `match` for code-made replaces that know the exact line
 * they change (e.g. a task's commitment bullet). If that line is gone (a person
 * edited or deleted it) the edit is skipped rather than guessed.
 */
export const CodeProfileEdit = ProfileEdit.extend({ match: z.string().min(1).optional() });
export type CodeProfileEdit = z.infer<typeof CodeProfileEdit>;

export const PLACEHOLDER = '(none yet)';
/** Longest bullet code will write. Longer text is cut (with an ellipsis), never spread over lines. */
export const MAX_BULLET = 300;

interface Section {
  /** The heading line as it is in the file. */
  headingLine: string;
  key: ProfileSection | null;
  lines: string[];
}

interface Doc {
  head: string[];
  sections: Section[];
}

const HEADING = /^##(?!#)\s*(.*?)\s*#*\s*$/;
const BULLET = /^[-*+]\s+(.*)$/;

function keyOf(heading: string): ProfileSection | null {
  const h = heading.trim().toLowerCase().replace(/\s+/g, ' ');
  return PROFILE_SECTIONS.find((s) => s.toLowerCase() === h) ?? null;
}

function parse(markdown: string): Doc {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const doc: Doc = { head: [], sections: [] };
  let cur: Section | null = null;
  for (const line of lines) {
    const m = HEADING.exec(line);
    if (m) {
      cur = { headingLine: line, key: keyOf(m[1] ?? ''), lines: [] };
      doc.sections.push(cur);
    } else if (cur) cur.lines.push(line);
    else doc.head.push(line);
  }
  return doc;
}

function render(doc: Doc): string {
  const out = [...doc.head];
  for (const s of doc.sections) out.push(s.headingLine, ...s.lines);
  let text = out.join('\n');
  if (!text.endsWith('\n')) text += '\n';
  return text;
}

/** Normalised bullet text, for "is this the same line?" checks. */
export function norm(text: string): string {
  return text
    .replace(/^["“'`]+|["”'`]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;]+$/, '')
    .toLowerCase();
}

/** One line of plain text: no newlines, no leading bullet marker, bounded length. */
export function cleanText(text: string): string {
  let t = text.replace(/\s+/g, ' ').trim().replace(/^[-*+]\s+/, '').trim();
  if (t.length > MAX_BULLET) t = `${t.slice(0, MAX_BULLET - 1).trimEnd()}…`;
  return t;
}

function bulletIndexes(s: Section): number[] {
  const out: number[] = [];
  s.lines.forEach((l, i) => {
    if (BULLET.test(l)) out.push(i);
  });
  return out;
}

const bulletText = (line: string) => BULLET.exec(line)?.[1] ?? '';
const isPlaceholder = (line: string) => norm(bulletText(line)) === norm(PLACEHOLDER);

/** Find the section, recreating it in its standard position if a person deleted it. */
function ensureSection(doc: Doc, key: ProfileSection): Section {
  const found = doc.sections.find((s) => s.key === key);
  if (found) return found;
  const created: Section = { headingLine: `## ${key}`, key, lines: ['', `- ${PLACEHOLDER}`, ''] };
  const order = PROFILE_SECTIONS.indexOf(key);
  // After the nearest earlier standard section present; else before the nearest later one; else at the end.
  // The change log always goes back at the end of the file.
  let at = key === 'Change log' ? doc.sections.length : -1;
  for (let o = order - 1; o >= 0 && at < 0; o--) {
    const i = doc.sections.findIndex((s) => s.key === PROFILE_SECTIONS[o]);
    if (i >= 0) at = i + 1;
  }
  if (at < 0) {
    for (let o = order + 1; o < PROFILE_SECTIONS.length && at < 0; o++) {
      const i = doc.sections.findIndex((s) => s.key === PROFILE_SECTIONS[o]);
      if (i >= 0) at = i;
    }
  }
  if (at < 0) at = doc.sections.length;
  // Keep a blank line between the previous section's text and the new heading.
  const prev = at > 0 ? doc.sections[at - 1] : null;
  const prevLines = prev ? prev.lines : doc.head;
  if (prevLines.length && prevLines[prevLines.length - 1]!.trim() !== '') prevLines.push('');
  doc.sections.splice(at, 0, created);
  return created;
}

function addBullet(s: Section, text: string): void {
  // Drop the placeholder, if that is all there is.
  const bullets = bulletIndexes(s);
  if (bullets.length === 1 && isPlaceholder(s.lines[bullets[0]!]!)) s.lines.splice(bullets[0]!, 1);
  let last = -1;
  s.lines.forEach((l, i) => {
    if (l.trim() !== '') last = i;
  });
  if (last < 0) {
    s.lines.splice(0, s.lines.length, '', `- ${text}`, '');
    return;
  }
  s.lines.splice(last + 1, 0, `- ${text}`);
}

function removeAt(s: Section, index: number): void {
  s.lines.splice(index, 1);
  if (!bulletIndexes(s).length && !s.lines.some((l) => l.trim() !== '')) s.lines.splice(0, s.lines.length, '', `- ${PLACEHOLDER}`, '');
  else if (!bulletIndexes(s).length) addBullet(s, PLACEHOLDER);
}

const words = (t: string) => new Set(norm(t).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));
const keyPart = (t: string) => {
  const i = t.indexOf(':');
  return i > 0 ? norm(t.slice(0, i)) : null;
};

/**
 * Which bullet does a "replace" mean? The one with the same lead-in before a
 * colon ("Market pricing analysis: ..."), else the one sharing the most words
 * (at least half). Null when nothing is close: the edit then becomes an add.
 */
function findReplaceTarget(s: Section, text: string): number | null {
  const bullets = bulletIndexes(s).filter((i) => !isPlaceholder(s.lines[i]!));
  const k = keyPart(text);
  if (k) {
    const hit = bullets.find((i) => keyPart(bulletText(s.lines[i]!)) === k);
    if (hit !== undefined) return hit;
  }
  const w = words(text);
  let best: number | null = null;
  let bestScore = 0;
  for (const i of bullets) {
    const o = words(bulletText(s.lines[i]!));
    const inter = [...w].filter((x) => o.has(x)).length;
    const score = inter / Math.max(1, Math.min(w.size, o.size));
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore >= 0.5 ? best : null;
}

export interface AppliedEdit {
  section: ProfileSection;
  op: 'add' | 'replace' | 'remove';
  text: string;
  /** For replace: the bullet it replaced. */
  previous?: string;
}

export interface EditOutcome {
  markdown: string;
  applied: AppliedEdit[];
  /** Valid edits that changed nothing (already there, or nothing to remove). */
  skipped: { edit: CodeProfileEdit; reason: string }[];
  /** Edits that were not valid ProfileEdits (unknown section, bad op, empty text). */
  rejected: { edit: unknown; reason: string }[];
  changed: boolean;
}

export interface EditOptions {
  clientName: string;
  /** ISO time for the change-log lines. */
  at: string;
  /** Where the change came from, e.g. "Email from Michael Okafor: ...". */
  sourceLabel: string;
}

function logLine(e: AppliedEdit, at: string, source: string): string {
  const what = e.op === 'add' ? `added to ${e.section}` : e.op === 'remove' ? `removed from ${e.section}` : `updated in ${e.section}`;
  const prev = e.op === 'replace' && e.previous ? ` (was "${cleanText(e.previous)}")` : '';
  return `${at}: ${what}: "${e.text}"${prev} (source: ${cleanText(source) || 'unknown'})`;
}

/**
 * Apply edits to a profile's markdown (null = no file yet: a fresh profile is
 * started). Each edit is validated on its own; one bad edit never stops the
 * others. Idempotent: an add whose line is already there (ignoring case,
 * spacing, quotes and a trailing full stop) changes nothing and logs nothing.
 */
export function applyProfileEdits(markdown: string | null, edits: unknown[], opts: EditOptions): EditOutcome {
  const doc = parse(markdown ?? renderProfile(opts.clientName, {}));
  const applied: AppliedEdit[] = [];
  const skipped: EditOutcome['skipped'] = [];
  const rejected: EditOutcome['rejected'] = [];

  for (const raw of edits) {
    const parsed = CodeProfileEdit.safeParse(raw);
    if (!parsed.success) {
      rejected.push({ edit: raw, reason: parsed.error.issues.map((i) => `${i.path.join('.') || 'edit'}: ${i.message}`).join('; ') });
      continue;
    }
    const edit = parsed.data;
    if (!(EDITABLE_PROFILE_SECTIONS as readonly string[]).includes(edit.section)) {
      rejected.push({ edit: raw, reason: `section "${edit.section}" cannot be edited` });
      continue;
    }
    const text = cleanText(edit.text);
    if (!text || norm(text) === norm(PLACEHOLDER)) {
      rejected.push({ edit: raw, reason: 'text is empty' });
      continue;
    }
    const s = ensureSection(doc, edit.section);
    const same = bulletIndexes(s).find((i) => norm(bulletText(s.lines[i]!)) === norm(text));

    if (edit.op === 'add') {
      if (same !== undefined) {
        skipped.push({ edit, reason: 'already in the profile' });
        continue;
      }
      addBullet(s, text);
      applied.push({ section: edit.section, op: 'add', text });
    } else if (edit.op === 'remove') {
      if (same === undefined) {
        skipped.push({ edit, reason: 'no such line' });
        continue;
      }
      const removed = bulletText(s.lines[same]!);
      removeAt(s, same);
      applied.push({ section: edit.section, op: 'remove', text: removed });
    } else {
      if (same !== undefined) {
        skipped.push({ edit, reason: 'already in the profile' });
        continue;
      }
      let target: number | null;
      if (edit.match) {
        const m = bulletIndexes(s).find((i) => norm(bulletText(s.lines[i]!)) === norm(edit.match!));
        if (m === undefined) {
          skipped.push({ edit, reason: 'the line to update is no longer in the profile' });
          continue;
        }
        target = m;
      } else target = findReplaceTarget(s, text);
      if (target === null) {
        addBullet(s, text);
        applied.push({ section: edit.section, op: 'add', text });
      } else {
        const previous = bulletText(s.lines[target]!);
        s.lines[target] = `- ${text}`;
        applied.push({ section: edit.section, op: 'replace', text, previous });
      }
    }
  }

  if (applied.length) {
    if (!doc.head.some((l) => /^# (?!#)/.test(l))) doc.head.unshift(`# ${opts.clientName}`, '');
    const log = ensureSection(doc, 'Change log');
    for (const e of applied) addBullet(log, logLine(e, opts.at, opts.sourceLabel));
  }
  return { markdown: applied.length || markdown === null ? render(doc) : markdown, applied, skipped, rejected, changed: applied.length > 0 };
}

/** Bullets of one section (without "- " and placeholders). */
export function sectionBullets(markdown: string, key: ProfileSection): string[] {
  const s = parse(markdown).sections.find((x) => x.key === key);
  if (!s) return [];
  return bulletIndexes(s)
    .map((i) => bulletText(s.lines[i]!))
    .filter((t) => norm(t) !== norm(PLACEHOLDER));
}

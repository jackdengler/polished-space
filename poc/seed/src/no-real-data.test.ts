/**
 * The repo is public. This scans everything the seed produces (and the
 * committed seed text files) for anything that is not invented:
 *
 * 1. Allow-list: every email address and domain must be one of the invented
 *    `.example` domains; every person name in a structured field must be in
 *    INVENTED_PEOPLE.
 * 2. Deny-list: common real providers, survey vendors, URLs, phone numbers,
 *    key-like strings.
 */
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveNow } from '@poc/contracts';
import { buildSeed, writeSeed } from './build';
import { CLIENTS, INVENTED_DOMAINS, INVENTED_PEOPLE } from './people';

const seed = buildSeed(resolveNow('2026-11-13T13:47:00Z'), 'UTC');

async function allFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await allFiles(p)));
    else out.push(p);
  }
  return out;
}

/** Every text the seed writes, keyed by relative path. PDFs are read as latin1 (their text is plain ASCII). */
async function seededTexts(): Promise<Record<string, string>> {
  const dir = join(await mkdtemp(join(tmpdir(), 'poc-scan-')), 'data');
  await writeSeed(dir, seed);
  const texts: Record<string, string> = {};
  for (const f of await allFiles(dir)) texts[f.slice(dir.length + 1)] = await readFile(f, 'latin1');
  return texts;
}

const DENY: [string, RegExp][] = [
  ['real mail providers', /\b(gmail|googlemail|hotmail|outlook\.com|live\.com|yahoo|icloud|aol\.com|proton(mail)?)\b/i],
  ['real vendors and platforms', /\b(microsoft\.com|office365|sharepoint|onedrive|zoom\.us|slack\.com|salesforce|workday|anthropic\.com|google\.com)\b/i],
  ['real comp survey vendors / consultancies', /\b(mercer|radford|willis towers|wtw|aon|korn ferry|payscale|salary\.com|culpepper|compensia|compensian|pearl meyer|meridian|fw cook|semler brossy)\b/i],
  ['URLs', /https?:\/\/|www\./i],
  ['real-looking TLDs', /\b[a-z0-9-]+\.(com|net|org|io|co|us|uk|ca|au|de|gov|edu|ai|dev|app)\b/i],
  ['phone numbers', /\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/],
  ['API keys / secrets', /sk-ant-|api[_-]?key|password|secret|bearer /i],
];

describe('seed contains invented data only', () => {
  it('every email address and domain is an invented .example domain', async () => {
    const texts = await seededTexts();
    const allowed = new Set(INVENTED_DOMAINS);
    for (const [path, text] of Object.entries(texts)) {
      for (const m of text.matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+)/g)) {
        expect(allowed.has(m[1]!.toLowerCase()), `${path}: ${m[0]}`).toBe(true);
      }
      for (const m of text.matchAll(/\b[a-z0-9-]+\.example\b/gi)) {
        expect(allowed.has(m[0].toLowerCase()), `${path}: ${m[0]}`).toBe(true);
      }
    }
  });

  it('nothing on the deny-list appears', async () => {
    const texts = await seededTexts();
    for (const f of await allFiles(join(import.meta.dirname, '..', 'files'))) texts[f] = await readFile(f, 'utf8');
    for (const [path, text] of Object.entries(texts)) {
      for (const [what, re] of DENY) {
        const hit = re.exec(text);
        expect(hit, `${path}: ${what}: "${hit?.[0]}"`).toBeNull();
      }
    }
  });

  it('every person name in a structured field is on the invented list', () => {
    const allowed = new Set(INVENTED_PEOPLE);
    const names: string[] = [
      ...seed.workspace.teamMembers.map((t) => t.name),
      ...seed.workspace.clients.flatMap((c) => c.contacts.map((x) => x.name)),
      ...[...seed.mail, ...seed.sent].flatMap((m) => [m.from.emailAddress.name, ...m.toRecipients.map((r) => r.emailAddress.name), ...m.ccRecipients.map((r) => r.emailAddress.name)]),
      ...seed.chat.map((m) => m.sender_display_name),
      ...seed.calendar.flatMap((e) => e.attendees.map((a) => a.emailAddress.name)),
      ...seed.canned.flatMap((c) => (c.mail ? [c.mail.from.name, ...(c.mail.to ?? []).map((t) => t.name)] : [c.chat!.sender_display_name])),
    ];
    for (const n of names) expect(allowed.has(n), n).toBe(true);
  });

  it('two-word capitalised names in free text are invented people or known non-people', async () => {
    // Catches a real name slipping into an email body or file. Extend NOT_PEOPLE when adding invented phrases.
    const NOT_PEOPLE = new Set([
      'Acme Tooling', 'Harborlight Freight', 'Quillon Robotics', 'Tessera Foods', 'Brightline Advisory', 'Market Pricing', 'Pricing Summary', 'Pay Structure',
      'Driver Pay', 'Job Levels', 'Pay Equity', 'Equity Memo', 'Memo Outline', 'Project Plan', 'Total Rewards', 'Compensation Manager', 'Business Partner',
      'Head of', 'Survey A', 'Survey B', 'Maintenance Technician', 'Maintenance Planner', 'Production Lead', 'Manufacturing Engineer', 'Quality Engineer',
      'Financial Analyst', 'Associate Engineer', 'Senior Engineer', 'Staff Engineer', 'Principal Engineer', 'Software Engineer', 'Junior Software', 'Senior Software',
      'Lead Robotics', 'Robotics Engineer', 'Field Robotics', 'Line Operator', 'Sanitation Associate', 'Line Supervisor', 'Shift Supervisor', 'Warehouse Lead',
      'Inventory Lead', 'QA Technician', 'QA Specialist', 'Production Associates', 'Warehouse Leads', 'Linehaul Driver', 'Local Delivery', 'Delivery Driver',
      'Driver Trainer', 'Proposed Level', 'Open Items', 'Next Steps', 'Headline Findings', 'Market Pricing Methodology', 'Draft Bands', 'HR Generalist',
      'Tooling Co', 'Market Pricing Summary', 'Data Request', 'Call Notes', 'Kickoff Notes', 'Engineering Titles', 'Questions For', 'Open Questions',
      'Proposed Bands', 'Regional Differentials', 'Cost To', 'CNC Machinist', 'CNC Lead', 'Structure Project', 'Structure Draft', 'Market Review', 'Structure Design',
      'Data Collection', 'Job Descriptions', 'Pay Survey', 'Methodology', 'Driver Census', 'Comparator Groups', 'Level Title',
    ]);
    const people = new Set(INVENTED_PEOPLE);
    const KNOWN_WORDS = new Set([...INVENTED_PEOPLE, ...CLIENTS.flatMap((c) => [c.name, ...c.nicknames])].flatMap((s) => s.split(/[\s.]+/)).filter(Boolean));
    const texts = await seededTexts();
    const suspects = new Set<string>();
    for (const [path, text] of Object.entries(texts)) {
      if (path.endsWith('.json') && !path.startsWith('mocks')) continue;
      for (const m of text.matchAll(/\b([A-Z][a-z]+) ([A-Z][a-z]+)\b/g)) {
        const pair = m[0];
        if (people.has(pair) || NOT_PEOPLE.has(pair)) continue;
        // pairs that are part of a known phrase
        if ([...NOT_PEOPLE].some((p) => p.includes(pair))) continue;
        // either word is part of an invented person or client name ("Hi Alex", "Each Acme") is fine
        if (KNOWN_WORDS.has(m[1]!) || KNOWN_WORDS.has(m[2]!)) continue;
        suspects.add(`${path}: ${pair}`);
      }
    }
    expect([...suspects]).toEqual([]);
  });
});

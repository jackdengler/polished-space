import { mkdtemp, readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CalEvent,
  CannedMessage,
  DATA_LAYOUT,
  GraphMessage,
  PROFILE_HEADINGS,
  SeedInfo,
  ZoomChatMessage,
  addDaysIso,
  eventSpanMs,
  resolveNow,
  sectionKeyFor,
} from '@poc/contracts';
// Planr's own validator, imported from the app (no copy of the schema).
import { parseWorkspace } from '../../../src/model/schema';
import { buildSeed, writeSeed, SEED_FILES_DIR } from './build';
import { ACME, CLIENTS, HARBORLIGHT, INTERNAL, ME } from './people';

const NOW = resolveNow('2026-11-13T13:47:00Z'); // a Friday afternoon
const seed = buildSeed(NOW, 'UTC', NOW);
const today = '2026-11-13';
const NEW_FIELDS = ['emailDomains', 'contacts', 'fileFolder', 'nicknames'] as const;

describe('seeded Planr workspace', () => {
  const raw = JSON.parse(JSON.stringify(seed.workspace)) as { clients: Record<string, unknown>[] };

  it("passes Planr's parseWorkspace", () => {
    expect(() => parseWorkspace(raw)).not.toThrow();
  });

  it('carries the four new client fields in the JSON', () => {
    for (const c of raw.clients) for (const f of NEW_FIELDS) expect(c).toHaveProperty(f);
    const acme = raw.clients.find((c) => c.id === ACME.id)!;
    expect(acme.emailDomains).toEqual(['acmetooling.example']);
    expect(acme.nicknames).toEqual(['Acme', 'ATC']);
    expect(acme.fileFolder).toBe('Acme Tooling');
    expect(acme.contacts).toContainEqual({ name: 'Michael Okafor', email: 'michael.okafor@acmetooling.example', role: 'VP HR' });
  });

  it('new fields: either stripped by the current schema or kept exactly (after Phase 1 adds them)', () => {
    // Today Planr's ClientSchema is a plain z.object, which strips unknown keys:
    // parseWorkspace accepts the file but drops the four fields from its result.
    // Phase 1 (1A) adds them with defaults; from then on they must round-trip.
    // pm-server must not write parseWorkspace's output back to disk before 1A lands.
    const parsed = parseWorkspace(raw) as unknown as { clients: Record<string, unknown>[] };
    for (const [i, c] of parsed.clients.entries()) {
      for (const f of NEW_FIELDS) {
        if (f in c) expect(c[f]).toEqual(raw.clients[i]![f]);
      }
    }
    const stripped = NEW_FIELDS.every((f) => !(f in parsed.clients[0]!));
    const kept = NEW_FIELDS.every((f) => f in parsed.clients[0]!);
    expect(stripped || kept).toBe(true);
  });

  it('has the five invented clients and Alex Rivera on the team', () => {
    expect(seed.workspace.clients.map((c) => c.name)).toEqual(['Acme Tooling Co.', 'Harborlight Freight', 'Quillon Robotics', 'Tessera Foods', 'Internal']);
    expect(seed.workspace.teamMembers.find((t) => t.id === ME.id)?.name).toBe('Alex Rivera');
    expect(seed.info.internalClientId).toBe(INTERNAL.id);
  });

  it('spreads open tasks across overdue, today, this week and the next weeks', () => {
    const tasks = seed.workspace.clients.flatMap((c) =>
      [...c.adhoc.deliverables, ...c.meetings.flatMap((m) => m.deliverables)].flatMap((d) => d.tasks.map((t) => ({ ...t, clientId: c.id }))),
    );
    const ids = tasks.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const sections = new Set(tasks.filter((t) => !t.done).map((t) => sectionKeyFor({ dueDate: t.dueDate, onHold: false, clientId: t.clientId }, today, INTERNAL.id)));
    for (const s of ['overdue', 'today', 'tomorrow', 'next_week', 'next_week_1', 'next_week_2', 'inbox', 'internal']) expect(sections).toContain(s);
    expect(tasks.filter((t) => !t.done && t.dueDate === today && t.assigneeIds.includes(ME.id)).length).toBeGreaterThanOrEqual(2);
    expect(tasks.some((t) => t.done)).toBe(true);
  });
});

describe('seeded mocks data matches the contracts', () => {
  it('mail, sent, chat, calendar, canned and seed info all parse', () => {
    for (const m of [...seed.mail, ...seed.sent]) GraphMessage.parse(m);
    for (const m of seed.chat) ZoomChatMessage.parse(m);
    for (const e of seed.calendar) CalEvent.parse(e);
    for (const c of seed.canned) CannedMessage.parse(c);
    SeedInfo.parse(seed.info);
  });

  it('history is before now (it is context, not new work)', () => {
    for (const m of [...seed.mail, ...seed.sent]) expect(Date.parse(m.receivedDateTime)).toBeLessThanOrEqual(NOW.getTime());
    for (const m of seed.chat) expect(m.timestamp).toBeLessThanOrEqual(NOW.getTime());
    expect(seed.info.intakeCursor).toBe(NOW.toISOString());
  });

  it('chat is personal chats and general channels only, no client channels', () => {
    const names = CLIENTS.flatMap((c) => [c.name, ...c.nicknames]).map((s) => s.toLowerCase());
    for (const m of seed.chat) if (m.channel_name) expect(names.some((n) => m.channel_name!.toLowerCase().includes(n))).toBe(false);
  });

  it('has the canned demo messages the script needs', () => {
    const by = Object.fromEntries(seed.canned.map((c) => [c.key, c]));
    const step2 = by['acme-update-and-meeting']!;
    expect(step2.step).toBe(2);
    expect(step2.mail?.from.name).toBe('Michael Okafor');
    expect(step2.mail?.body).toMatch(/update/i);
    expect(step2.mail?.body).toMatch(/meet|minutes/i);
    expect(seed.canned.filter((c) => c.step === 5 && c.chat).length).toBeGreaterThanOrEqual(2);
    expect(seed.canned.some((c) => c.expect.directions.includes('owed_to_me'))).toBe(true);
    expect(seed.canned.some((c) => c.expect.confidence === 'low')).toBe(true);
    expect(by['acme-update-repeat']!.expect.duplicateOfKey).toBe('acme-update-and-meeting');
    // Every expected client exists, and every duplicateOfKey points at a real key.
    for (const c of seed.canned) {
      if (c.expect.clientId) expect(CLIENTS.map((x) => x.id)).toContain(c.expect.clientId);
      if (c.expect.duplicateOfKey) expect(by[c.expect.duplicateOfKey]).toBeDefined();
    }
    // The ambiguous message must not name a client or nickname.
    const amb = by['ambiguous-robo-team']!.chat!.message.toLowerCase();
    for (const c of CLIENTS.filter((x) => x.id !== INTERNAL.id)) for (const n of [c.name, ...c.nicknames]) expect(amb).not.toMatch(new RegExp(`\\b${n.toLowerCase()}\\b`));
    // The Harbor chat names a file that exists in the Harborlight folder.
    const harbor = by['harbor-file-review']!.chat!.message;
    const file = /"([^"]+\.pdf)"/.exec(harbor)?.[1];
    expect(Object.keys(seed.pdfs)).toContain(`${HARBORLIGHT.fileFolder}/${file}`);
  });
});

describe('profiles', () => {
  it('one per client (not Internal), with the fixed headings in order', () => {
    expect(seed.profiles.map((p) => p.slug)).toEqual(['acme-tooling-co', 'harborlight-freight', 'quillon-robotics', 'tessera-foods']);
    for (const p of seed.profiles) {
      const headings = p.markdown.split('\n').filter((l) => /^#{1,2} /.test(l));
      expect(headings.length).toBe(PROFILE_HEADINGS.length);
      expect(headings.slice(1)).toEqual(PROFILE_HEADINGS.slice(1));
      expect(headings[0]).toMatch(/^# \S/);
    }
  });
});

describe('PDFs', () => {
  it('are structurally valid (header, xref offsets, EOF)', () => {
    for (const [path, bytes] of Object.entries(seed.pdfs)) {
      const text = Buffer.from(bytes).toString('latin1');
      expect(text.startsWith('%PDF-1.4\n'), path).toBe(true);
      expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
      const startxref = Number(/startxref\n(\d+)\n/.exec(text)![1]);
      expect(text.slice(startxref, startxref + 4)).toBe('xref');
      const offsets = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
      offsets.forEach((off, i) => expect(text.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    }
  });
});

describe('writeSeed', () => {
  it('writes the data layout, the sandbox marker and empty brain state', async () => {
    const dir = join(await mkdtemp(join(tmpdir(), 'poc-seed-')), 'data');
    await writeSeed(dir, seed);
    for (const rel of [DATA_LAYOUT.pmWorkspace, DATA_LAYOUT.pmMarker, DATA_LAYOUT.mocksMail, DATA_LAYOUT.mocksSent, DATA_LAYOUT.mocksCalendar, DATA_LAYOUT.mocksChat, DATA_LAYOUT.mocksCanned, 'mocks/initial/mail.json', DATA_LAYOUT.seedInfo, 'profiles/acme-tooling-co.md', 'files/Harborlight Freight/HLF Driver Pay Structure Draft.pdf']) {
      expect((await stat(join(dir, rel))).isFile(), rel).toBe(true);
    }
    expect(await readdir(join(dir, 'brain'))).toEqual([]);
    expect(await readdir(join(dir, 'logs'))).toEqual([]);
    const ws = JSON.parse(await readFile(join(dir, DATA_LAYOUT.pmWorkspace), 'utf8'));
    expect(() => parseWorkspace(ws)).not.toThrow();
    // every committed text file was copied
    for (const folder of await readdir(SEED_FILES_DIR)) {
      for (const f of await readdir(join(SEED_FILES_DIR, folder))) expect((await stat(join(dir, 'files', folder, f))).isFile()).toBe(true);
    }
    // re-seeding over our own folder works
    await writeSeed(dir, seed);
  });

  it('refuses to wipe a folder that is not a POC data folder', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'poc-foreign-'));
    await mkdir(join(dir, 'stuff'));
    await writeFile(join(dir, 'stuff', 'important.txt'), 'keep me');
    await expect(writeSeed(dir, seed)).rejects.toThrow(/Refusing/);
    expect(await readFile(join(dir, 'stuff', 'important.txt'), 'utf8')).toBe('keep me');
  });
});

describe('dates are relative to now', () => {
  it('moves with POC_NOW', () => {
    const later = buildSeed(resolveNow('2026-12-02T10:00:00Z'), 'UTC');
    const due = (s: typeof seed) => s.workspace.clients[0]!.adhoc.deliverables[0]!.tasks[0]!.dueDate;
    expect(due(seed)).toBe(addDaysIso('2026-11-13', -2));
    expect(due(later)).toBe(addDaysIso('2026-12-02', -2));
    expect(eventSpanMs(later.calendar[0]!).start).toBeGreaterThan(eventSpanMs(seed.calendar[0]!).start);
  });
});

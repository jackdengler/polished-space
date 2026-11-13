/**
 * The mocks' data: plain JSON arrays in `<dataDir>/mocks/`, written by the
 * seed. Every read goes to disk and every write is atomic (temp file in the
 * same folder, then rename), so a re-seed or a hand edit is picked up at once
 * and a crash never leaves half a file. The service is one Node process and
 * uses sync file calls, so a read-modify-write can never interleave.
 */
import { copyFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';
import {
  CalEvent,
  CannedMessage,
  DATA_LAYOUT,
  GraphMessage,
  SeedInfo,
  ZoomChatMessage,
} from '@poc/contracts';

const FILES = {
  mail: { rel: DATA_LAYOUT.mocksMail, schema: z.array(GraphMessage) },
  sent: { rel: DATA_LAYOUT.mocksSent, schema: z.array(GraphMessage) },
  calendar: { rel: DATA_LAYOUT.mocksCalendar, schema: z.array(CalEvent) },
  chat: { rel: DATA_LAYOUT.mocksChat, schema: z.array(ZoomChatMessage) },
  canned: { rel: DATA_LAYOUT.mocksCanned, schema: z.array(CannedMessage) },
} as const;

type Files = typeof FILES;
export type StoreName = keyof Files;
type Item<K extends StoreName> = z.infer<Files[K]['schema']>[number];

/** The stores `/_control/reset` restores from `mocks/initial/` (canned never changes). */
export const RESETTABLE = ['mail', 'sent', 'calendar', 'chat'] as const satisfies readonly StoreName[];

/** `mocks/mail.json` -> `mocks/initial/mail.json`. */
const initialRel = (rel: string) => join(dirname(rel), 'initial', basename(rel));

export class Store {
  constructor(readonly dataDir: string) {}

  private path(rel: string): string {
    return join(this.dataDir, rel);
  }

  /** Throws a readable error when the seed has not been run. */
  assertSeeded(): void {
    const missing = [...Object.values(FILES).map((f) => f.rel), ...RESETTABLE.map((k) => initialRel(FILES[k].rel)), DATA_LAYOUT.seedInfo]
      .filter((rel) => !existsSync(this.path(rel)));
    if (missing.length) {
      throw new Error(`mocks: missing ${missing.join(', ')} under ${this.dataDir}. Run \`npm --prefix poc run seed\` first.`);
    }
  }

  read<K extends StoreName>(name: K): Item<K>[] {
    const { rel, schema } = FILES[name];
    const raw: unknown = JSON.parse(readFileSync(this.path(rel), 'utf8'));
    return schema.parse(raw) as Item<K>[];
  }

  write<K extends StoreName>(name: K, items: Item<K>[]): void {
    writeJsonAtomic(this.path(FILES[name].rel), items);
  }

  /** Append one item and save. */
  append<K extends StoreName>(name: K, item: Item<K>): void {
    this.write(name, [...this.read(name), item]);
  }

  seedInfo(): SeedInfo {
    return SeedInfo.parse(JSON.parse(readFileSync(this.path(DATA_LAYOUT.seedInfo), 'utf8')));
  }

  /** Copy the pristine seed files back over the live ones. */
  reset(): void {
    for (const name of RESETTABLE) {
      const rel = FILES[name].rel;
      const tmp = `${this.path(rel)}.tmp-${process.pid}`;
      copyFileSync(this.path(initialRel(rel)), tmp);
      renameSync(tmp, this.path(rel));
    }
  }
}

export function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

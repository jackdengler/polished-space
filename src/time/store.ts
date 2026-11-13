import { create } from 'zustand';
import type { StorageAdapter } from '../storage/adapter';
import {
  normalize, PersonalTimeSchema, retarget, startTimer, stopTimer, type Target, type TimeEntry, type Timer,
} from './model';

/**
 * The current person's time entries and running timer. Personal data: saved
 * through the adapter's personal store (its own file / key), apart from the
 * shared workspace. No undo here — deletes are confirmed instead.
 */
interface TimeState {
  ownerId: string | null;
  entries: TimeEntry[];
  timer: Timer | null;
  status: 'off' | 'loading' | 'ready' | 'error';
  error: string | null;
}

export const useTime = create<TimeState>(() => ({ ownerId: null, entries: [], timer: null, status: 'off', error: null }));

let adapter: StorageAdapter | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> = Promise.resolve();
const newId = () => `te_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/** Load the person's time (or start empty). Called when the workspace or "me" changes. */
export async function initTime(a: StorageAdapter | null, ownerId: string | null) {
  clearTimeout(saveTimer);
  adapter = a;
  if (!a || !ownerId) { useTime.setState({ ownerId: null, entries: [], timer: null, status: 'off', error: null }); return; }
  useTime.setState({ ownerId, status: 'loading', error: null });
  try {
    const raw = await a.loadPersonal(ownerId);
    const data = normalize(PersonalTimeSchema.parse(raw ?? {}));
    if (useTime.getState().ownerId !== ownerId) return; // switched meanwhile
    useTime.setState({ ...data, status: 'ready' });
  } catch (e) {
    useTime.setState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}

function persist(now = false) {
  clearTimeout(saveTimer);
  const run = () => {
    saving = saving.then(async () => {
      const { ownerId, entries, timer, status } = useTime.getState();
      if (!adapter || !ownerId || status !== 'ready') return;
      try { await adapter.savePersonal(ownerId, { entries, timer }); useTime.setState({ error: null }); }
      catch (e) { useTime.setState({ error: e instanceof Error ? e.message : String(e) }); }
    });
  };
  if (now) run(); else saveTimer = setTimeout(run, 400); // typing in a note waits for a pause
}

const add = (entries: TimeEntry[], e: TimeEntry | null) => (e ? [e, ...entries].sort((a, b) => Date.parse(b.startISO) - Date.parse(a.startISO)) : entries);

export const time = {
  /** Start a timer (stopping and saving any running one first). */
  start(target: Target = {}) {
    const { timer, entries } = useTime.getState();
    const now = new Date();
    useTime.setState({ entries: timer ? add(entries, stopTimer(timer, now)) : entries, timer: startTimer(target, now) });
    persist(true);
  },
  /** Stop and save the running timer (a 0-second timer saves nothing). */
  stop() {
    const { timer, entries } = useTime.getState();
    if (!timer) return;
    useTime.setState({ timer: null, entries: add(entries, stopTimer(timer, new Date())) });
    persist(true);
  },
  /** Change what the running timer is on; switching clients saves the stretch and restarts at now. */
  retarget(patch: Target, opts: { quiet?: boolean } = {}) {
    const { timer, entries } = useTime.getState();
    if (!timer) return;
    const r = retarget(timer, patch, new Date());
    useTime.setState({ timer: r.timer, entries: add(entries, r.saved) });
    persist(!opts.quiet && !!r.saved);
  },
  /** Move the running timer's start (edit dialog). */
  setTimerStart(startedAtISO: string) {
    const { timer } = useTime.getState();
    if (timer) { useTime.setState({ timer: { ...timer, startedAtISO } }); persist(true); }
  },
  add(e: Omit<TimeEntry, 'id'>) {
    useTime.setState({ entries: add(useTime.getState().entries, { ...e, id: newId() }) });
    persist(true);
  },
  update(id: string, patch: Partial<Omit<TimeEntry, 'id'>>, opts: { quiet?: boolean } = {}) {
    useTime.setState({ entries: useTime.getState().entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
    persist(!opts.quiet);
  },
  remove(id: string) {
    useTime.setState({ entries: useTime.getState().entries.filter((e) => e.id !== id) });
    persist(true);
  },
  duplicate(id: string) {
    const e = useTime.getState().entries.find((x) => x.id === id);
    if (e) time.add({ ...e });
  },
  /** New timer copying a past entry's client, deliverable, note and OpenAir task (the old entry is untouched). */
  resume(id: string) {
    const e = useTime.getState().entries.find((x) => x.id === id);
    if (e) time.start({ clientId: e.clientId, deliverableId: e.deliverableId, openAirTaskId: e.openAirTaskId, note: e.note });
  },
  /** Move many entries at once (group edit). */
  moveMany(ids: string[], patch: Partial<Pick<TimeEntry, 'clientId' | 'deliverableId' | 'openAirTaskId'>>) {
    const set = new Set(ids);
    useTime.setState({ entries: useTime.getState().entries.map((e) => (set.has(e.id) ? { ...e, ...patch } : e)) });
    persist(true);
  },
  /** Save the running timer before a client is deleted or archived. */
  stopIfOnClient(clientId: string): boolean {
    if (useTime.getState().timer?.clientId !== clientId) return false;
    time.stop();
    return true;
  },
};

/** Flush pending saves (page hide). */
export const flushTime = () => persist(true);

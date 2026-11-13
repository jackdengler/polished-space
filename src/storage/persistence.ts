import { create } from 'zustand';
import type { Workspace } from '../model/schema';
import { navigate } from '../router';
import { useStore } from '../store/store';
import { ConflictError, type StorageAdapter } from './adapter';

export type SaveState = 'saved' | 'pending' | 'saving' | 'error' | 'conflict';

interface PersistenceState {
  adapter: StorageAdapter | null;
  status: SaveState;
  error: string | null;
}

export const usePersistence = create<PersistenceState>(() => ({ adapter: null, status: 'saved', error: null }));

const SAVE_DELAY_MS = 600;
let timer: ReturnType<typeof setTimeout> | undefined;
let unsubscribe: (() => void) | undefined;
let saving: Promise<void> = Promise.resolve();

/** Start autosaving the store to `adapter`, beginning from `ws`. */
export function attach(adapter: StorageAdapter, ws: Workspace) {
  unsubscribe?.();
  clearTimeout(timer);
  useStore.getState().load(ws);
  usePersistence.setState({ adapter, status: 'saved', error: null });
  unsubscribe = useStore.subscribe((s, prev) => {
    if (s.ws !== prev.ws) schedule();
  });
}

function schedule() {
  if (usePersistence.getState().status === 'conflict') return; // wait for the user's decision
  usePersistence.setState({ status: 'pending' });
  clearTimeout(timer);
  timer = setTimeout(() => void flush(), SAVE_DELAY_MS);
}

/** Save now. Saves run one at a time, always with the latest data. */
export function flush(force = false): Promise<void> {
  clearTimeout(timer);
  saving = saving.then(async () => {
    const { adapter } = usePersistence.getState();
    if (!adapter) return;
    usePersistence.setState({ status: 'saving' });
    try {
      await adapter.save(useStore.getState().ws, { force });
      usePersistence.setState({ status: 'saved', error: null });
    } catch (e) {
      if (e instanceof ConflictError) usePersistence.setState({ status: 'conflict', error: e.message });
      else usePersistence.setState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  });
  return saving;
}

/** Conflict resolution: keep what's in the app and overwrite the file. */
export const overwriteWithMine = () => flush(true);

/** Conflict resolution: discard in-app changes and load the file from disk. */
export async function reloadFromDisk() {
  const { adapter } = usePersistence.getState();
  if (!adapter) return;
  const ws = await adapter.load();
  if (ws) attach(adapter, ws);
}

export const hasUnsavedChanges = () => usePersistence.getState().status !== 'saved';

/** Save, stop autosaving, and go back to the welcome screen. */
export async function closeWorkspace() {
  if (usePersistence.getState().status !== 'conflict') await flush();
  unsubscribe?.();
  unsubscribe = undefined;
  usePersistence.setState({ adapter: null, status: 'saved', error: null });
  navigate({}, { replace: true });
}

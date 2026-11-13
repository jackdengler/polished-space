/** Remembers the chosen folder between visits (folder handles can be stored in IndexedDB). */
const DB = 'compensian-pm';
const STORE = 'kv';
const KEY = 'workspace-folder';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getSavedFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return ((await run('readonly', (s) => s.get(KEY))) as FileSystemDirectoryHandle | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function saveFolder(handle: FileSystemDirectoryHandle): Promise<void> {
  try { await run('readwrite', (s) => s.put(handle, KEY)); } catch { /* not fatal */ }
}

export async function forgetFolder(): Promise<void> {
  try { await run('readwrite', (s) => s.delete(KEY)); } catch { /* not fatal */ }
}

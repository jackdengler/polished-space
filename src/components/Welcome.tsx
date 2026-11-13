import { useEffect, useState } from 'react';
import { makeDemoWorkspace } from '../model/demo';
import { emptyWorkspace, type Workspace } from '../model/schema';
import { FolderAdapter } from '../storage/folderAdapter';
import { forgetFolder, getSavedFolder, saveFolder } from '../storage/handleStore';
import { clearSavedBrowserWorkspace, loadSavedBrowserWorkspace, MemoryAdapter } from '../storage/memoryAdapter';
import { confirmDialog, ConfirmHost } from './Modal';
import { readSeed } from '../seed';
import { embedded } from '../lib/env';
import { attach, flush } from '../storage/persistence';
import { Icon } from './Icon';
import { BrandMark } from './BrandMark';

const supported = typeof window.showDirectoryPicker === 'function' && !embedded;
const BROWSER_KEY = 'compensian-pm-demo';
const seed = readSeed();
/** `?storage=opfs` uses the browser's private file system instead of a picked folder (for automated tests). */
const testStorage = new URLSearchParams(location.search).get('storage') === 'opfs';

export function Welcome() {
  const [saved, setSaved] = useState<FileSystemDirectoryHandle | null>(null);
  const [emptyFolder, setEmptyFolder] = useState<FolderAdapter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [browserWs, setBrowserWs] = useState(() => loadSavedBrowserWorkspace(BROWSER_KEY));
  const startInBrowser = (ws: Workspace) => {
    const adapter = new MemoryAdapter(ws, BROWSER_KEY, seed?.logos);
    attach(adapter, ws);
    void flush();
  };
  async function eraseBrowser() {
    if (await confirmDialog({ title: 'Erase what this browser saved?', message: 'All clients and tasks kept in this browser will be deleted. This can’t be undone.', confirmLabel: 'Erase', danger: true })) {
      clearSavedBrowserWorkspace(BROWSER_KEY);
      setBrowserWs(null);
    }
  }

  useEffect(() => {
    if (testStorage) return;
    void getSavedFolder().then(async (h) => {
      if (!h) return;
      setSaved(h);
      // Chrome may remember the permission; if so, open straight away.
      if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') void open(h);
    });
  }, []);

  async function open(handle: FileSystemDirectoryHandle) {
    setError(null);
    setBusy(true);
    try {
      if ((await handle.queryPermission({ mode: 'readwrite' })) !== 'granted' &&
          (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') {
        setError('Permission to the folder was not granted.');
        return;
      }
      const adapter = new FolderAdapter(handle);
      const ws = await adapter.load();
      // Test storage isn't remembered: headless Chromium crashes reloading a page whose IndexedDB holds a private-file-system handle.
      if (!testStorage) await saveFolder(handle);
      if (ws) attach(adapter, ws);
      else setEmptyFolder(adapter);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function pick() {
    try {
      const handle = testStorage ? await navigator.storage.getDirectory() : await window.showDirectoryPicker!({ id: 'compensian-pm', mode: 'readwrite' });
      await open(handle);
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function start(adapter: FolderAdapter, ws: Workspace) {
    attach(adapter, ws);
    await flush(); // create workspace.json right away
  }

  if (emptyFolder) {
    return (
      <Shell>
        <h2 className="welcome-h2">Set up “{emptyFolder.name}”</h2>
        <p className="muted">This folder doesn't have a workspace yet. A <code>workspace.json</code> file will be created in it.</p>
        <div className="welcome-actions">
          <button className="btn btn-primary btn-lg" onClick={() => void start(emptyFolder, emptyWorkspace())}>Start empty</button>
          <button className="btn btn-lg" onClick={() => void start(emptyFolder, makeDemoWorkspace())}>Start with demo data</button>
          <button className="btn btn-ghost" onClick={() => setEmptyFolder(null)}>Back</button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="welcome-lead">Track client meetings, deliverables and tasks.</p>
      <div className="welcome-actions">
        {saved && (
          <button className="btn btn-primary btn-lg" disabled={busy} onClick={() => void open(saved)}>
            <Icon name="folder" size={16} /> Reopen “{saved.name}”
          </button>
        )}
        {(supported || testStorage) && (
          <button className={`btn btn-lg${saved || seed ? '' : ' btn-primary'}`} disabled={busy} onClick={() => void pick()}>
            <Icon name="folder" size={16} /> {testStorage ? 'Use test storage' : saved ? 'Open a different folder' : 'Open or create a workspace folder'}
          </button>
        )}
        {browserWs ? (
          <>
            <button className={`btn btn-lg${supported || testStorage ? '' : ' btn-primary'}`} onClick={() => startInBrowser(browserWs)}>
              Continue in this browser ({browserWs.clients.length} client{browserWs.clients.length === 1 ? '' : 's'})
            </button>
            {seed && (
              <button className="btn btn-lg" onClick={async () => {
                if (await confirmDialog({
                  title: `Load my ${seed.workspace.clients.length} clients?`,
                  message: 'This replaces what this browser has saved (including any changes you made here).',
                  confirmLabel: 'Load my clients', danger: true,
                })) startInBrowser(seed.workspace);
              }}>
                Load my {seed.workspace.clients.length} clients
              </button>
            )}
          </>
        ) : (
          <>
            {seed && (
              <button className="btn btn-lg btn-primary" onClick={() => startInBrowser(seed.workspace)}>
                Open my clients ({seed.workspace.clients.length})
              </button>
            )}
            <button className={`btn btn-lg${supported || testStorage || seed ? '' : ' btn-primary'}`} onClick={() => startInBrowser(makeDemoWorkspace())}>Try the demo</button>
            <button className="btn btn-lg" onClick={() => startInBrowser(emptyWorkspace())}>Start empty in this browser</button>
          </>
        )}
      </div>
      {browserWs && <button className="link small" onClick={() => void eraseBrowser()}>Erase what this browser saved…</button>}
      {saved && <button className="link small" onClick={() => { void forgetFolder(); setSaved(null); }}>Forget “{saved.name}”</button>}
      {error && <p className="welcome-error" role="alert"><Icon name="alert" size={14} /> {error}</p>}
      {!supported && !testStorage && (
        <p className="welcome-note">
          {embedded
            ? 'Here, your work is saved in this browser. To save to a folder (e.g. OneDrive), open the full app in Chrome or Edge.'
            : "This browser can't save to a folder. Open the app in Chrome or Edge, or try the demo."}
        </p>
      )}
      <p className="welcome-fine">
        {supported ? 'Your data stays in the folder you choose (OneDrive is fine). Nothing is uploaded. ' : ''}
        The demo uses fictional sample data. You can import more client files from the sidebar.
      </p>
      <ConfirmHost />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="brand big"><BrandMark size={30} /><span className="brand-name">Planr</span></div>
        {children}
      </div>
    </div>
  );
}

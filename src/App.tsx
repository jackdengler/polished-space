import { useEffect } from 'react';
import { ClientPage } from './components/ClientPage';
import { Icon } from './components/Icon';
import { ConfirmHost } from './components/Modal';
import { Sidebar } from './components/Sidebar';
import { TeamSettings } from './components/TeamSettings';
import { Welcome } from './components/Welcome';
import { navigate, useRoute } from './router';
import { useStore } from './store/store';
import { flush, hasUnsavedChanges, overwriteWithMine, reloadFromDisk, usePersistence } from './storage/persistence';

function useGlobalKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, [contenteditable="true"]')) return; // let fields handle their own undo
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); useStore.getState().undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); useStore.getState().redo(); }
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (usePersistence.getState().adapter?.kind === 'folder' && hasUnsavedChanges()) { void flush(); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onUnload); };
  }, []);
}

function Banners() {
  const { status, error, adapter } = usePersistence();
  if (adapter?.kind === 'memory') {
    return <div className="banner info">Demo mode — sample data, changes aren't saved.</div>;
  }
  if (status === 'conflict') {
    return (
      <div className="banner warn" role="alert">
        <Icon name="alert" size={15} />
        <span><b>workspace.json changed outside the app</b> (maybe on another computer). Your latest changes aren't saved yet.</span>
        <button className="btn btn-sm" onClick={() => void reloadFromDisk()}>Load the file's version</button>
        <button className="btn btn-sm btn-primary" onClick={() => void overwriteWithMine()}>Keep mine</button>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="banner warn" role="alert">
        <Icon name="alert" size={15} /><span><b>Couldn't save:</b> {error}</span>
        <button className="btn btn-sm" onClick={() => void flush()}>Try again</button>
      </div>
    );
  }
  return null;
}

export function App() {
  useGlobalKeys();
  const adapter = usePersistence((s) => s.adapter);
  const route = useRoute();
  const clients = useStore((s) => s.ws.clients);
  const client = clients.find((c) => c.id === route.clientId);

  // Nothing selected (or the client was deleted) → open the first active client.
  useEffect(() => {
    if (!adapter || client) return;
    const first = [...clients].filter((c) => !c.archived).sort((a, b) => a.name.localeCompare(b.name))[0];
    if (first) navigate({ clientId: first.id }, { replace: true });
  }, [adapter, client, clients]);

  if (!adapter) return <Welcome />;

  return (
    <div className="app">
      <Sidebar route={route} />
      <main className="main">
        <Banners />
        {client
          ? <ClientPage key={client.id} client={client} route={route} />
          : <div className="empty-main"><p>No client selected.</p><p className="muted">Add a client with the + in the sidebar.</p></div>}
      </main>
      <TeamSettings />
      <ConfirmHost />
    </div>
  );
}

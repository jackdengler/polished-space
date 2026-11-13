import { useEffect, useState } from 'react';
import { usePrefs } from './prefs';
import { useUi } from './ui';
import { ClientPage } from './components/ClientPage';
import { Icon } from './components/Icon';
import { ConfirmHost } from './components/Modal';
import { Sidebar } from './components/Sidebar';
import { TeamSettings } from './components/TeamSettings';
import { Welcome } from './components/Welcome';
import { TopBar } from './components/TopBar';
import { WeekPage } from './components/WeekPage';
import { StaffingPage } from './components/StaffingPage';
import { MonthPage } from './components/MonthPage';
import { TimePage } from './components/time/TimePage';
import { flushTime, initTime } from './time/store';
import { WhoAmIModal } from './components/WhoAmI';
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
    const onHide = () => { if (document.visibilityState === 'hidden') flushTime(); };
    document.addEventListener('visibilitychange', onHide);
    const onUnload = (e: BeforeUnloadEvent) => {
      flushTime();
      if (usePersistence.getState().adapter?.kind === 'folder' && hasUnsavedChanges()) { void flush(); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', onUnload);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onUnload); document.removeEventListener('visibilitychange', onHide); };
  }, []);
}

function Banners() {
  const { status, error, adapter } = usePersistence();
  if (adapter?.kind === 'memory') {
    if (status !== 'error') return null;
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

/** Explicit light/dark sets data-theme; "system" leaves it to the OS (or the hosting page). */
function useTheme() {
  const theme = usePrefs((s) => s.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') { if (root.dataset.appTheme) { delete root.dataset.theme; delete root.dataset.appTheme; } }
    else { root.dataset.theme = theme; root.dataset.appTheme = '1'; }
  }, [theme]);
}

function Toast() {
  const text = useUi((s) => s.toast);
  return text ? <div className="toast" role="status">{text}</div> : null;
}

export function App() {
  useGlobalKeys();
  useTheme();
  const [navOpen, setNavOpen] = useState(false);
  const adapter = usePersistence((s) => s.adapter);
  const route = useRoute();
  const clients = useStore((s) => s.ws.clients);
  const client = clients.find((c) => c.id === route.clientId);

  // Nothing selected (or the client was deleted) → start on This week.
  useEffect(() => {
    if (!adapter || client || route.weekPage || route.staffingPage || route.monthPage || route.timePage) return;
    navigate({ weekPage: true }, { replace: true });
  }, [adapter, client, route.weekPage, route.staffingPage, route.monthPage, route.timePage]);

  // Load this person's time whenever the workspace or "me" changes.
  const meId = usePrefs((s) => s.meId);
  const meExists = useStore((s) => s.ws.teamMembers.some((m) => m.id === meId));
  useEffect(() => { void initTime(adapter, meExists ? meId : null); }, [adapter, meId, meExists]);

  if (!adapter) return <Welcome />;

  return (
    <div className={`app${navOpen ? ' nav-open' : ''}`}>
      <Sidebar route={route} onNavigate={() => setNavOpen(false)} />
      <div className="nav-scrim" onClick={() => setNavOpen(false)} />
      <main className="main">
        <button className="nav-toggle icon-btn" aria-label="Open navigation" onClick={() => setNavOpen(true)}><Icon name="menu" size={18} /></button>
        <TopBar route={route} />
        <Banners />
        {route.timePage
          ? <TimePage />
          : route.staffingPage
          ? <StaffingPage />
          : route.monthPage
          ? <MonthPage month={route.month ?? null} />
          : route.weekPage
          ? <WeekPage week={route.week ?? null} />
          : client
          ? <ClientPage key={client.id} client={client} route={route} />
          : <div className="empty-main"><p>No client selected.</p><p className="muted">Add a client with the + in the sidebar.</p></div>}
      </main>
      <TeamSettings />
      <Toast />
      <WhoAmIModal />
      <ConfirmHost />
    </div>
  );
}

import { useState } from 'react';
import { todayIso } from '../model/dates';
import type { Route } from '../router';
import { useStore } from '../store/store';
import { embedded } from '../lib/env';
import { usePersistence } from '../storage/persistence';
import { Icon } from './Icon';
import { Modal } from './Modal';

/** Breadcrumb on the left; undo/redo, where things are saved, and backup on the right. */
export function TopBar({ route }: { route: Route }) {
  const client = useStore((s) => s.ws.clients.find((c) => c.id === route.clientId));
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const [backup, setBackup] = useState(false);
  return (
    <div className="topbar">
      <nav className="crumbs" aria-label="Breadcrumb">
        {route.weekPage ? <span className="crumb-current">This week</span> : client ? (
          <>
            <span className="crumb">Clients</span>
            <span className="crumb-sep">/</span>
            <span className="crumb-current">{client.name}</span>
          </>
        ) : <span className="crumb-current">Clients</span>}
      </nav>
      <div className="topbar-tools">
        <button className="icon-btn" disabled={!canUndo} onClick={() => useStore.getState().undo()} aria-label="Undo" title="Undo (Ctrl+Z)"><Icon name="undo" size={15} /></button>
        <button className="icon-btn" disabled={!canRedo} onClick={() => useStore.getState().redo()} aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><Icon name="redo" size={15} /></button>
        <span className="topbar-sep" />
        <SavePill />
        <button className="btn btn-sm" onClick={() => (embedded ? setBackup(true) : downloadBackup())}><Icon name="download" size={14} /> Export backup</button>
      </div>
      {backup && <BackupModal onClose={() => setBackup(false)} />}
    </div>
  );
}

function SavePill() {
  const { status, adapter, error } = usePersistence();
  if (status === 'error' || status === 'conflict') {
    return <span className="save-pill bad" title={error ?? undefined} role="status"><span className="dot" />{status === 'conflict' ? 'Needs attention' : 'Save failed'}</span>;
  }
  const busy = status === 'pending' || status === 'saving';
  if (adapter?.kind === 'memory') {
    return <span className="save-pill local" role="status" title="Clearing your browser data erases it. Export a backup to keep a copy."><span className="dot" />{busy ? 'Saving…' : 'Saved in this browser only'}</span>;
  }
  return <span className="save-pill ok" role="status" title={`Saved to ${adapter?.name ?? 'your folder'}`}><span className="dot" />{busy ? 'Saving…' : 'Saved'}</span>;
}

const backupName = () => `compensian-pm-backup-${todayIso()}.json`;
const backupText = () => JSON.stringify(useStore.getState().ws, null, 2);

function downloadBackup() {
  const url = URL.createObjectURL(new Blob([backupText()], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = backupName();
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Embedded pages can't download files, so offer the backup as text to copy into a .json file. */
function BackupModal({ onClose }: { onClose: () => void }) {
  const text = backupText();
  const [copied, setCopied] = useState(false);
  const copy = async (e: React.MouseEvent<HTMLButtonElement>) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); }
    catch { (e.currentTarget.closest('.modal')?.querySelector('textarea') as HTMLTextAreaElement | null)?.select(); }
  };
  return (
    <Modal title="Export backup" onClose={onClose} width={520}>
      <p className="modal-text">
        This page can't download files. Copy the backup and save it as <code>{backupName()}</code> (e.g. in OneDrive).
        To restore it later, use <b>Import clients…</b> and pick that file.
      </p>
      <textarea className="backup-text" readOnly value={text} aria-label="Backup data" onFocus={(e) => e.currentTarget.select()} />
      <div className="modal-actions">
        <button className="btn" onClick={onClose}>Close</button>
        <button className="btn btn-primary" autoFocus onClick={(e) => void copy(e)}>{copied ? 'Copied' : 'Copy backup'}</button>
      </div>
    </Modal>
  );
}

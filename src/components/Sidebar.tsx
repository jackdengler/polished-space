import { useState } from 'react';
import { navigate, type Route } from '../router';
import { useStore } from '../store/store';
import { closeWorkspace, usePersistence } from '../storage/persistence';
import { openTeamSettings } from '../ui';
import { ClientLogo } from './Avatar';
import { Icon } from './Icon';
import { AddInput } from './InlineEdit';
import { ImportClients } from './ImportClients';
import { SaveStatus } from './SaveStatus';
import type { Client } from '../model/schema';

export function Sidebar({ route }: { route: Route }) {
  const clients = useStore((s) => s.ws.clients);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const adapter = usePersistence((s) => s.adapter);
  const [adding, setAdding] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const byName = (a: Client, b: Client) => a.name.localeCompare(b.name);
  const active = clients.filter((c) => !c.archived).sort(byName);
  const archived = clients.filter((c) => c.archived).sort(byName);

  const item = (c: Client) => (
    <a key={c.id} href={`#/c/${c.id}`} className={`client-item${route.clientId === c.id ? ' active' : ''}`}
      onClick={(e) => { e.preventDefault(); navigate({ clientId: c.id }); }}>
      <ClientLogo client={c} size={24} />
      <span className="client-item-name">{c.name}</span>
    </a>
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="brand">
          <span className="brand-mark"><Icon name="check" size={14} /></span>
          <span className="brand-name" title={adapter?.name}>{adapter?.name}</span>
        </div>
      </div>

      <nav className="client-list" aria-label="Clients">
        <div className="section-label">
          <span>Clients</span>
          <button className="icon-btn" aria-label="New client" title="New client" onClick={() => setAdding(true)}><Icon name="plus" size={15} /></button>
        </div>
        {adding && (
          <AddInput className="sidebar-add" placeholder="Client name, then Enter"
            onAdd={(name) => { const id = useStore.getState().addClient(name); setAdding(false); navigate({ clientId: id }); }}
            onDone={() => setAdding(false)} />
        )}
        {active.map(item)}
        {active.length === 0 && !adding && (
          <div className="sidebar-empty"><button className="link" onClick={() => setAdding(true)}>Add your first client</button></div>
        )}
        {archived.length > 0 && (
          <>
            <button className="section-label archived-toggle" onClick={() => setShowArchived((s) => !s)} aria-expanded={showArchived}>
              <span><Icon name={showArchived ? 'chevronDown' : 'chevronRight'} size={12} /> Archived ({archived.length})</span>
            </button>
            {showArchived && <div className="archived">{archived.map(item)}</div>}
          </>
        )}
      </nav>

      <div className="sidebar-bottom">
        <button className="side-btn" onClick={openTeamSettings}><Icon name="users" size={15} /> Team</button>
        <ImportClients />
        <div className="side-row">
          <button className="icon-btn" disabled={!canUndo} onClick={() => useStore.getState().undo()} aria-label="Undo" title="Undo (Ctrl+Z)"><Icon name="undo" size={15} /></button>
          <button className="icon-btn" disabled={!canRedo} onClick={() => useStore.getState().redo()} aria-label="Redo" title="Redo (Ctrl+Shift+Z)"><Icon name="redo" size={15} /></button>
          <SaveStatus />
        </div>
        <button className="side-btn muted" onClick={() => void closeWorkspace()}><Icon name="folder" size={15} /> {adapter?.kind === 'memory' ? 'Back to start' : 'Switch folder'}</button>
      </div>
    </aside>
  );
}

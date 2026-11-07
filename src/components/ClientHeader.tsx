import { useRef, useState } from 'react';
import type { Client } from '../model/schema';
import { navigate } from '../router';
import { useStore } from '../store/store';
import { usePersistence } from '../storage/persistence';
import { Avatar, ClientLogo, imageToPng } from './Avatar';
import { FlexDateInput } from './FlexDateInput';
import { Icon } from './Icon';
import { InlineEdit } from './InlineEdit';
import { TeamToggleList } from './MemberPicker';
import { confirmDialog } from './Modal';
import { Menu, Popover } from './Popover';

export function ClientHeader({ client }: { client: Client }) {
  const members = useStore((s) => s.ws.teamMembers);
  const { renameClient, setPlannedThrough, setArchived, deleteClient, setClientLogo } = useStore.getState();
  const fileRef = useRef<HTMLInputElement>(null);
  const teamRef = useRef<HTMLButtonElement>(null);
  const [teamOpen, setTeamOpen] = useState(false);
  const team = client.teamMemberIds.map((id) => members.find((m) => m.id === id)).filter((m) => m !== undefined);

  async function onLogo(file: File | undefined) {
    const adapter = usePersistence.getState().adapter;
    if (!file || !adapter) return;
    try {
      const png = await imageToPng(file);
      const name = await adapter.writeLogo(client.id, png);
      // The old file is kept so Undo can bring the previous logo back.
      setClientLogo(client.id, name);
    } catch {
      console.error('That image could not be read. Try a PNG, JPG or SVG.');
    }
  }

  async function onDelete() {
    const ok = await confirmDialog({
      title: `Delete ${client.name}?`,
      message: 'This deletes the client and all of its meetings, deliverables and tasks. You can undo right after, but consider archiving instead.',
      confirmLabel: 'Delete client', danger: true,
    });
    if (ok) { deleteClient(client.id); navigate({}); }
  }

  return (
    <header className="client-header">
      <button className="logo-btn" onClick={() => fileRef.current?.click()} title="Change logo" aria-label="Change logo">
        <ClientLogo client={client} size={44} />
        <span className="logo-overlay"><Icon name="image" size={18} /></span>
      </button>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { void onLogo(e.target.files?.[0]); e.target.value = ''; }} />

      <div className="client-main">
        <h1 className="client-name"><InlineEdit value={client.name} label="client name" onCommit={(n) => renameClient(client.id, n)} /></h1>
        <div className="client-meta">
          <div className="meta-item">
            <span className="meta-label">Team</span>
            <div className="team-chips">
              {team.map((m) => <Avatar key={m.id} member={m} size={26} />)}
              <button ref={teamRef} className="chip-add" onClick={() => setTeamOpen(true)} aria-label="Edit client team" title="Edit team">
                <Icon name={team.length ? 'plus' : 'users'} size={13} />{team.length === 0 && <span>Add team</span>}
              </button>
              <Popover anchor={teamRef} open={teamOpen} onClose={() => setTeamOpen(false)} width={260}>
                <TeamToggleList client={client} />
              </Popover>
            </div>
          </div>
          <div className="meta-item">
            <span className="meta-label">Planned through</span>
            <FlexDateInput value={client.plannedThrough} allowClear label="planned through" placeholder="Set a date"
              onChange={(d) => setPlannedThrough(client.id, d)} />
          </div>
        </div>
      </div>

      <Menu button={<Icon name="more" size={18} />} label="Client actions" items={[
        { label: 'Change logo', onSelect: () => fileRef.current?.click() },
        { label: 'Remove logo', hidden: !client.logo, onSelect: () => setClientLogo(client.id, null) },
        { label: client.archived ? 'Unarchive client' : 'Archive client', onSelect: () => setArchived(client.id, !client.archived) },
        { label: 'Delete client…', danger: true, onSelect: () => void onDelete() },
      ]} />
    </header>
  );
}

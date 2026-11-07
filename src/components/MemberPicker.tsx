import { useMemo, useState } from 'react';
import type { Client, TeamMember } from '../model/schema';
import { useStore } from '../store/store';
import { openTeamSettings } from '../ui';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

/** Pick who's on a task: the client's team first, with search across the whole company. Stays open while you tick. */
export function MemberPicker({ client, selected, onToggle, onClear }: {
  client: Client; selected: string[]; onToggle: (id: string) => void; onClear: () => void;
}) {
  const members = useStore((s) => s.ws.teamMembers);
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();

  const { team, others } = useMemo(() => {
    const match = (m: TeamMember) => !query || m.name.toLowerCase().includes(query);
    const byName = (a: TeamMember, b: TeamMember) => a.name.localeCompare(b.name);
    const onTask = (m: TeamMember) => selected.includes(m.id);
    return {
      team: members.filter((m) => (client.teamMemberIds.includes(m.id) || onTask(m)) && match(m)).sort(byName),
      // Everyone else only shows up when searching, to keep the list short.
      others: query ? members.filter((m) => !client.teamMemberIds.includes(m.id) && !onTask(m) && match(m)).sort(byName) : [],
    };
  }, [members, client.teamMemberIds, query, selected]);

  const first = team[0] ?? others[0];
  const row = (m: TeamMember) => {
    const on = selected.includes(m.id);
    return (
      <button key={m.id} className={`picker-row${on ? ' selected' : ''}`} role="menuitemcheckbox" aria-checked={on} onClick={() => onToggle(m.id)}>
        <span className={`check-box small${on ? ' on' : ''}`}>{on && <Icon name="check" size={11} />}</span>
        <Avatar member={m} size={20} /> <span className="grow">{m.name}</span>
      </button>
    );
  };

  return (
    <div className="picker">
      <div className="picker-search">
        <Icon name="search" size={14} />
        <input autoFocus value={q} placeholder="Search everyone…" aria-label="Search team members"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && first) { onToggle(first.id); setQ(''); } }} />
      </div>
      <div className="picker-list">
        {team.length > 0 && <div className="picker-heading">On this client</div>}
        {team.map(row)}
        {others.length > 0 && <div className="picker-heading">Everyone else</div>}
        {others.map(row)}
        {!team.length && !others.length && (
          <div className="picker-empty">
            {members.length === 0 ? 'No team members yet.' : query ? 'No one matches.' : 'No one on this client yet. Type to search everyone.'}
          </div>
        )}
      </div>
      {selected.length > 0 && <button className="picker-footer" onClick={onClear}>Clear ({selected.length})</button>}
      {members.length === 0 && <button className="picker-footer" onClick={openTeamSettings}>Add team members…</button>}
    </div>
  );
}

/** Multi-select of the client's team from the company list. */
export function TeamToggleList({ client }: { client: Client }) {
  const members = useStore((s) => s.ws.teamMembers);
  const toggle = useStore((s) => s.toggleClientMember);
  const [q, setQ] = useState('');
  const shown = members.filter((m) => m.name.toLowerCase().includes(q.trim().toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="picker">
      <div className="picker-search">
        <Icon name="search" size={14} />
        <input autoFocus value={q} placeholder="Search team…" aria-label="Search team members" onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="picker-list">
        {shown.map((m) => {
          const on = client.teamMemberIds.includes(m.id);
          return (
            <button key={m.id} className={`picker-row${on ? ' selected' : ''}`} onClick={() => toggle(client.id, m.id)} aria-pressed={on}>
              <Avatar member={m} size={20} /> <span className="grow">{m.name}</span>
              <span className={`check-box small${on ? ' on' : ''}`}>{on && <Icon name="check" size={11} />}</span>
            </button>
          );
        })}
        {shown.length === 0 && <div className="picker-empty">{members.length ? 'No one matches.' : 'No team members yet.'}</div>}
      </div>
      <button className="picker-footer" onClick={openTeamSettings}>Manage team…</button>
    </div>
  );
}

/** A searchable list of people; `suggest` floats likely matches to the top. */
export function PeopleList({ members, onPick, placeholder = 'Search team…', suggest }: {
  members: TeamMember[]; onPick: (m: TeamMember) => void; placeholder?: string; suggest?: (m: TeamMember) => boolean;
}) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const shown = members
    .filter((m) => m.name.toLowerCase().includes(query))
    .sort((a, b) => Number(suggest?.(b) ?? 0) - Number(suggest?.(a) ?? 0) || a.name.localeCompare(b.name));
  return (
    <div className="picker">
      <div className="picker-search">
        <Icon name="search" size={14} />
        <input autoFocus value={q} placeholder={placeholder} aria-label={placeholder} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) onPick(shown[0]); }} />
      </div>
      <div className="picker-list">
        {shown.map((m) => (
          <button key={m.id} className="picker-row" onClick={() => onPick(m)}>
            <Avatar member={m} size={20} /> <span className="grow">{m.name}</span>
          </button>
        ))}
        {shown.length === 0 && <div className="picker-empty">{members.length ? 'No one matches.' : 'No team members yet.'}</div>}
      </div>
    </div>
  );
}

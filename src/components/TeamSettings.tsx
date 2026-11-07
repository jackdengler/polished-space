import { useMemo, useRef, useState } from 'react';
import { byRoleThenName, MEMBER_COLORS } from '../model/derive';
import { ROLES, type Role } from '../model/schema';
import type { TeamMember } from '../model/schema';
import { useStore } from '../store/store';
import { useUi } from '../ui';
import { Avatar } from './Avatar';
import { PeopleList } from './MemberPicker';
import { Icon } from './Icon';
import { AddInput, InlineEdit } from './InlineEdit';
import { confirmDialog, Modal } from './Modal';
import { Popover } from './Popover';

function ColorPicker({ member }: { member: TeamMember }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const update = useStore((s) => s.updateMember);
  return (
    <>
      <button ref={ref} className="avatar-btn" onClick={() => setOpen(true)} aria-label={`Change color for ${member.name}`}>
        <Avatar member={member} size={26} />
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={176}>
        <div className="swatches">
          {MEMBER_COLORS.map((c) => (
            <button key={c} className={`swatch${c === member.color ? ' on' : ''}`} style={{ background: c }} aria-label={c}
              onClick={() => { update(member.id, { color: c }); setOpen(false); }} />
          ))}
        </div>
      </Popover>
    </>
  );
}

/** Pick another person to merge this one into. */
function MergeButton({ member, others }: { member: TeamMember; others: TeamMember[] }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Suggest likely matches first: same first word (e.g. "Sam" → "Samantha Reyes").
  const first = member.name.split(/[\s.(]/)[0]!.toLowerCase();
  const likely = (m: TeamMember) => first.length >= 2 && m.name.toLowerCase().startsWith(first);
  const merge = async (into: TeamMember) => {
    setOpen(false);
    if (await confirmDialog({
      title: `Merge “${member.name}” into “${into.name}”?`,
      message: `${member.name}'s tasks and client teams move to ${into.name}, and “${member.name}” is removed. You can undo this.`,
      confirmLabel: 'Merge',
    })) useStore.getState().mergeMember(member.id, into.id);
  };
  return (
    <>
      <button ref={ref} className="btn btn-sm btn-ghost" onClick={() => setOpen(true)}>Merge into…</button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={240} align="end">
        <PeopleList members={others} onPick={(m) => void merge(m)} placeholder="Same person as…" suggest={likely} />
      </Popover>
    </>
  );
}

export function TeamSettings() {
  const open = useUi((s) => s.teamOpen);
  const ws = useStore((s) => s.ws);
  const { addMember, updateMember, deleteMember } = useStore.getState();
  const [adding, setAdding] = useState(false);

  const counts = useMemo(() => {
    const n = new Map<string, number>();
    for (const c of ws.clients) for (const b of [c.adhoc, ...c.meetings]) for (const d of b.deliverables) for (const t of d.tasks)
      if (t.assigneeId && !t.done) n.set(t.assigneeId, (n.get(t.assigneeId) ?? 0) + 1);
    return n;
  }, [ws]);

  if (!open) return null;
  const close = () => useUi.setState({ teamOpen: false });
  const members = [...ws.teamMembers].sort(byRoleThenName);

  return (
    <Modal title="People" onClose={close} width={560}>
      <p className="modal-text">Everyone who can be put on clients and assigned tasks. A person's role decides where they appear in staffing.</p>
      <div className="team-list">
        {members.map((m, i) => (<div key={m.id}>
          {(i === 0 || members[i - 1]!.role !== m.role) && <div className="team-group">{m.role}</div>}
          <div className="team-row">
            <ColorPicker member={m} />
            <InlineEdit className="grow" value={m.name} label="name" onCommit={(name) => updateMember(m.id, { name })} />
            <select className="role-select" value={m.role} aria-label={`Role for ${m.name}`} onChange={(e) => updateMember(m.id, { role: e.target.value as Role })}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <span className="muted small">{counts.get(m.id) ?? 0} open</span>
            {members.length > 1 && <MergeButton member={m} others={members.filter((x) => x.id !== m.id)} />}
            <button className="icon-btn" aria-label={`Remove ${m.name}`} title="Remove"
              onClick={async () => {
                if (await confirmDialog({ title: `Remove ${m.name}?`, message: 'They will be taken off all clients and their tasks will become unassigned.', confirmLabel: 'Remove', danger: true }))
                  deleteMember(m.id);
              }}>
              <Icon name="trash" size={15} />
            </button>
          </div>
        </div>))}
        {members.length === 0 && !adding && <div className="muted small pad">No one yet.</div>}
        {adding
          ? <AddInput placeholder="Full name, then Enter" onAdd={(n) => addMember(n)} onDone={() => setAdding(false)} />
          : <button className="btn btn-ghost add-row" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> Add person</button>}
      </div>
      <div className="modal-actions"><button className="btn btn-primary" onClick={close}>Done</button></div>
    </Modal>
  );
}

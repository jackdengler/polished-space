import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useDraggable } from '@dnd-kit/core';
import { dayNumber, formatDue, formatShort, isWeekend, todayIso } from '../model/dates';
import { isOverdue, meetingLabel, memberById } from '../model/derive';
import { formatFlexShort } from '../model/flexDate';
import type { WeekItem, WeekMeeting } from '../model/week';
import { setPrefs } from '../prefs';
import { navigate } from '../router';
import { useStore } from '../store/store';
import { Avatar, ClientLogo } from './Avatar';
import { Icon } from './Icon';
import { PeopleList } from './MemberPicker';
import { Popover } from './Popover';
import { AvatarStack, Checkbox, KeyStar } from './TaskCard';
import { useMe } from './WhoAmI';

/** Calendar pieces shared by This week and the month view. */

let lastDragEnd = 0;
/** Call when a drag ends, so the drop doesn't also count as a click on the chip. */
export const markDragEnd = () => { lastDragEnd = Date.now(); };

export function WhoPrompt() {
  const members = useStore((s) => s.ws.teamMembers);
  return (
    <div className="week-page">
      <div className="who-card">
        <h1 className="week-title">Which team member are you?</h1>
        <p className="muted">The week shows your work on top and your teammates' work at your clients below. Remembered on this device only.</p>
        <PeopleList members={members} onPick={(m) => setPrefs({ meId: m.id })} placeholder="Find yourself…" />
      </div>
    </div>
  );
}

export function ViewingAs() {
  const me = useMe();
  const members = useStore((s) => s.ws.teamMembers);
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (!me) return null;
  return (
    <>
      <button ref={ref} className="viewing-as" onClick={() => setOpen(true)} title="Change who you are on this device">
        <span className="muted">Viewing as</span> <Avatar member={me} size={20} /> {me.name} <Icon name="chevronDown" size={12} />
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={240} align="end">
        <PeopleList members={members} onPick={(m) => { setPrefs({ meId: m.id }); setOpen(false); }} placeholder="Switch to…" />
      </Popover>
    </>
  );
}

export function MeetingChip({ m }: { m: WeekMeeting }) {
  const today = todayIso();
  return (
    <button className="meet-chip" title={`${m.client.name} meeting · ${meetingLabel(m.meeting, today)}`}
      aria-label={`${m.client.name} meeting`} onClick={() => navigate({ clientId: m.client.id, boardId: m.meeting.id })}>
      <ClientLogo client={m.client} size={16} />
      <span className="chip-name">{m.client.name}</span>
    </button>
  );
}

export function Chip({ item, row, overdue, compact }: { item: WeekItem; row: 'mine' | 'others'; overdue?: boolean; compact?: boolean }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: item.id, data: { item } });
  const { role: _r, tabIndex: _t, ...a11y } = attributes;
  return (
    <HoverCard item={item}>
      <div ref={setNodeRef} {...listeners} {...a11y} className={`chip-wrap${isDragging ? ' ghost' : ''}`}>
        <ChipBody item={item} row={row} overdue={overdue} compact={compact} />
      </div>
    </HoverCard>
  );
}

export function ChipBody({ item, row, overdue, overlay, compact }: { item: WeekItem; row: 'mine' | 'others'; overdue?: boolean; overlay?: boolean; compact?: boolean }) {
  const me = useMe();
  const members = useStore((s) => s.ws.teamMembers);
  const done = item.kind === 'task' ? item.task.done : item.done;
  const key = item.kind === 'task' && !!me && item.task.keyFor.includes(me.id);
  const late = overdue || (item.kind === 'task' ? isOverdue(item.task) : !item.done && dayNumber(item.date) < dayNumber(todayIso()));
  const weekend = !done && !late && isWeekend(item.date);
  // Show the people on it, except me (in My work, that's who I share it with).
  const who = item.kind === 'task' ? item.task.assigneeIds.filter((id) => id !== me?.id).map((id) => memberById(members, id)).filter((m) => m !== undefined) : [];
  const s = useStore.getState();
  const open = () => {
    if (Date.now() - lastDragEnd < 250) return;
    if (item.kind === 'task') navigate({ clientId: item.client.id, boardId: item.boardId, taskId: item.task.id });
    else navigate({ clientId: item.client.id, boardId: item.meeting.id });
  };
  const subs = item.kind === 'task' ? item.task.subtasks : [];
  return (
    <div className={`chip${compact ? ' compact' : ''}${done ? ' done' : ''}${key ? ' key' : ''}${late ? ' late' : ''}${item.kind === 'kickoff' ? ' kickoff' : ''}${overlay ? ' overlay' : ''}`}
      onClick={open} role="link" aria-label={item.kind === 'task' ? `${item.task.title}, ${item.client.name}` : `Kickoff, ${meetingLabel(item.meeting)}, ${item.client.name}`}>
      <Checkbox small checked={done} label={done ? 'Mark not done' : 'Mark done'}
        onToggle={() => (item.kind === 'task' ? s.toggleTask(item.task.id) : s.toggleKickoffDone(item.client.id, item.meeting.id))} />
      <ClientLogo client={item.client} size={16} />
      <span className="chip-name">
        {item.kind === 'kickoff' && <Icon name="flag" size={11} className="kick-icon" />}
        {item.kind === 'task' ? item.task.title : `Kickoff · ${meetingLabel(item.meeting)}`}
      </span>
      <span className="chip-tags">
        {key && <Icon name="starFilled" size={11} className="key-icon" />}
        {subs.length > 0 && <span className="chip-sub">{subs.filter((x) => x.done).length}/{subs.length}</span>}
        {overdue && <span className="chip-tag late-tag">{formatShort(item.date)}</span>}
        {item.weekendTag && <span className="chip-tag weekend-tag" title="Due on a weekend">⚠ {item.weekendTag}</span>}
        {weekend && !item.weekendTag && <span className="chip-tag weekend-tag" title="Due on a weekend">⚠</span>}
        {who.length > 0 && <AvatarStack people={who} size={16} />}
        {row === 'others' && item.kind === 'task' && item.task.assigneeIds.length === 0 && <span className="chip-tag">Unassigned</span>}
      </span>
    </div>
  );
}

/** Details on hover: where the task lives, who, when, subtasks, and the key star. */
function HoverCard({ item, children }: { item: WeekItem; children: ReactNode }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const members = useStore((s) => s.ws.teamMembers);
  const show = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      const left = r.right + 280 < window.innerWidth ? r.right + 8 : Math.max(8, r.left - 288);
      setPos({ top: Math.min(r.top, window.innerHeight - 260), left });
    }, 380);
  };
  const hide = () => { clearTimeout(timer.current); timer.current = setTimeout(() => setPos(null), 140); };
  const today = todayIso();
  const who = item.kind === 'task' ? item.task.assigneeIds.map((id) => memberById(members, id)).filter((m) => m !== undefined) : [];
  return (
    <div ref={anchor} onMouseEnter={show} onMouseLeave={hide}
      onPointerDown={(e) => {
        // React bubbles portal events through here too: presses inside the card must not close it.
        if ((e.target as Element).closest('.hover-card')) return;
        clearTimeout(timer.current);
        setPos(null);
      }}>
      {children}
      {pos && createPortal(
        <div className="hover-card" style={pos} onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={hide} data-no-dnd>
          <div className="hc-client"><ClientLogo client={item.client} size={18} /> {item.client.name}</div>
          {item.kind === 'task' ? (
            <>
              <div className="hc-title">{item.task.title}</div>
              <div className="hc-meta">{item.boardLabel} · {item.deliverable.title}</div>
              <div className="hc-meta">
                {who.length ? <><AvatarStack people={who} size={16} /> {who.map((m) => m.name).join(', ')}</> : 'Unassigned'} · due {formatDue(item.date, today)}
                {isWeekend(item.date) ? <span className="weekend-text"> (weekend)</span> : null}
              </div>
              {item.task.subtasks.length > 0 && (
                <ul className="hc-subs">
                  {item.task.subtasks.map((s) => <li key={s.id} className={s.done ? 'done' : ''}><Icon name={s.done ? 'check' : 'x'} size={11} /> {s.title}</li>)}
                </ul>
              )}
              <div className="hc-actions"><KeyStar task={item.task} /> <span className="muted small">Key task</span></div>
            </>
          ) : (
            <>
              <div className="hc-title"><Icon name="flag" size={13} /> Kickoff</div>
              <div className="hc-meta">{meetingLabel(item.meeting, today)} · meeting {formatFlexShort(item.meeting.date, today)}</div>
              <div className="hc-meta">Starts {formatDue(item.date, today)}{item.done ? ' · done' : ''}</div>
            </>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}


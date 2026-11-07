import { useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DndContext, DragOverlay, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { addDays, dayNumber, formatDue, formatLong, formatShort, isWeekend, MONTH_SHORT, mondayOf, parseIso, todayIso, weekdayShort } from '../model/dates';
import { isOverdue, meetingLabel, memberById, sortedMeetings } from '../model/derive';
import { formatFlexShort } from '../model/flexDate';
import { ADHOC, type Client } from '../model/schema';
import { buildWeek, type WeekItem, type WeekMeeting } from '../model/week';
import { setPrefs, usePrefs } from '../prefs';
import { navigate } from '../router';
import { useStore } from '../store/store';
import { Avatar, ClientLogo } from './Avatar';
import { sensorOptions, SmartPointerSensor } from './dnd';
import { Icon } from './Icon';
import { PeopleList } from './MemberPicker';
import { Popover } from './Popover';
import { Checkbox, KeyStar } from './TaskCard';
import { useMe } from './WhoAmI';

/** Week label: "Nov 9 – 13", "Nov 30 – Dec 4", with the year when it isn't this year. */
function weekLabel(first: string, last: string, today: string) {
  const a = parseIso(first), b = parseIso(last), y = parseIso(today).year;
  const left = `${MONTH_SHORT[a.month - 1]} ${a.day}`;
  const right = a.month === b.month ? `${b.day}` : `${MONTH_SHORT[b.month - 1]} ${b.day}`;
  return `${left} – ${right}${b.year !== y ? `, ${b.year}` : ''}`;
}

let lastDragEnd = 0; // a drop shouldn't also count as a click on the chip

export function WeekPage({ week: weekParam }: { week: string | null }) {
  const me = useMe();
  const clients = useStore((s) => s.ws.clients);
  const { showWeekend, hideDone } = usePrefs();
  const today = todayIso();
  const monday = weekParam ? mondayOf(weekParam) : mondayOf(today);
  const sensors = useSensors(useSensor(SmartPointerSensor, sensorOptions));
  const [dragging, setDragging] = useState<WeekItem | null>(null);

  const week = useMemo(
    () => (me ? buildWeek(clients, { meId: me.id, monday, today, showWeekend, hideDone }) : null),
    [clients, me, monday, today, showWeekend, hideDone],
  );

  if (!me || !week) return <WhoPrompt />;

  const go = (m: string | null) => navigate({ weekPage: true, week: m && m !== mondayOf(today) ? m : null });
  const nextMonday = addDays(monday, 7);
  const openMine = [...Object.values(week.mine).flat(), ...week.overdueMine].filter((i) => !(i.kind === 'task' ? i.task.done : i.done)).length;
  const openOthers = [...Object.values(week.others).flat(), ...week.overdueOthers].filter((i) => i.kind === 'task' && !i.task.done).length;

  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    lastDragEnd = Date.now();
    const item = e.active.data.current?.item as WeekItem | undefined;
    const over = e.over ? String(e.over.id) : null;
    if (!item || !over) return;
    const date = over === 'next' ? nextMonday : over.startsWith('day:') ? over.split(':')[1]! : null;
    if (!date || date === item.date) return;
    const s = useStore.getState();
    if (item.kind === 'task') s.updateTask(item.task.id, { dueDate: date });
    else s.setKickoff(item.client.id, item.meeting.id, date);
  }

  const cols = `112px ${week.showOverdue ? 'minmax(170px, 0.9fr) ' : ''}repeat(${week.days.length}, minmax(150px, 1fr)) 76px`;
  const overdueCol = week.showOverdue ? 1 : 0;

  return (
    <div className="week-page">
      <header className="week-head">
        <h1 className="week-title">Week of {weekLabel(week.days[0]!, week.days[week.days.length - 1]!, today)}</h1>
        <div className="week-nav">
          <button className="icon-btn" aria-label="Previous week" onClick={() => go(addDays(monday, -7))}><Icon name="chevronRight" size={16} className="flip" /></button>
          <button className="btn btn-sm" onClick={() => go(null)} disabled={monday === mondayOf(today)}>Today</button>
          <button className="icon-btn" aria-label="Next week" onClick={() => go(nextMonday)}><Icon name="chevronRight" size={16} /></button>
        </div>
        <div className="week-tools">
          <ViewingAs />
          <label className="toggle"><input type="checkbox" checked={showWeekend} onChange={(e) => setPrefs({ showWeekend: e.target.checked })} /> Weekend</label>
          <label className="toggle"><input type="checkbox" checked={hideDone} onChange={(e) => setPrefs({ hideDone: e.target.checked })} /> Hide done</label>
        </div>
      </header>

      <DndContext sensors={sensors} onDragStart={(e: DragStartEvent) => setDragging((e.active.data.current?.item as WeekItem) ?? null)}
        onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div className="week-scroll">
          <div className="week-grid" style={{ gridTemplateColumns: cols }}>
            {/* Header row */}
            <div className="wg-corner" />
            {week.showOverdue && <div className="wg-dayhead overdue-head">Overdue</div>}
            {week.days.map((d) => (
              <div key={d} className={`wg-dayhead${d === today ? ' today' : ''}`}>
                <span className="wd">{weekdayShort(d)}</span> <span className="dn">{parseIso(d).day}</span>
              </div>
            ))}
            <div className="wg-dayhead next-head">Next</div>

            {/* Meetings band */}
            <div className="wg-label">Meetings</div>
            {week.showOverdue && <div className="wg-cell band empty-cell" />}
            {week.days.map((d) => (
              <div key={d} className={`wg-cell band${d === today ? ' today' : ''}`}>
                {week.meetings[d]!.map((m) => <MeetingChip key={m.meeting.id} m={m} />)}
              </div>
            ))}
            <div className="wg-cell band empty-cell" />

            {/* My work */}
            <div className="wg-label">My work<span className="count">{openMine} open</span></div>
            {week.showOverdue && <div className="wg-cell overdue-cell">{week.overdueMine.map((i) => <Chip key={i.id} item={i} row="mine" overdue />)}</div>}
            {week.days.map((d) => <DayCell key={d} day={d} row="mine" items={week.mine[d]!} today={today} />)}
            <NextWeekDrop label={`${MONTH_SHORT[parseIso(nextMonday).month - 1]} ${parseIso(nextMonday).day}`} col={2 + overdueCol + week.days.length} />

            {/* Others at my clients */}
            <div className="wg-label">Others<span className="count">at my clients · {openOthers} open</span></div>
            {week.showOverdue && <div className="wg-cell overdue-cell">{week.overdueOthers.map((i) => <Chip key={i.id} item={i} row="others" overdue />)}</div>}
            {week.days.map((d) => <DayCell key={d} day={d} row="others" items={week.others[d]!} today={today} />)}
          </div>
        </div>
        <DragOverlay dropAnimation={null}>{dragging && <ChipBody item={dragging} row="mine" overlay />}</DragOverlay>
      </DndContext>
      {!clients.some((c) => !c.archived && c.teamMemberIds.includes(me.id)) && (
        <p className="week-note">You're not on any client's team yet, so Meetings and Others are empty. Add yourself to a client's team from its page.</p>
      )}
    </div>
  );
}

function WhoPrompt() {
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

function ViewingAs() {
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

function DayCell({ day, row, items, today }: { day: string; row: 'mine' | 'others'; items: WeekItem[]; today: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day}:${row}` });
  const [adding, setAdding] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <div ref={setNodeRef} className={`wg-cell${day === today ? ' today' : ''}${isOver ? ' over' : ''}`}>
      {items.map((i) => <Chip key={i.id} item={i} row={row} />)}
      <button ref={ref} className="cell-add" onClick={() => setAdding(true)} aria-label={`Add task on ${formatLong(day)}${row === 'mine' ? ' for me' : ''}`}>
        <Icon name="plus" size={13} />
      </button>
      <Popover anchor={ref} open={adding} onClose={() => setAdding(false)} width={300}>
        <AddTaskForm day={day} row={row} onDone={() => setAdding(false)} />
      </Popover>
    </div>
  );
}

function NextWeekDrop({ label, col }: { label: string; col: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'next' });
  return (
    <div ref={setNodeRef} className={`wg-next${isOver ? ' over' : ''}`} style={{ gridColumn: col, gridRow: '3 / span 2' }}
      title="Drop a task here to move it to Monday of next week">
      <span>Next week</span><Icon name="chevronRight" size={14} /><span className="muted small">{label}</span>
    </div>
  );
}

function MeetingChip({ m }: { m: WeekMeeting }) {
  const today = todayIso();
  return (
    <button className="meet-chip" title={`${m.client.name} · ${meetingLabel(m.meeting, today)}`}
      onClick={() => navigate({ clientId: m.client.id, boardId: m.meeting.id })}>
      <ClientLogo client={m.client} size={16} />
      <span className="chip-name">{meetingLabel(m.meeting, today)}</span>
    </button>
  );
}

function Chip({ item, row, overdue }: { item: WeekItem; row: 'mine' | 'others'; overdue?: boolean }) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({ id: item.id, data: { item } });
  const { role: _r, tabIndex: _t, ...a11y } = attributes;
  return (
    <HoverCard item={item}>
      <div ref={setNodeRef} {...listeners} {...a11y} className={`chip-wrap${isDragging ? ' ghost' : ''}`}>
        <ChipBody item={item} row={row} overdue={overdue} />
      </div>
    </HoverCard>
  );
}

function ChipBody({ item, row, overdue, overlay }: { item: WeekItem; row: 'mine' | 'others'; overdue?: boolean; overlay?: boolean }) {
  const me = useMe();
  const members = useStore((s) => s.ws.teamMembers);
  const done = item.kind === 'task' ? item.task.done : item.done;
  const key = item.kind === 'task' && !!me && item.task.keyFor.includes(me.id);
  const late = overdue || (item.kind === 'task' ? isOverdue(item.task) : !item.done && dayNumber(item.date) < dayNumber(todayIso()));
  const weekend = !done && !late && isWeekend(item.date);
  const who = item.kind === 'task' && row === 'others' ? memberById(members, item.task.assigneeId) : undefined;
  const s = useStore.getState();
  const open = () => {
    if (Date.now() - lastDragEnd < 250) return;
    if (item.kind === 'task') navigate({ clientId: item.client.id, boardId: item.boardId, taskId: item.task.id });
    else navigate({ clientId: item.client.id, boardId: item.meeting.id });
  };
  const subs = item.kind === 'task' ? item.task.subtasks : [];
  return (
    <div className={`chip${done ? ' done' : ''}${key ? ' key' : ''}${late ? ' late' : ''}${item.kind === 'kickoff' ? ' kickoff' : ''}${overlay ? ' overlay' : ''}`}
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
        {who && <Avatar member={who} size={16} />}
        {row === 'others' && item.kind === 'task' && !item.task.assigneeId && <span className="chip-tag">Unassigned</span>}
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
  const who = item.kind === 'task' ? memberById(members, item.task.assigneeId) : undefined;
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
                {who ? <><Avatar member={who} size={16} /> {who.name}</> : 'Unassigned'} · due {formatDue(item.date, today)}
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

function AddTaskForm({ day, row, onDone }: { day: string; row: 'mine' | 'others'; onDone: () => void }) {
  const me = useMe()!;
  const all = useStore((s) => s.ws.clients);
  const today = todayIso();
  const byName = (a: Client, b: Client) => a.name.localeCompare(b.name);
  const active = all.filter((c) => !c.archived);
  const mine = active.filter((c) => c.teamMemberIds.includes(me.id)).sort(byName);
  const rest = row === 'mine' ? active.filter((c) => !c.teamMemberIds.includes(me.id)).sort(byName) : [];
  const [clientId, setClientId] = useState(mine[0]?.id ?? rest[0]?.id ?? '');
  const client = active.find((c) => c.id === clientId);
  const [boardId, setBoardId] = useState(ADHOC);
  const board = client ? (boardId === ADHOC ? client.adhoc : client.meetings.find((m) => m.id === boardId)) : undefined;
  const [deliverableId, setDeliverableId] = useState('');
  const delivs = board?.deliverables ?? [];
  const chosenDeliv = delivs.find((d) => d.id === deliverableId) ?? delivs[0];
  const [newDeliv, setNewDeliv] = useState('General');
  const [title, setTitle] = useState('');

  const submit = () => {
    if (!client || !title.trim()) return;
    const s = useStore.getState();
    const did = chosenDeliv?.id ?? s.addDeliverable(client.id, boardId, newDeliv.trim() || 'General');
    s.addTask(did, title, { dueDate: day, assigneeId: row === 'mine' ? me.id : null });
    onDone();
  };

  if (!client) return <div className="form"><p className="muted">{row === 'others' ? "You're not on any client's team yet." : 'No clients yet.'}</p></div>;
  return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="form-title">New task · {formatDue(day, today)}{row === 'mine' ? ' · for me' : ' · unassigned'}</div>
      <label className="field-label" htmlFor="wk-client">Client</label>
      <select id="wk-client" className="text-input" value={clientId} onChange={(e) => { setClientId(e.target.value); setBoardId(ADHOC); setDeliverableId(''); }}>
        {mine.length > 0 && <optgroup label="My clients">{mine.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>}
        {rest.length > 0 && <optgroup label="Other clients">{rest.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>}
      </select>
      <label className="field-label" htmlFor="wk-board">Meeting</label>
      <select id="wk-board" className="text-input" value={boardId} onChange={(e) => { setBoardId(e.target.value); setDeliverableId(''); }}>
        <option value={ADHOC}>Ad-hoc</option>
        {sortedMeetings(client).map((m) => <option key={m.id} value={m.id}>{formatFlexShort(m.date, today)} · {meetingLabel(m, today)}</option>)}
      </select>
      <label className="field-label" htmlFor="wk-deliv">Deliverable</label>
      {delivs.length > 0 ? (
        <select id="wk-deliv" className="text-input" value={chosenDeliv?.id} onChange={(e) => setDeliverableId(e.target.value)}>
          {delivs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
        </select>
      ) : (
        <input id="wk-deliv" className="text-input" value={newDeliv} onChange={(e) => setNewDeliv(e.target.value)} placeholder="New deliverable name" />
      )}
      <label className="field-label" htmlFor="wk-title">Task</label>
      <input id="wk-title" className="text-input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" />
      <div className="form-actions">
        <button type="button" className="btn" onClick={onDone}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={!title.trim()}>Add task</button>
      </div>
    </form>
  );
}

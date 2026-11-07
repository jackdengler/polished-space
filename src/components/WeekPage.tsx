import { useMemo, useRef, useState } from 'react';
import { DndContext, DragOverlay, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { addDays, formatDue, formatLong, MONTH_SHORT, mondayOf, parseIso, todayIso, weekdayShort } from '../model/dates';
import { meetingLabel, sortedMeetings } from '../model/derive';
import { formatFlexShort } from '../model/flexDate';
import { ADHOC, type Client } from '../model/schema';
import { buildWeek, type WeekItem } from '../model/week';
import { setPrefs, usePrefs } from '../prefs';
import { navigate } from '../router';
import { useStore } from '../store/store';
import { Chip, ChipBody, markDragEnd, MeetingChip, ViewingAs, WhoPrompt } from './CalendarChips';
import { sensorOptions, SmartPointerSensor } from './dnd';
import { Icon } from './Icon';
import { Popover } from './Popover';
import { useMe } from './WhoAmI';

/** Week label: "Nov 9 – 13", "Nov 30 – Dec 4", with the year when it isn't this year. */
function weekLabel(first: string, last: string, today: string) {
  const a = parseIso(first), b = parseIso(last), y = parseIso(today).year;
  const left = `${MONTH_SHORT[a.month - 1]} ${a.day}`;
  const right = a.month === b.month ? `${b.day}` : `${MONTH_SHORT[b.month - 1]} ${b.day}`;
  return `${left} – ${right}${b.year !== y ? `, ${b.year}` : ''}`;
}

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
    markDragEnd();
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
            {week.showOverdue && <div className="wg-dayhead overdue-head">Overdue <span className="dn">{week.overdueMine.length + week.overdueOthers.length}</span></div>}
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
    s.addTask(did, title, { dueDate: day, assigneeIds: row === 'mine' ? [me.id] : [] });
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

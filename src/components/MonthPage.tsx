import { useMemo, useState } from 'react';
import { DndContext, DragOverlay, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { MONTH_SHORT, todayIso } from '../model/dates';
import { buildMonth, dayOfMonth, inMonth, monthOf, shiftMonth } from '../model/month';
import type { WeekItem, WeekMeeting } from '../model/week';
import { setPrefs, usePrefs } from '../prefs';
import { navigate } from '../router';
import { useStore } from '../store/store';
import { Chip, ChipBody, markDragEnd, MeetingChip, ViewingAs, WhoPrompt } from './CalendarChips';
import { sensorOptions, SmartPointerSensor } from './dnd';
import { Icon } from './Icon';
import { useMe } from './WhoAmI';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHOWN = 4; // chips per day before "+n more"

/** Month calendar: weekdays only; drag tasks (and kickoffs) between days. */
export function MonthPage({ month: param }: { month: string | null }) {
  const me = useMe();
  const clients = useStore((s) => s.ws.clients);
  const hideDone = usePrefs((s) => s.hideDone);
  const onlyMine = usePrefs((s) => s.monthOnlyMine);
  const today = todayIso();
  const thisMonth = monthOf(today);
  const month = param ?? thisMonth;
  const sensors = useSensors(useSensor(SmartPointerSensor, sensorOptions));
  const [dragging, setDragging] = useState<WeekItem | null>(null);

  const data = useMemo(
    () => (me ? buildMonth(clients, { meId: me.id, month, today, hideDone, onlyMine }) : null),
    [clients, me, month, today, hideDone, onlyMine],
  );
  if (!me || !data) return <WhoPrompt />;

  const [y, m] = month.split('-').map(Number) as [number, number];
  const go = (mm: string) => navigate({ monthPage: true, month: mm === thisMonth ? null : mm });

  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    markDragEnd();
    const item = e.active.data.current?.item as WeekItem | undefined;
    const over = e.over ? String(e.over.id) : null;
    if (!item || !over?.startsWith('mday:')) return;
    const date = over.slice(5);
    if (date === item.date) return;
    const s = useStore.getState();
    if (item.kind === 'task') s.updateTask(item.task.id, { dueDate: date });
    else s.setKickoff(item.client.id, item.meeting.id, date);
  }

  return (
    <div className="week-page month-page">
      <header className="week-head">
        <h1 className="week-title">{MONTH_NAMES[m - 1]} {y}</h1>
        <div className="week-nav">
          <button className="icon-btn" aria-label="Previous month" onClick={() => go(shiftMonth(month, -1))}><Icon name="chevronRight" size={16} className="flip" /></button>
          <button className="btn btn-sm" onClick={() => go(thisMonth)} disabled={month === thisMonth}>Today</button>
          <button className="icon-btn" aria-label="Next month" onClick={() => go(shiftMonth(month, 1))}><Icon name="chevronRight" size={16} /></button>
        </div>
        <div className="week-tools">
          <ViewingAs />
          <label className="toggle"><input type="checkbox" checked={onlyMine} onChange={(e) => setPrefs({ monthOnlyMine: e.target.checked })} /> Only my tasks</label>
          <label className="toggle"><input type="checkbox" checked={hideDone} onChange={(e) => setPrefs({ hideDone: e.target.checked })} /> Hide done</label>
        </div>
      </header>

      <DndContext sensors={sensors} onDragStart={(e: DragStartEvent) => setDragging((e.active.data.current?.item as WeekItem) ?? null)}
        onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div className="week-scroll">
          <div className="month-grid">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => <div key={d} className="mg-head">{d}</div>)}
            {data.weeks.flat().map((day) => (
              <MonthDay key={day} day={day} month={month} today={today} items={data.items[day]!} meetings={data.meetings[day]!} />
            ))}
          </div>
        </div>
        <DragOverlay dropAnimation={null}>{dragging && <ChipBody item={dragging} row="mine" overlay compact />}</DragOverlay>
      </DndContext>
    </div>
  );
}

function MonthDay({ day, month, today, items, meetings }: { day: string; month: string; today: string; items: WeekItem[]; meetings: WeekMeeting[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: `mday:${day}` });
  const me = useMe();
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? items : items.slice(0, SHOWN);
  const d = dayOfMonth(day);
  const outside = !inMonth(day, month);
  return (
    <div ref={setNodeRef} className={`mg-cell${outside ? ' outside' : ''}${day === today ? ' today' : ''}${isOver ? ' over' : ''}`}>
      <div className="mg-date">{d === 1 || (outside && d <= 7) ? `${MONTH_SHORT[Number(day.slice(5, 7)) - 1]} ${d}` : d}</div>
      {meetings.length > 0 && <div className="mg-meetings">{meetings.map((mt) => <MeetingChip key={mt.meeting.id} m={mt} />)}</div>}
      {shown.map((i) => <Chip key={i.id} item={i} row={i.kind === 'task' && me && !i.task.assigneeIds.includes(me.id) ? 'others' : 'mine'} compact />)}
      {items.length > SHOWN && (
        <button className="mg-more" onClick={() => setExpanded((e) => !e)}>{expanded ? 'Show less' : `+${items.length - SHOWN} more`}</button>
      )}
    </div>
  );
}

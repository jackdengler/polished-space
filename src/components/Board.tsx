import { useState } from 'react';
import { closestCenter, DndContext, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { rectSortingStrategy, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { boardProgress, deliverableProgress, meetingLabel } from '../model/derive';
import { ADHOC, type Client, type Deliverable } from '../model/schema';
import { navigate } from '../router';
import { useStore } from '../store/store';
import { sensorOptions, SmartPointerSensor, verticalOnly } from './dnd';
import { FlexDateInput } from './FlexDateInput';
import { Icon } from './Icon';
import { AddInput, InlineEdit } from './InlineEdit';
import { confirmDialog } from './Modal';
import { Menu } from './Popover';
import { Checkbox, TaskCard } from './TaskCard';
import { DatePickButton } from './DatePickButton';
import { formatDue, formatLong, todayIso } from '../model/dates';

const reorder = (ids: string[], e: DragEndEvent): [number, number] | null => {
  if (!e.over || e.active.id === e.over.id) return null;
  const from = ids.indexOf(String(e.active.id)), to = ids.indexOf(String(e.over.id));
  return from < 0 || to < 0 ? null : [from, to];
};

function Column({ d, client, highlightTaskId }: { d: Deliverable; client: Client; highlightTaskId: string | null }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: d.id });
  const sensors = useSensors(useSensor(SmartPointerSensor, sensorOptions));
  const [adding, setAdding] = useState(false);
  const { addTask, moveTask, renameDeliverable, deleteDeliverable } = useStore.getState();
  const p = deliverableProgress(d);
  const ids = d.tasks.map((t) => t.id);

  const onDelete = async () => {
    if (d.tasks.length === 0 || await confirmDialog({
      title: `Delete "${d.title}"?`, message: `Its ${d.tasks.length} task${d.tasks.length === 1 ? '' : 's'} will be deleted too.`, confirmLabel: 'Delete', danger: true,
    })) deleteDeliverable(d.id);
  };

  return (
    <div ref={setNodeRef} className={`column${isDragging ? ' dragging' : ''}`} style={{ transform: CSS.Translate.toString(transform), transition }}>
      <div className="column-head">
        <button ref={setActivatorNodeRef} {...attributes} {...listeners} className="drag-handle" aria-label={`Reorder ${d.title}`} title="Drag to reorder">
          <Icon name="grip" size={14} />
        </button>
        <InlineEdit className="column-title" value={d.title} label="deliverable" onCommit={(v) => renameDeliverable(d.id, v)} />
        <span className={`column-count${p.total > 0 && p.done === p.total ? ' all-done' : ''}`}>{p.done}/{p.total}</span>
        <Menu className="icon-btn" button={<Icon name="more" size={15} />} label="Deliverable actions" items={[
          { label: 'Delete deliverable', danger: true, onSelect: () => void onDelete() },
        ]} />
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[verticalOnly]}
        onDragEnd={(e) => { const r = reorder(ids, e); if (r) moveTask(d.id, ...r); }}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <div className="column-body">
            {d.tasks.map((t) => <TaskCard key={t.id} task={t} client={client} highlight={t.id === highlightTaskId} />)}
          </div>
        </SortableContext>
      </DndContext>

      {adding
        ? <AddInput className="task-add" placeholder="Task name, then Enter" onAdd={(v) => addTask(d.id, v)} onDone={() => setAdding(false)} />
        : <button className="add-task-btn" onClick={() => setAdding(true)}><Icon name="plus" size={14} /> Add task</button>}
    </div>
  );
}

export function Board({ client, boardId, highlightTaskId }: { client: Client; boardId: string; highlightTaskId: string | null }) {
  const sensors = useSensors(useSensor(SmartPointerSensor, sensorOptions));
  const [adding, setAdding] = useState(false);
  const { addDeliverable, moveDeliverable, updateMeeting, deleteMeeting } = useStore.getState();

  const meeting = boardId === ADHOC ? null : client.meetings.find((m) => m.id === boardId) ?? null;
  const deliverables = meeting ? meeting.deliverables : client.adhoc.deliverables;
  const ids = deliverables.map((d) => d.id);
  const p = boardProgress(deliverables);

  const onDeleteMeeting = async () => {
    if (!meeting) return;
    if (await confirmDialog({
      title: 'Delete this meeting?', message: `Its ${deliverables.length} deliverable(s) and ${p.total} task(s) will be deleted too.`, confirmLabel: 'Delete meeting', danger: true,
    })) {
      deleteMeeting(client.id, meeting.id);
      navigate({ clientId: client.id }, { replace: true });
    }
  };

  return (
    <section className="board" aria-label={meeting ? 'Meeting' : 'Ad-hoc work'}>
      <div className="board-head">
        <div className="board-heading">
          {meeting ? (
            <>
              <h2 className="board-name"><InlineEdit value={meeting.title} placeholder={meetingLabel({ ...meeting, title: '' })} label="meeting title"
                onCommit={(title) => updateMeeting(client.id, meeting.id, { title })} /></h2>
              <div className="board-sub">
                <FlexDateInput className="sub-date" value={meeting.date} label="meeting date" onChange={(date) => date && updateMeeting(client.id, meeting.id, { date })} />
                <span>· {deliverables.length} deliverable{deliverables.length === 1 ? '' : 's'}</span>
                <span>·</span>
                <span className={`kickoff${meeting.kickoff?.done ? ' done' : ''}`}>
                  {meeting.kickoff && (
                    <Checkbox small checked={meeting.kickoff.done} label={meeting.kickoff.done ? 'Kickoff done. Undo' : 'Mark kickoff done'}
                      onToggle={() => useStore.getState().toggleKickoffDone(client.id, meeting.id)} />
                  )}
                  <DatePickButton id={`kickoff-${meeting.id}`} value={meeting.kickoff?.date ?? null} label="Kickoff date"
                    title={meeting.kickoff ? `Kickoff ${formatLong(meeting.kickoff.date)}: work on this meeting starts. Shows on the weekly calendar.` : 'When work on this meeting should start. Shows on the weekly calendar.'}
                    className={`kickoff-link${meeting.kickoff ? '' : ' empty'}`}
                    onChange={(d) => useStore.getState().setKickoff(client.id, meeting.id, d)}>
                    <Icon name="flag" size={12} />{meeting.kickoff ? `Kickoff ${formatDue(meeting.kickoff.date, todayIso())}` : 'Set kickoff'}
                  </DatePickButton>
                </span>
              </div>
            </>
          ) : (
            <>
              <h2 className="board-name">Ad-hoc</h2>
              <div className="board-sub">Work not tied to a meeting · {deliverables.length} deliverable{deliverables.length === 1 ? '' : 's'}</div>
            </>
          )}
        </div>
        <div className="board-progress">
          {p.total > 0 && <span className="bar wide"><span style={{ width: `${(100 * p.done) / p.total}%` }} /></span>}
          <span>{p.done} of {p.total} tasks done</span>
          {meeting && <Menu className="icon-btn" button={<Icon name="more" size={16} />} label="Meeting actions" items={[
            { label: 'Delete meeting…', danger: true, onSelect: () => void onDeleteMeeting() },
          ]} />}
        </div>
      </div>

      <div className="columns">
        <DndContext sensors={sensors} collisionDetection={closestCenter}
          onDragEnd={(e) => { const r = reorder(ids, e); if (r) moveDeliverable(client.id, boardId, ...r); }}>
          <SortableContext items={ids} strategy={rectSortingStrategy}>
            {deliverables.map((d) => <Column key={d.id} d={d} client={client} highlightTaskId={highlightTaskId} />)}
          </SortableContext>
        </DndContext>
        <div className="column ghost">
          {adding
            ? <AddInput className="deliverable-add" placeholder="Deliverable name, then Enter" onAdd={(v) => addDeliverable(client.id, boardId, v)} onDone={() => setAdding(false)} />
            : <button className="add-deliverable-btn" onClick={() => setAdding(true)}><Icon name="plus" size={15} /> Add deliverable</button>}
          {deliverables.length === 0 && !adding && <p className="muted small">Deliverables group {meeting ? "this meeting's" : 'ad-hoc'} tasks into columns.</p>}
        </div>
      </div>
    </section>
  );
}

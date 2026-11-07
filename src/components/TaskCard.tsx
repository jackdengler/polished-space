import { useEffect, useRef, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatLong, formatShort, todayIso } from '../model/dates';
import { isOverdue, memberById } from '../model/derive';
import type { Client, Task } from '../model/schema';
import { useStore } from '../store/store';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { AddInput, InlineEdit } from './InlineEdit';
import { MemberPicker } from './MemberPicker';
import { Menu, Popover } from './Popover';

export function Checkbox({ checked, onToggle, label, small }: { checked: boolean; onToggle: () => void; label: string; small?: boolean }) {
  return (
    <button className={`check-box${small ? ' small' : ''}${checked ? ' on' : ''}`} role="checkbox" aria-checked={checked} aria-label={label}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}>
      {checked && <Icon name="check" size={small ? 11 : 13} />}
    </button>
  );
}

function AssigneeButton({ task, client }: { task: Task; client: Client }) {
  const members = useStore((s) => s.ws.teamMembers);
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const who = memberById(members, task.assigneeId);
  return (
    <>
      <button ref={ref} className={`meta-btn${who ? '' : ' empty'}`} onClick={() => setOpen(true)}
        aria-label={who ? `Assigned to ${who.name}. Change` : 'Assign'} title={who ? who.name : 'Assign'}>
        {who ? <><Avatar member={who} size={18} /><span>{who.name.split(' ')[0]}</span></> : <><Icon name="users" size={13} /><span>Assign</span></>}
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={240}>
        <MemberPicker client={client} value={task.assigneeId}
          onPick={(id) => { useStore.getState().updateTask(task.id, { assigneeId: id }); setOpen(false); }} />
      </Popover>
    </>
  );
}

function DueButton({ task }: { task: Task }) {
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [fallback, setFallback] = useState(false);
  const today = todayIso();
  const overdue = isOverdue(task, today);
  const setDue = (v: string) => useStore.getState().updateTask(task.id, { dueDate: v || null });
  const open = () => {
    try { input.current!.showPicker(); } catch { setFallback(true); } // some embedded pages block the native picker
  };
  return (
    <span className="due-wrap">
      <button ref={button} className={`meta-btn${task.dueDate ? '' : ' empty'}${overdue ? ' overdue' : ''}`} onClick={open}
        aria-label={task.dueDate ? `Due ${formatLong(task.dueDate)}. Change` : 'Set due date'}
        title={task.dueDate ? `Due ${formatLong(task.dueDate)}${overdue ? ' (overdue)' : ''}` : 'Set due date'}>
        <Icon name="calendar" size={13} /><span>{task.dueDate ? formatShort(task.dueDate, today) : 'Due'}</span>
      </button>
      <input ref={input} type="date" className="hidden-date" tabIndex={-1} aria-hidden="true" value={task.dueDate ?? ''}
        onChange={(e) => setDue(e.target.value)} />
      <Popover anchor={button} open={fallback} onClose={() => setFallback(false)} width={220}>
        <div className="form">
          <label className="field-label" htmlFor={`due-${task.id}`}>Due date</label>
          <input id={`due-${task.id}`} type="date" className="text-input" autoFocus value={task.dueDate ?? ''} onChange={(e) => setDue(e.target.value)} />
          <div className="form-actions">
            {task.dueDate && <button className="btn btn-sm" onClick={() => { setDue(''); setFallback(false); }}>Clear</button>}
            <button className="btn btn-sm btn-primary" onClick={() => setFallback(false)}>Done</button>
          </div>
        </div>
      </Popover>
    </span>
  );
}

function Subtasks({ task, adding, setAdding }: { task: Task; adding: boolean; setAdding: (v: boolean) => void }) {
  const { addSubtask, toggleSubtask, renameSubtask, deleteSubtask } = useStore.getState();
  return (
    <div className="subtasks" data-no-dnd>
      {task.subtasks.map((s) => (
        <div key={s.id} className={`subtask${s.done ? ' done' : ''}`}>
          <Checkbox small checked={s.done} onToggle={() => toggleSubtask(s.id)} label={`Subtask ${s.title}`} />
          <InlineEdit className="grow" value={s.title} label="subtask" onCommit={(v) => renameSubtask(s.id, v)} />
          <button className="icon-btn tiny" aria-label={`Delete subtask ${s.title}`} onClick={() => deleteSubtask(s.id)}><Icon name="x" size={12} /></button>
        </div>
      ))}
      {adding
        ? <AddInput className="subtask-add" placeholder="Subtask, then Enter" onAdd={(v) => addSubtask(task.id, v)} onDone={() => setAdding(false)} />
        : <button className="link small" onClick={() => setAdding(true)}>+ Add subtask</button>}
    </div>
  );
}

export function TaskCard({ task, client, highlight }: { task: Task; client: Client; highlight: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const [expanded, setExpanded] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const { toggleTask, updateTask, deleteTask } = useStore.getState();
  const overdue = isOverdue(task);
  const subsDone = task.subtasks.filter((s) => s.done).length;

  useEffect(() => {
    if (highlight) cardRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [highlight]);

  const { role: _role, tabIndex: _tab, ...a11y } = attributes; // the card itself isn't a button
  return (
    <div ref={(el) => { setNodeRef(el); cardRef.current = el; }} {...a11y} {...listeners}
      className={`task-card${task.done ? ' done' : ''}${overdue ? ' overdue' : ''}${highlight ? ' highlight' : ''}${isDragging ? ' dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }} data-task-id={task.id}>
      <div className="task-top">
        <Checkbox checked={task.done} onToggle={() => toggleTask(task.id)} label={`Mark ${task.title} ${task.done ? 'not done' : 'done'}`} />
        <InlineEdit className="task-title" value={task.title} label="task" onCommit={(v) => updateTask(task.id, { title: v })} />
        <Menu className="icon-btn card-menu" button={<Icon name="more" size={15} />} label="Task actions" items={[
          { label: 'Add subtask', onSelect: () => { setExpanded(true); setAddingSub(true); } },
          { label: 'Delete task', danger: true, onSelect: () => deleteTask(task.id) },
        ]} />
      </div>
      <div className="task-meta">
        <AssigneeButton task={task} client={client} />
        <DueButton task={task} />
        {task.subtasks.length > 0 && (
          <button className={`meta-btn subtask-count${subsDone === task.subtasks.length ? ' all' : ''}`} onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded} aria-label={`${subsDone} of ${task.subtasks.length} subtasks done. ${expanded ? 'Hide' : 'Show'}`}>
            <Icon name="subtasks" size={13} /><span>{subsDone}/{task.subtasks.length}</span>
          </button>
        )}
      </div>
      {(expanded || addingSub) && <Subtasks task={task} adding={addingSub} setAdding={setAddingSub} />}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatDue, formatLong, isWeekend, todayIso } from '../model/dates';
import { isOverdue, memberById } from '../model/derive';
import type { Client, Task } from '../model/schema';
import { useStore } from '../store/store';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { AddInput, InlineEdit } from './InlineEdit';
import { MemberPicker } from './MemberPicker';
import { Menu, Popover } from './Popover';
import { DatePickButton } from './DatePickButton';
import { useMe } from './WhoAmI';
import { askWhoAmI } from '../ui';

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

/** Due-date chip: weekday + date, red when overdue, amber ⚠ when due on a weekend. */
export function DueButton({ task }: { task: Task }) {
  const today = todayIso();
  const overdue = isOverdue(task, today);
  const weekend = !task.done && !overdue && task.dueDate !== null && isWeekend(task.dueDate);
  const tip = task.dueDate ? `Due ${formatLong(task.dueDate)}${overdue ? ' (overdue)' : weekend ? ' (on a weekend)' : ''}` : 'Set due date';
  return (
    <DatePickButton id={task.id} value={task.dueDate} label={task.dueDate ? `Due ${formatDue(task.dueDate, today)}. Change` : 'Set due date'} title={tip}
      className={`meta-btn${task.dueDate ? '' : ' empty'}${overdue ? ' overdue' : ''}${weekend ? ' weekend' : ''}`}
      onChange={(v) => useStore.getState().updateTask(task.id, { dueDate: v })}>
      <Icon name={weekend ? 'alert' : 'calendar'} size={13} /><span>{task.dueDate ? formatDue(task.dueDate, today) : 'Due'}</span>
    </DatePickButton>
  );
}

/** ☆/★ toggle for the current person's key tasks. */
export function KeyStar({ task, className = '' }: { task: Task; className?: string }) {
  const me = useMe();
  const on = !!me && task.keyFor.includes(me.id);
  return (
    <button className={`star-btn${on ? ' on' : ''} ${className}`} aria-pressed={on}
      aria-label={on ? 'Unmark key task' : 'Mark as key task'} title={on ? 'Key task (only you see this)' : 'Mark as key task'}
      onClick={(e) => { e.stopPropagation(); if (me) useStore.getState().toggleKey(task.id, me.id); else askWhoAmI(); }}>
      <Icon name={on ? 'starFilled' : 'star'} size={14} />
    </button>
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
  const { toggleTask, updateTask, deleteTask, toggleKey } = useStore.getState();
  const me = useMe();
  const key = !!me && task.keyFor.includes(me.id);
  const overdue = isOverdue(task);
  const subsDone = task.subtasks.filter((s) => s.done).length;

  useEffect(() => {
    if (highlight) cardRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [highlight]);

  const { role: _role, tabIndex: _tab, ...a11y } = attributes; // the card itself isn't a button
  return (
    <div ref={(el) => { setNodeRef(el); cardRef.current = el; }} {...a11y} {...listeners}
      className={`task-card${key ? ' key' : ''}${task.done ? ' done' : ''}${overdue ? ' overdue' : ''}${highlight ? ' highlight' : ''}${isDragging ? ' dragging' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }} data-task-id={task.id}>
      <div className="task-top">
        <Checkbox checked={task.done} onToggle={() => toggleTask(task.id)} label={`Mark ${task.title} ${task.done ? 'not done' : 'done'}`} />
        <InlineEdit className="task-title" value={task.title} label="task" onCommit={(v) => updateTask(task.id, { title: v })} />
        <KeyStar task={task} className="card-star" />
        <Menu className="icon-btn card-menu" button={<Icon name="more" size={15} />} label="Task actions" items={[
          { label: 'Add subtask', onSelect: () => { setExpanded(true); setAddingSub(true); } },
          { label: key ? 'Unmark key task' : 'Mark as key task', onSelect: () => { if (me) toggleKey(task.id, me.id); else askWhoAmI(); } },
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

import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import type { SidebarSection, SidebarTask, Suggestion } from '@poc/contracts';
import { api, ApiError } from '../api';
import { useUi } from '../store';
import { SOURCE_ICON, TASK_TYPE_LABEL, relativeDue } from '../format';
import { Icon } from './Icon';
import { SuggestionCard } from './SuggestionCard';

/**
 * Animate rows that moved within their section (FLIP), so a reorder reads as
 * movement rather than a jump. Rows keep a fixed shape, so nothing else shifts.
 * Positions are measured relative to the row's own list, which ignores
 * scrolling and content added above.
 */
function useFlip(listRef: React.RefObject<HTMLUListElement | null>, key: string) {
  const prev = useRef<Map<string, number>>(new Map());
  useLayoutEffect(() => {
    const ul = listRef.current;
    if (!ul) return;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const next = new Map<string, number>();
    ul.querySelectorAll<HTMLElement>(':scope > li[data-task-id]').forEach((li) => {
      const id = li.dataset.taskId!;
      const top = li.offsetTop;
      next.set(id, top);
      const before = prev.current.get(id);
      if (!reduce && before !== undefined && before !== top && typeof li.animate === 'function') {
        li.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'translateY(0)' }], { duration: 260, easing: 'cubic-bezier(.2,.7,.3,1)' });
      }
    });
    prev.current = next;
  }, [key, listRef]);
}

function TaskRow({ task, index, isToday }: { task: SidebarTask; index: number; isToday: boolean }) {
  const today = useUi((s) => s.state?.today ?? '');
  const open = useUi((s) => s.open);
  const offline = useUi((s) => s.connection === 'lost');
  const [holdBusy, setHoldBusy] = useState(false);
  const [holdError, setHoldError] = useState<string | null>(null);

  const toggleHold = async () => {
    setHoldBusy(true);
    setHoldError(null);
    try {
      await api.hold(task.taskId, !task.onHold);
    } catch (e) {
      setHoldError(e instanceof ApiError ? e.message : 'Could not change hold.');
    } finally {
      setHoldBusy(false);
    }
  };

  const overdue = task.dueDate !== null && task.dueDate < today;
  return (
    <li className={`task${task.quickWin ? ' is-quick' : ''}`} data-task-id={task.taskId}>
      <button type="button" className="task-main" onClick={() => open({ kind: 'task', taskId: task.taskId })} aria-label={`${task.title}, ${task.clientName}. Open prepared work`}>
        {isToday ? (
          <span className="task-order" aria-hidden="true">
            {index + 1}
          </span>
        ) : (
          <span className="task-dot" aria-hidden="true" />
        )}
        <span className="task-body">
          <span className="task-title">{task.title}</span>
          <span className="task-meta">
            <span className="tag">{task.clientName}</span>
            {task.dueDate && !isToday ? <span className={overdue ? 'due overdue' : 'due'}>{relativeDue(task.dueDate, today)}</span> : null}
            {task.taskType ? <span>{TASK_TYPE_LABEL[task.taskType]}</span> : null}
            {task.direction === 'owed_to_me' ? <span className="owed">Owed to me</span> : null}
            {task.quickWin ? (
              <span className="quick">
                <Icon name="bolt" size={11} /> Quick win
              </span>
            ) : null}
            {task.preparedStatus === 'preparing' ? (
              <span className="prep prep-busy">
                <span className="spinner" aria-hidden="true" /> Preparing
              </span>
            ) : task.preparedStatus === 'ready' ? (
              <span className="prep prep-ready">
                <Icon name="sparkle" size={11} /> Ready
              </span>
            ) : task.preparedStatus === 'failed' ? (
              <span className="prep prep-failed">Prep failed</span>
            ) : null}
            {task.source ? (
              <span className="task-src" title={task.source.label}>
                <Icon name={SOURCE_ICON[task.source.connector]} size={11} />
              </span>
            ) : null}
          </span>
          {isToday && task.reason ? <span className="task-reason">{task.reason}</span> : null}
        </span>
      </button>
      <button
        type="button"
        className="icon-btn task-hold"
        onClick={() => void toggleHold()}
        disabled={holdBusy || offline}
        aria-label={task.onHold ? `Take “${task.title}” off hold` : `Put “${task.title}” on hold`}
        title={task.onHold ? 'Take off hold' : 'Put on hold'}
      >
        <Icon name={task.onHold ? 'play' : 'pause'} size={14} />
      </button>
      {holdError ? (
        <p className="row-error" role="alert">
          {holdError}
        </p>
      ) : null}
    </li>
  );
}

function AddTask() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    setMsg(null);
    try {
      const made = await api.input(t);
      setText('');
      setMsg({ kind: 'ok', text: made.length ? `Added ${made.length} suggestion${made.length > 1 ? 's' : ''} for your OK.` : 'Nothing to add from that.' });
    } catch (err) {
      setMsg({ kind: 'error', text: err instanceof ApiError ? err.message : 'Could not add that.' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="add-task" onSubmit={(e) => void submit(e)}>
      <label className="sr-only" htmlFor="add-task-input">
        Add a task
      </label>
      <input id="add-task-input" className="text-input" placeholder="Add a task, e.g. “chase Lena Friday”" value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
      <button type="submit" className="btn btn-sm" disabled={busy || !text.trim()}>
        {busy ? 'Adding…' : 'Add'}
      </button>
      {msg ? (
        <p className={msg.kind === 'error' ? 'form-error' : 'form-ok'} role="status">
          {msg.text}
        </p>
      ) : null}
    </form>
  );
}

function Section({ section, extra }: { section: SidebarSection; extra?: Suggestion[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const isToday = section.key === 'today';
  const isInbox = section.key === 'inbox';
  useFlip(listRef, section.items.map((t) => t.taskId).join(','));
  const count = section.items.length + (extra?.length ?? 0);
  const empty = count === 0;
  const bodyId = `section-${section.key}`;
  return (
    <section className={`section${empty ? ' is-empty' : ''} section-${isToday ? 'today' : section.key.startsWith('day-') ? 'day' : section.key}`} data-section={section.key} aria-label={section.label}>
      <h2 className="section-head">
        <button type="button" className="section-toggle" aria-expanded={!collapsed} aria-controls={bodyId} onClick={() => setCollapsed((c) => !c)} disabled={empty && !isInbox}>
          <Icon name={collapsed ? 'chevronRight' : 'chevronDown'} size={13} />
          <span className="section-label">{section.label}</span>
          <span className="section-count">{empty ? '' : count}</span>
          {isToday && !empty ? <span className="section-note">in the order I’d do them</span> : null}
          {empty && !isInbox ? <span className="section-note">Nothing here</span> : null}
        </button>
      </h2>
      <div id={bodyId} hidden={collapsed || (empty && !isInbox)}>
        {extra?.length ? (
          <div className="section-cards">
            {extra.map((s) => (
              <SuggestionCard key={s.id} suggestion={s} showNudge />
            ))}
          </div>
        ) : null}
        {isInbox ? <AddTask /> : null}
        {isInbox && empty ? <p className="section-empty">Inbox is clear. Anything you type or say without a date lands here.</p> : null}
        <ul className="task-list" ref={listRef}>
          {section.items.map((t, i) => (
            <TaskRow key={t.taskId} task={t} index={i} isToday={isToday} />
          ))}
        </ul>
      </div>
    </section>
  );
}

export function TaskList({ sections, inboxSuggestions }: { sections: SidebarSection[]; inboxSuggestions: Suggestion[] }) {
  return (
    <div className="sections">
      {sections.map((sec) => (
        <Section key={sec.key} section={sec} extra={sec.key === 'inbox' ? inboxSuggestions : undefined} />
      ))}
    </div>
  );
}

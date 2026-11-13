import { useCallback, useEffect, useRef, useState } from 'react';
import type { PreparedResponse, PreparedWork, SidebarTask, Suggestion } from '@poc/contracts';
import { api, ApiError } from '../api';
import { useUi } from '../store';
import { DIRECTION_LABEL, TASK_TYPE_LABEL, relativeDue } from '../format';
import { Icon } from './Icon';
import { ClientTag, SourceChip, SuggestionActions, SuggestionCard, SuggestionDetails, slotLabel, useAllTasks } from './SuggestionCard';

const TITLES: Record<PreparedWork['type'], string> = {
  reply_email: 'Drafted reply',
  schedule_meeting: 'Suggested times and reply',
  review_file: 'File review',
  follow_up: 'Drafted chaser',
  other: 'What I gathered',
};

function Work({ prepared, suggestion, tasks, editing }: { prepared: PreparedWork; suggestion: Suggestion | null; tasks: SidebarTask[]; editing: boolean }) {
  const draftFromSuggestion = suggestion?.kind === 'send_reply' ? suggestion : null;
  const draftBlock = (draft: Extract<PreparedWork, { draft: unknown }>['draft']) =>
    editing && draftFromSuggestion ? null : draftFromSuggestion ? (
      <SuggestionDetails s={draftFromSuggestion} tasks={tasks} variant="prepared" />
    ) : (
      <SuggestionDetails
        s={{
          id: 'preview',
          kind: 'send_reply',
          status: 'pending',
          title: '',
          nudge: '',
          clientId: null,
          clientConfidence: 'high',
          source: null,
          createdAt: new Date(0).toISOString(),
          decidedAt: null,
          error: null,
          payload: { draft, taskId: null },
        }}
        tasks={tasks}
        variant="prepared"
      />
    );

  switch (prepared.type) {
    case 'reply_email':
    case 'follow_up':
      return draftBlock(prepared.draft);
    case 'schedule_meeting':
      return (
        <>
          {editing ? null : (
          <ul className="slots" aria-label="Suggested times">
            {prepared.slots.map((s) => (
              <li key={s.start} className="slot">
                <Icon name="calendar" size={14} /> {slotLabel(s)}
              </li>
            ))}
          </ul>
          )}
          {editing ? null : <h3 className="pw-sub">Reply</h3>}
          {draftBlock(prepared.draft)}
        </>
      );
    case 'review_file':
      return (
        <>
          <p className="file-path">
            <Icon name="file" size={14} />
            <span className="mono">{prepared.path}</span>
          </p>
          <h3 className="pw-sub">Summary</h3>
          <p className="pw-text">{prepared.summary}</p>
          <h3 className="pw-sub">Key points</h3>
          <ul className="key-points">
            {prepared.keyPoints.map((k, i) => (
              <li key={i}>{k}</li>
            ))}
          </ul>
        </>
      );
    case 'other':
      return prepared.context.length ? (
        <ul className="context-list">
          {prepared.context.map((c, i) => (
            <li key={i} className="context-item">
              <h3 className="pw-sub">{c.label}</h3>
              <p className="pw-text">{c.text}</p>
              {c.source ? <SourceChip source={c.source} /> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">I didn’t find anything related yet.</p>
      );
  }
}

const APPROVE_LABEL: Record<PreparedWork['type'], string> = {
  reply_email: 'Approve and send',
  schedule_meeting: 'Approve and send',
  follow_up: 'Approve and send',
  review_file: 'Approve: mark reviewed',
  other: 'Approve: mark done',
};

export function PreparedView({ taskId }: { taskId: string }) {
  const task = useUi((s) => s.state?.sections.flatMap((x) => x.items).find((t) => t.taskId === taskId));
  const today = useUi((s) => s.state?.today ?? '');
  const open = useUi((s) => s.open);
  const offline = useUi((s) => s.connection === 'lost');
  const allSuggestions = useUi((s) => s.state?.suggestions);
  const nextSteps = (allSuggestions ?? []).filter((x) => x.source?.connector === 'next_step' && x.source.id === taskId && x.status === 'pending');
  const tasks = useAllTasks();
  const [data, setData] = useState<PreparedResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [approved, setApproved] = useState<Suggestion | null>(null);
  const [editing, setEditing] = useState(false);
  const lastTask = useRef<SidebarTask | undefined>(task);
  if (task) lastTask.current = task;
  const shown = task ?? lastTask.current;
  const headingRef = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.prepared(taskId));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : 'Could not load the prepared work.');
    }
  }, [taskId]);

  // Load on open and whenever the brain says this task's preparation changed.
  useEffect(() => {
    void load();
  }, [load, task?.preparedStatus, task?.preparedSuggestionId]);

  // Fallback poll while preparing, in case a state event is missed.
  useEffect(() => {
    if (data?.status !== 'preparing') return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [data?.status, load]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [taskId]);

  const regenerate = async () => {
    setRegenerating(true);
    setApproved(null);
    try {
      await api.prepare(taskId);
      setData((d) => (d ? { ...d, status: 'preparing' } : d));
      await load();
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : 'Could not start preparing.');
    } finally {
      setRegenerating(false);
    }
  };

  const status = data?.status ?? 'none';
  const prepared = data?.prepared ?? null;
  // Prefer the live suggestion from state (its status changes there).
  const liveSuggestion = useUi((s) => (data?.suggestion ? (s.state?.suggestions.find((x) => x.id === data.suggestion!.id) ?? null) : null));
  const suggestion = liveSuggestion ?? (data?.suggestion && (data.suggestion.status === 'pending' || data.suggestion.status === 'failed') ? data.suggestion : null);

  return (
    <div className="panel" aria-labelledby="pw-heading">
      <div className="panel-head">
        <button type="button" className="icon-btn" onClick={() => open(null)} aria-label="Back to the list">
          <Icon name="back" size={18} />
        </button>
        <h2 className="panel-title" id="pw-heading" tabIndex={-1} ref={headingRef}>
          {shown?.title ?? 'Task'}
        </h2>
        {task ? (
          <button
            type="button"
            className="btn btn-sm"
            disabled={offline}
            onClick={() => void api.hold(task.taskId, !task.onHold).catch(() => setLoadError('Could not change hold.'))}
          >
            <Icon name={task.onHold ? 'play' : 'pause'} size={13} /> {task.onHold ? 'Unhold' : 'Hold'}
          </button>
        ) : null}
      </div>
      <div className="panel-body">
        {shown ? (
          <div className="pw-meta">
            <ClientTag name={shown.clientName} />
            {shown.dueDate ? <span>Due {relativeDue(shown.dueDate, today)}</span> : <span>No date</span>}
            {shown.taskType ? <span>{TASK_TYPE_LABEL[shown.taskType]}</span> : null}
            {shown.direction ? <span>{DIRECTION_LABEL[shown.direction]}</span> : null}
            {shown.onHold ? <span className="tag tag-hold">On hold</span> : null}
            <SourceChip source={shown.source} />
          </div>
        ) : null}
        {shown?.reason ? <p className="pw-reason">{shown.reason}</p> : null}

        {loadError ? (
          <p className="form-error" role="alert">
            <Icon name="alert" size={14} /> {loadError}
          </p>
        ) : null}

        {!task && !approved ? <p className="pw-done">This task is no longer open.</p> : null}

        {approved ? (
          <div className="pw-done" role="status">
            <Icon name="check" size={16} /> Done. {approved.kind === 'send_reply' ? 'The email is sent and the task is ticked off.' : 'The task is ticked off.'}
          </div>
        ) : null}

        {nextSteps.length ? (
          <div className="pw-next">
            <h3 className="pw-sub">
              <Icon name="next" size={14} /> Next step
            </h3>
            {nextSteps.map((s) => (
              <SuggestionCard key={s.id} suggestion={s} showNudge />
            ))}
          </div>
        ) : null}

        {!approved && task ? (
          status === 'preparing' || regenerating ? (
            <div className="pw-preparing" role="status" aria-live="polite">
              <span className="spinner big" aria-hidden="true" />
              <div>
                <strong>Preparing…</strong>
                <p className="muted small">I’m reading the context and drafting this now.</p>
              </div>
            </div>
          ) : status === 'failed' ? (
            <div className="sg-failed" role="alert">
              <Icon name="alert" size={14} />
              <div>
                <strong>I couldn’t prepare this.</strong> Try again, or work on it directly.
              </div>
            </div>
          ) : status === 'none' || !prepared ? (
            <div className="pw-empty">
              <p>Nothing is prepared for this task yet.</p>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void regenerate()} disabled={offline}>
                <Icon name="sparkle" size={14} /> Prepare it now
              </button>
            </div>
          ) : (
            <section className={`pw pw-${prepared.type}`} data-prepared-type={prepared.type} aria-label={TITLES[prepared.type]}>
              <div className="pw-head">
                <h3 className="pw-title">{TITLES[prepared.type]}</h3>
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => void regenerate()} disabled={offline}>
                  <Icon name="refresh" size={13} /> Regenerate
                </button>
              </div>
              <Work prepared={prepared} suggestion={suggestion} tasks={tasks} editing={editing} />
              {suggestion ? (
                <SuggestionActions
                  suggestion={suggestion}
                  slots={prepared.type === 'schedule_meeting' ? prepared.slots : undefined}
                  approveLabel={APPROVE_LABEL[prepared.type]}
                  onEditingChange={setEditing}
                  onDecided={(s) => {
                    if (s.status === 'applied' || s.status === 'approved') setApproved(s);
                    else if (s.status === 'denied') void load();
                  }}
                />
              ) : (
                <p className="muted small">Nothing to approve here yet.</p>
              )}
            </section>
          )
        ) : null}
      </div>
    </div>
  );
}

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { SidebarTask, Suggestion, TimeSlot } from '@poc/contracts';
import { useUi } from '../store';
import { buildEdits, initialForm, needsInputBeforeApprove, type EditForm } from '../edits';
import { DIRECTION_LABEL, SOURCE_ICON, TASK_TYPE_LABEL, ago, minutesBetween, personLabel, relativeDue, span } from '../format';
import { Icon, type IconName } from './Icon';

const KIND: Record<Suggestion['kind'], { label: string; icon: IconName }> = {
  create_task: { label: 'New task', icon: 'plus' },
  complete_task: { label: 'Mark done', icon: 'check' },
  reschedule_task: { label: 'Reschedule', icon: 'clock' },
  calendar_block: { label: 'Calendar block', icon: 'calendar' },
  send_reply: { label: 'Send email', icon: 'mail' },
  confirm_client: { label: 'Which client?', icon: 'inbox' },
};

export function useAllTasks(): SidebarTask[] {
  const sections = useUi((s) => s.state?.sections);
  return sections ? sections.flatMap((sec) => sec.items) : [];
}

function useClientName(): (id: string | null | undefined) => string | null {
  const clients = useUi((s) => s.state?.clients);
  const tasks = useAllTasks();
  // The client list is "active clients for the picker"; fall back to a task's clientName (e.g. Internal).
  return (id) => (id ? (clients?.find((c) => c.id === id)?.name ?? tasks.find((t) => t.clientId === id)?.clientName ?? 'Unknown client') : null);
}

export function ClientTag({ name, low }: { name: string | null; low?: boolean }) {
  if (!name) return <span className="tag tag-none">No client yet</span>;
  return (
    <span className={`tag${low ? ' tag-low' : ''}`} title={low ? 'Uncertain match: please confirm' : undefined}>
      {name}
      {low ? <span aria-label="uncertain match"> ?</span> : null}
    </span>
  );
}

export function SourceChip({ source }: { source: Suggestion['source'] }) {
  if (!source) return null;
  return (
    <span className="chip chip-source" title={source.label}>
      <Icon name={SOURCE_ICON[source.connector]} size={12} />
      <span className="chip-text">{source.label}</span>
    </span>
  );
}

/** Kind-specific summary shown when not editing. */
function Details({ s, tasks, variant }: { s: Suggestion; tasks: SidebarTask[]; variant: 'card' | 'prepared' }) {
  const today = useUi((st) => st.state?.today ?? '');
  const taskTitle = (id: string) => tasks.find((t) => t.taskId === id)?.title ?? 'a task';
  const [expanded, setExpanded] = useState(false);
  switch (s.kind) {
    case 'create_task':
      return (
        <p className="sg-detail">
          {s.payload.dueDate ? <>Due {relativeDue(s.payload.dueDate, today)}</> : 'No date yet: lands in Inbox'}
          {s.taskType ? <> · {TASK_TYPE_LABEL[s.taskType]}</> : null}
        </p>
      );
    case 'complete_task':
      return variant === 'prepared' ? null : <p className="sg-detail">Mark “{taskTitle(s.payload.taskId)}” as done</p>;
    case 'reschedule_task': {
      const t = tasks.find((x) => x.taskId === s.payload.taskId);
      return (
        <p className="sg-detail">
          Move “{t?.title ?? 'a task'}”{t?.dueDate ? <> from {relativeDue(t.dueDate, today)}</> : null} to{' '}
          {s.payload.dueDate ? relativeDue(s.payload.dueDate, today) : 'no date'}
        </p>
      );
    }
    case 'calendar_block':
      return (
        <p className="sg-detail">
          {s.payload.subject} · {span(s.payload.start, s.payload.end)} ({minutesBetween(s.payload.start, s.payload.end)} min)
          {s.payload.taskId ? <> · for “{taskTitle(s.payload.taskId)}”</> : null}
        </p>
      );
    case 'send_reply': {
      const d = s.payload.draft;
      return (
        <div className="draft">
          <dl className="draft-head">
            <dt>To</dt>
            <dd>{d.to.map(personLabel).join(', ')}</dd>
            {d.cc.length ? (
              <>
                <dt>Cc</dt>
                <dd>{d.cc.map(personLabel).join(', ')}</dd>
              </>
            ) : null}
            <dt>Subject</dt>
            <dd>{d.subject}</dd>
          </dl>
          <div className={`draft-body${variant === 'card' && !expanded ? ' clamp' : ''}`}>{d.body}</div>
          {variant === 'card' && d.body.split('\n').length > 4 ? (
            <button type="button" className="link small" onClick={() => setExpanded((x) => !x)} aria-expanded={expanded}>
              {expanded ? 'Show less' : 'Show the whole email'}
            </button>
          ) : null}
        </div>
      );
    }
    case 'confirm_client':
      return (
        <p className="sg-detail">
          {s.payload.alias ? <>Who is “{s.payload.alias}”? </> : null}
          {s.payload.relatedSuggestionIds.length
            ? s.payload.relatedSuggestionIds.length === 1
              ? 'One suggestion waits on this.'
              : `${s.payload.relatedSuggestionIds.length} suggestions wait on this.`
            : null}
        </p>
      );
  }
}

function Field({ label, children, hint }: { label: string; children: (id: string) => ReactNode; hint?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {children(id)}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  );
}

function ClientSelect({ id, value, onChange, only }: { id: string; value: string; onChange: (v: string) => void; only?: string[] }) {
  const clients = useUi((s) => s.state?.clients ?? []);
  const list = only && only.length ? clients.filter((c) => only.includes(c.id)) : clients;
  const extra = only && only.length ? clients.filter((c) => !only.includes(c.id)) : [];
  return (
    <select id={id} className="text-input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a client…</option>
      {extra.length ? (
        <>
          <optgroup label="Likely">
            {list.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Other clients">
            {extra.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        </>
      ) : (
        list.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))
      )}
    </select>
  );
}

function EditFields({
  s,
  form,
  setForm,
  tasks,
  slots,
  firstRef,
}: {
  s: Suggestion;
  form: EditForm;
  setForm: (f: EditForm) => void;
  tasks: SidebarTask[];
  slots?: TimeSlot[];
  firstRef: React.RefObject<HTMLElement | null>;
}) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const ref = (el: HTMLElement | null) => {
    firstRef.current = el;
  };
  switch (form.kind) {
    case 'create_task':
      return (
        <>
          <Field label="Task">{(id) => <input id={id} ref={ref} className="text-input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />}</Field>
          <div className="field-row">
            <Field label="Client">{(id) => <ClientSelect id={id} value={form.clientId} onChange={(v) => setForm({ ...form, clientId: v })} />}</Field>
            <Field label="Due">
              {(id) => <input id={id} type="date" className="text-input" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />}
            </Field>
          </div>
        </>
      );
    case 'complete_task':
      return (
        <Field label="Task to mark done">
          {(id) => (
            <select id={id} ref={ref} className="text-input" value={form.taskId} onChange={(e) => setForm({ ...form, taskId: e.target.value })}>
              {tasks.map((t) => (
                <option key={t.taskId} value={t.taskId}>
                  {t.title} ({t.clientName})
                </option>
              ))}
              {!tasks.some((t) => t.taskId === form.taskId) ? <option value={form.taskId}>{form.taskId}</option> : null}
            </select>
          )}
        </Field>
      );
    case 'reschedule_task':
      return (
        <Field label="New date" hint="Leave empty to move it to Inbox.">
          {(id) => <input id={id} ref={ref} type="date" className="text-input" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />}
        </Field>
      );
    case 'calendar_block':
      return (
        <>
          <Field label="Name">{(id) => <input id={id} ref={ref} className="text-input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />}</Field>
          <div className="field-row">
            <Field label="Starts">
              {(id) => <input id={id} type="datetime-local" className="text-input" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />}
            </Field>
            <Field label="Ends">
              {(id) => <input id={id} type="datetime-local" className="text-input" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />}
            </Field>
          </div>
        </>
      );
    case 'send_reply': {
      const insert = (text: string) => {
        const el = bodyRef.current;
        const at = el ? el.selectionStart : form.body.length;
        const before = form.body.slice(0, at);
        const after = form.body.slice(at);
        const sep = before && !before.endsWith('\n') ? '\n' : '';
        setForm({ ...form, body: `${before}${sep}${text}\n${after}` });
      };
      return (
        <>
          <Field label="To">{(id) => <input id={id} ref={ref} className="text-input" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} />}</Field>
          <Field label="Cc">{(id) => <input id={id} className="text-input" value={form.cc} placeholder="Optional" onChange={(e) => setForm({ ...form, cc: e.target.value })} />}</Field>
          <Field label="Subject">{(id) => <input id={id} className="text-input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />}</Field>
          {slots?.length ? (
            <div className="field">
              <span className="field-label">Put a time in the email</span>
              <div className="slot-insert">
                {slots.map((sl) => (
                  <button key={sl.start} type="button" className="btn btn-sm" onClick={() => insert(`- ${slotLabel(sl)}`)}>
                    <Icon name="plus" size={12} /> {slotLabel(sl)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <Field label="Message">
            {(id) => (
              <textarea
                id={id}
                ref={bodyRef}
                className="text-input textarea"
                rows={Math.min(14, Math.max(6, form.body.split('\n').length + 1))}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
              />
            )}
          </Field>
        </>
      );
    }
    case 'confirm_client':
      return (
        <>
          <Field label="Client">
            {(id) => <ClientSelect id={id} value={form.clientId} onChange={(v) => setForm({ ...form, clientId: v })} only={s.kind === 'confirm_client' ? s.payload.candidateClientIds : []} />}
          </Field>
          <Field label="Remember this name for the client" hint="Saved under “Also known as” in the client profile.">
            {(id) => <input id={id} ref={ref} className="text-input" value={form.alias} onChange={(e) => setForm({ ...form, alias: e.target.value })} />}
          </Field>
        </>
      );
  }
}

let slotFmt: Intl.DateTimeFormat | null = null;
export function slotLabel(sl: TimeSlot): string {
  slotFmt ??= new Intl.DateTimeFormat([], { weekday: 'short', month: 'short', day: 'numeric' });
  return `${slotFmt.format(new Date(sl.start))}, ${span(sl.start, sl.end)}`;
}

export interface SuggestionProps {
  suggestion: Suggestion;
  /** Meeting slots, for the prepared meeting view's "put a time in the email". */
  slots?: TimeSlot[];
  approveLabel?: string;
  onDecided?: (s: Suggestion) => void;
  onEditingChange?: (editing: boolean) => void;
}

/** Approve / Edit / Deny for one suggestion, with its edit form. Used by cards and prepared work. */
export function SuggestionActions({ suggestion: s, slots, approveLabel, onDecided, onEditingChange }: SuggestionProps) {
  const tasks = useAllTasks();
  const inFlight = useUi((st) => st.inFlight[s.id]);
  const error = useUi((st) => st.decisionErrors[s.id]);
  const offline = useUi((st) => st.connection === 'lost');
  const decide = useUi((st) => st.decide);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<EditForm>(() => initialForm(s));
  const [formError, setFormError] = useState<string | null>(null);
  const firstRef = useRef<HTMLElement | null>(null);
  const editBtn = useRef<HTMLButtonElement>(null);
  const inlinePick = needsInputBeforeApprove(s);

  useEffect(() => {
    if (editing) firstRef.current?.focus();
    onEditingChange?.(editing);
  }, [editing]);

  // Pick up a fresh suggestion from the brain when not editing.
  const sKey = `${s.id}|${s.status}|${s.clientId}|${s.title}|${JSON.stringify(s.payload)}`;
  useEffect(() => {
    if (!editing) setForm(initialForm(s));
  }, [sKey, editing]);

  const run = async (decision: 'approve' | 'deny', withForm: boolean) => {
    let edits;
    if (decision === 'approve' && (withForm || inlinePick)) {
      const r = buildEdits(s, form);
      if (!r.ok) {
        setFormError(r.error);
        return;
      }
      edits = r.edits;
    }
    setFormError(null);
    const ok = await decide(s.id, decision, edits);
    if (ok) {
      setEditing(false);
      const after = useUi.getState().decided[s.id];
      if (after) onDecided?.(after);
    }
  };

  const busy = Boolean(inFlight) || offline;
  const failed = s.status === 'failed';

  if (editing) {
    return (
      <form
        className="sg-edit"
        aria-label={`Edit: ${s.title}`}
        onSubmit={(e) => {
          e.preventDefault();
          void run('approve', true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            setEditing(false);
            setFormError(null);
            requestAnimationFrame(() => editBtn.current?.focus());
          }
        }}
      >
        <EditFields s={s} form={form} setForm={setForm} tasks={tasks} slots={slots} firstRef={firstRef} />
        {formError || error ? (
          <p className="form-error" role="alert">
            <Icon name="alert" size={14} /> {formError ?? error}
          </p>
        ) : null}
        <div className="sg-actions">
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
            <Icon name="check" size={14} /> {inFlight === 'approve' ? 'Approving…' : 'Approve with changes'}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              setEditing(false);
              setFormError(null);
              setForm(initialForm(s));
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <>
      {inlinePick ? (
        <InlinePick s={s} form={form} setForm={setForm} />
      ) : null}
      {failed ? (
        <div className="sg-failed" role="alert">
          <Icon name="alert" size={14} />
          <div>
            <strong>That didn’t go through.</strong> {s.error ?? 'The action failed.'}
          </div>
        </div>
      ) : null}
      {formError || error ? (
        <p className="form-error" role="alert">
          <Icon name="alert" size={14} /> {formError ?? error}
        </p>
      ) : null}
      <div className="sg-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void run('approve', false)}>
          <Icon name={failed ? 'refresh' : 'check'} size={14} />
          {inFlight === 'approve' ? 'Approving…' : failed ? 'Try again' : (approveLabel ?? 'Approve')}
        </button>
        <button ref={editBtn} type="button" className="btn btn-sm" disabled={busy} onClick={() => setEditing(true)}>
          <Icon name="edit" size={14} /> Edit
        </button>
        <button type="button" className="btn btn-sm btn-quiet" disabled={busy} onClick={() => void run('deny', false)}>
          <Icon name="x" size={14} /> {inFlight === 'deny' ? 'Denying…' : failed ? 'Dismiss' : 'Deny'}
        </button>
      </div>
    </>
  );
}

/** Client picker shown on the card itself when approving needs one (unknown client, uncertain match). */
function InlinePick({ s, form, setForm }: { s: Suggestion; form: EditForm; setForm: (f: EditForm) => void }) {
  const id = useId();
  if (form.kind !== 'create_task' && form.kind !== 'confirm_client') return null;
  return (
    <div className="field inline-pick">
      <label htmlFor={id} className="field-label">
        {form.kind === 'confirm_client' ? 'Which client is this?' : 'Which client is this for?'}
      </label>
      <ClientSelect id={id} value={form.clientId} onChange={(v) => setForm({ ...form, clientId: v })} only={s.kind === 'confirm_client' ? s.payload.candidateClientIds : []} />
    </div>
  );
}

/** A suggestion as a card: what it is, where it came from, and Approve / Edit / Deny. */
export function SuggestionCard({ suggestion: s, showNudge = false }: { suggestion: Suggestion; showNudge?: boolean }) {
  const tasks = useAllTasks();
  const clientName = useClientName();
  const now = useUi((st) => st.state?.now ?? s.createdAt);
  const decided = s.status === 'applied' || s.status === 'denied' || s.status === 'approved';
  const dupTitle =
    s.duplicateOf?.kind === 'task'
      ? tasks.find((t) => t.taskId === s.duplicateOf!.id)?.title
      : s.duplicateOf
        ? useUi.getState().state?.suggestions.find((x) => x.id === s.duplicateOf!.id)?.title
        : undefined;
  const k = KIND[s.kind];
  const headingId = useId();
  return (
    <article className={`sg-card${s.status === 'failed' ? ' is-failed' : ''}${decided ? ' is-decided' : ''}`} aria-labelledby={headingId} data-suggestion-id={s.id} data-kind={s.kind}>
      <div className="sg-top">
        <span className="sg-kind">
          <Icon name={k.icon} size={13} /> {k.label}
        </span>
        {s.kind !== 'confirm_client' ? <ClientTag name={clientName(s.clientId)} low={s.clientConfidence === 'low'} /> : null}
        <span className="sg-time">{ago(s.createdAt, now)}</span>
      </div>
      <h3 className="sg-title" id={headingId}>
        {s.title}
      </h3>
      {showNudge && s.nudge ? <p className="sg-nudge">{s.nudge}</p> : null}
      <Details s={s} tasks={tasks} variant="card" />
      {s.direction || s.source || s.duplicateOf ? (
        <div className="chips">
          {s.direction ? (
            <span className={`chip chip-dir ${s.direction}`}>
              <Icon name={s.direction === 'i_owe' ? 'arrowOut' : 'arrowIn'} size={12} /> {DIRECTION_LABEL[s.direction]}
            </span>
          ) : null}
          <SourceChip source={s.source} />
          {s.duplicateOf ? (
            <span className="chip chip-dup" title={dupTitle ? `Looks like: ${dupTitle}` : undefined}>
              <Icon name="copy" size={12} /> <span className="chip-text">Possible duplicate{dupTitle ? ` of “${dupTitle}”` : ''}</span>
            </span>
          ) : null}
        </div>
      ) : null}
      {decided ? (
        <p className="sg-outcome">
          <Icon name={s.status === 'denied' ? 'x' : 'check'} size={14} /> {s.status === 'denied' ? 'Denied' : 'Approved'}
        </p>
      ) : (
        <SuggestionActions suggestion={s} />
      )}
    </article>
  );
}

export { Details as SuggestionDetails };

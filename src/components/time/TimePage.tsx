import { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, formatDue, MONTH_SHORT, parseIso, todayIso } from '../../model/dates';
import { useStore } from '../../store/store';
import { usePrefs, setPrefs } from '../../prefs';
import { clientName, deliverableOptions, findDeliverable, openAirName } from '../../time/lookup';
import { durationMs, formatClock, formatTimeOfDay, formatTotal, groupEntries, weekStartSat, type Group } from '../../time/model';
import { time, useTime } from '../../time/store';
import { ClientLogo } from '../Avatar';
import { WhoPrompt } from '../CalendarChips';
import { Icon } from '../Icon';
import { confirmDialog, Modal } from '../Modal';
import { useMe } from '../WhoAmI';
import { DayTimeline } from './DayTimeline';
import { EditEntry } from './EditEntry';
import { OpenAirSelect, TargetSelects } from './TimeFields';
import { TimesheetModal } from './Timesheet';
import { useNow } from './TimerPill';

export function TimePage() {
  const me = useMe();
  const status = useTime((s) => s.status);
  const error = useTime((s) => s.error);
  const [adding, setAdding] = useState(false);
  const [sheet, setSheet] = useState(false);
  const showTimeline = usePrefs((s) => s.timeTimeline);
  if (!me) return <WhoPrompt />;
  return (
    <div className="time-page">
      <header className="week-head">
        <h1 className="week-title">Time</h1>
        <div className="week-tools">
          <button className="btn btn-sm" onClick={() => setAdding(true)}><Icon name="plus" size={13} /> Add time</button>
          <button className="btn btn-sm" onClick={() => setSheet(true)}><Icon name="week" size={13} /> Weekly timesheet</button>
          <label className="toggle"><input type="checkbox" checked={showTimeline} onChange={(e) => setPrefs({ timeTimeline: e.target.checked })} /> Day timeline</label>
        </div>
      </header>
      {status === 'loading' && <p className="muted pad-x">Loading your time…</p>}
      {status === 'error' && <p className="welcome-error pad-x" role="alert">Couldn't load your time: {error}</p>}
      {status === 'ready' && (
        <div className={`time-body${showTimeline ? ' with-timeline' : ''}`}>
          <div className="time-main">
            <QuickStart />
            <EntriesList />
          </div>
          {showTimeline && <DayTimeline />}
        </div>
      )}
      {adding && <EditEntry onClose={() => setAdding(false)} />}
      {sheet && <TimesheetModal onClose={() => setSheet(false)} />}
    </div>
  );
}

/** Client / Deliverable / OpenAir / Note, then Start. While a timer runs, edits go straight to it. */
function QuickStart() {
  const timer = useTime((s) => s.timer);
  const clients = useStore((s) => s.ws.clients);
  const active = useMemo(() => clients.filter((c) => !c.archived && c.name.trim()).sort((a, b) => a.name.localeCompare(b.name)), [clients]);
  const [clientText, setClientText] = useState('');
  const [delivText, setDelivText] = useState('');
  const [oa, setOa] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [justStopped, setJustStopped] = useState(false);
  const now = useNow(!!timer);

  // Fill from the running timer, but never overwrite what you're typing.
  const lastTimer = useRef(timer);
  useEffect(() => {
    const prev = lastTimer.current;
    lastTimer.current = timer;
    if (!timer) return;
    const tClient = timer.clientId ? clients.find((c) => c.id === timer.clientId)?.name ?? '' : '';
    const tDeliv = findDeliverable(clients, timer.deliverableId);
    const tDelivLabel = tDeliv ? deliverableOptions(tDeliv.client).find((d) => d.id === timer.deliverableId)?.label ?? tDeliv.deliverable.title : '';
    const prevClient = prev?.clientId ? clients.find((c) => c.id === prev.clientId)?.name ?? '' : '';
    setClientText((v) => (!v || v === prevClient ? tClient : v));
    setDelivText((v) => (!v || !prev || prev.deliverableId !== timer.deliverableId ? tDelivLabel : v));
    setOa((v) => (v === null || v === prev?.openAirTaskId ? timer.openAirTaskId : v));
    setNote((v) => (!v || v === prev?.note ? timer.note : v));
  }, [timer, clients]);

  const resolveClient = (text: string) => {
    const t = text.trim().toLowerCase();
    if (!t) return null;
    return active.find((c) => c.name.toLowerCase() === t) ?? (() => { const m = active.filter((c) => c.name.toLowerCase().startsWith(t)); return m.length === 1 ? m[0]! : null; })();
  };
  const client = resolveClient(clientText);
  const delivs = client ? deliverableOptions(client) : [];

  /** Turn the typed fields into ids, creating a client / Ad-hoc deliverable for new names. */
  function resolveTarget() {
    const s = useStore.getState();
    let c = resolveClient(clientText);
    if (!c && clientText.trim()) { const id = s.addClient(clientText.trim()); c = useStore.getState().ws.clients.find((x) => x.id === id)!; setClientText(c.name); }
    let deliverableId: string | null = null;
    if (c && delivText.trim()) {
      const opts = deliverableOptions(c);
      const t = delivText.trim().toLowerCase();
      const hit = opts.find((d) => d.label.toLowerCase() === t) ?? opts.find((d) => d.label.toLowerCase().split(' — ')[0] === t) ?? (opts.filter((d) => d.label.toLowerCase().startsWith(t)).length === 1 ? opts.find((d) => d.label.toLowerCase().startsWith(t)) : undefined);
      deliverableId = hit?.id ?? s.addDeliverable(c.id, 'adhoc', delivText.trim());
    }
    return { clientId: c?.id ?? null, deliverableId, openAirTaskId: oa, note };
  }

  const startOrStop = () => {
    if (timer) {
      time.stop();
      setClientText(''); setDelivText(''); setOa(null); setNote('');
      setJustStopped(true); setTimeout(() => setJustStopped(false), 700);
    } else time.start(resolveTarget());
  };

  return (
    <form className={`quick-start${timer ? ' running' : ''}${justStopped ? ' just-stopped' : ''}`} onSubmit={(e) => { e.preventDefault(); startOrStop(); }}>
      <input className="text-input" list="qs-clients" value={clientText} placeholder="Client" aria-label="Client"
        onChange={(e) => setClientText(e.target.value)}
        onBlur={() => { const c = resolveClient(clientText); if (c) setClientText(c.name); if (timer && (c?.id ?? null) !== timer.clientId && (c || !clientText.trim())) time.retarget({ clientId: c?.id ?? null, deliverableId: null }); }} />
      <datalist id="qs-clients">{active.map((c) => <option key={c.id} value={c.name} />)}</datalist>
      <input className="text-input" list="qs-delivs" value={delivText} placeholder="Deliverable" aria-label="Deliverable" disabled={!client && !clientText.trim()}
        onChange={(e) => setDelivText(e.target.value)}
        onBlur={() => { if (timer && client) { const hit = delivs.find((d) => d.label === delivText); if (hit && hit.id !== timer.deliverableId) time.retarget({ deliverableId: hit.id }); } }} />
      <datalist id="qs-delivs">{delivs.map((d) => <option key={d.id} value={d.label} />)}</datalist>
      <OpenAirSelect id="qs-oa" value={oa} onChange={(id) => { setOa(id); if (timer) time.retarget({ openAirTaskId: id }); }} />
      <input className="text-input qs-note" value={note} placeholder="What are you working on?" aria-label="Note"
        onChange={(e) => { setNote(e.target.value); if (timer) time.retarget({ note: e.target.value }, { quiet: true }); }} />
      {timer && <span className="qs-clock" role="timer">{formatClock(now - Date.parse(timer.startedAtISO))}</span>}
      <button type="submit" className={`btn ${timer ? 'btn-danger' : 'btn-primary'}`}>
        <Icon name={timer ? 'stop' : 'play'} size={13} /> {timer ? 'Stop' : 'Start'}
      </button>
    </form>
  );
}

const weekTitle = (start: string, today: string) => {
  const thisWeek = weekStartSat(today);
  if (start === thisWeek) return 'This week';
  if (start === addDays(thisWeek, -7)) return 'Last week';
  const end = addDays(start, 6);
  const a = parseIso(start), b = parseIso(end);
  return `${MONTH_SHORT[a.month - 1]} ${a.day} to ${MONTH_SHORT[b.month - 1]} ${b.day}, ${b.year}`;
};

const COLLAPSE_KEY = 'planr-time-collapsed';
function useCollapsed() {
  const [state, setState] = useState<Record<string, boolean>>(() => { try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) ?? '{}'); } catch { return {}; } });
  const toggle = (key: string, def: boolean) => setState((s) => {
    const next = { ...s, [key]: !(s[key] ?? def) };
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)); } catch { /* per-device only */ }
    return next;
  });
  return { isCollapsed: (key: string, def: boolean) => state[key] ?? def, toggle };
}

function EntriesList() {
  const entries = useTime((s) => s.entries);
  const timer = useTime((s) => s.timer);
  const clients = useStore((s) => s.ws.clients);
  const oaTasks = useStore((s) => s.ws.settings.openAirTasks);
  const today = todayIso();
  const { isCollapsed, toggle } = useCollapsed();
  const [editing, setEditing] = useState<string | null>(null);
  const [moving, setMoving] = useState<Group | null>(null);

  const names = (g: Group): [string, string, string] => [clientName(clients, g.clientId), openAirName(oaTasks, g.openAirTaskId), findDeliverable(clients, g.deliverableId)?.deliverable.title ?? ''];
  const weeks = groupEntries(entries, names);

  if (entries.length === 0) {
    return <div className="time-empty"><Icon name="clock" size={22} /><p><b>Start your first timer</b></p><p className="muted">Pick a client and press Start, or use ▶ on a deliverable.</p></div>;
  }
  return (
    <div className="entries">
      {weeks.map((w) => (
        <section key={w.start} className="te-week">
          <button className="te-week-head" onClick={() => toggle(`w:${w.start}`, false)} aria-expanded={!isCollapsed(`w:${w.start}`, false)}>
            <Icon name={isCollapsed(`w:${w.start}`, false) ? 'chevronRight' : 'chevronDown'} size={13} />
            <span>{weekTitle(w.start, today)}</span><span className="te-total">{formatTotal(w.ms)}</span>
          </button>
          {!isCollapsed(`w:${w.start}`, false) && w.days.map((d) => (
            <div key={d.day} className={`te-day${d.day === today ? ' today' : ''}`}>
              <button className="te-day-head" onClick={() => toggle(`d:${d.day}`, false)} aria-expanded={!isCollapsed(`d:${d.day}`, false)}>
                <Icon name={isCollapsed(`d:${d.day}`, false) ? 'chevronRight' : 'chevronDown'} size={12} />
                <span>{d.day === today ? 'Today · ' : d.day === addDays(today, -1) ? 'Yesterday · ' : ''}{formatDue(d.day, today)}</span>
                <span className="te-total">{formatTotal(d.ms)}</span>
              </button>
              {!isCollapsed(`d:${d.day}`, false) && d.groups.map((g) => {
                const key = `g:${d.day}:${g.key}`;
                const open = !isCollapsed(key, true);
                const client = clients.find((c) => c.id === g.clientId);
                const deliv = findDeliverable(clients, g.deliverableId)?.deliverable;
                const running = !!timer && timer.clientId === g.clientId && timer.deliverableId === g.deliverableId && timer.openAirTaskId === g.openAirTaskId;
                return (
                  <div key={g.key} className="te-group">
                    <div className="te-group-row">
                      <button className="te-group-toggle" onClick={() => toggle(key, true)} aria-expanded={open}>
                        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
                        {client ? <ClientLogo client={client} size={16} /> : <span className="tp-dot" />}
                        <span className="te-client">{clientName(clients, g.clientId)}</span>
                        <span className="te-deliv">{g.deliverableId ? deliv?.title ?? 'Unnamed task' : '—'}</span>
                        <span className="te-oa">{openAirName(oaTasks, g.openAirTaskId)}</span>
                        <span className="te-total">{formatTotal(g.ms)}</span>
                      </button>
                      {running
                        ? <button className="icon-btn" aria-label="Stop timer" title="Stop" onClick={() => time.stop()}><Icon name="stop" size={12} /></button>
                        : <button className="icon-btn" aria-label="Start a timer on this" title="Start a timer on this" onClick={() => time.start({ clientId: g.clientId, deliverableId: g.deliverableId, openAirTaskId: g.openAirTaskId })}><Icon name="play" size={12} /></button>}
                      <button className="icon-btn" aria-label="Move these entries" title="Move all these entries to another client or deliverable" onClick={() => setMoving(g)}><Icon name="inbox" size={13} /></button>
                    </div>
                    {open && g.entries.map((e) => (
                      <div key={e.id} className="te-entry">
                        <span className="te-times">{formatTimeOfDay(e.startISO)} – {formatTimeOfDay(e.endISO)}</span>
                        <span className="te-dur">{formatTotal(durationMs(e))}</span>
                        <NoteField id={e.id} value={e.note} />
                        <button className="icon-btn" aria-label="Resume" title="Resume (start a new timer like this)" onClick={() => time.resume(e.id)}><Icon name="play" size={12} /></button>
                        <button className="icon-btn" aria-label="Reassign or edit date and times" title="Reassign or edit date and times" onClick={() => setEditing(e.id)}><Icon name="clock" size={13} /></button>
                        <button className="icon-btn" aria-label="Duplicate" title="Duplicate" onClick={() => time.duplicate(e.id)}><Icon name="plus" size={13} /></button>
                        <DeleteEntry id={e.id} />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </section>
      ))}
      {editing && <EditEntry entryId={editing} onClose={() => setEditing(null)} />}
      {moving && <MoveGroup group={moving} onClose={() => setMoving(null)} />}
    </div>
  );
}

/** Inline note: saves when you leave the field, with a green "Saved". */
function NoteField({ id, value }: { id: string; value: string }) {
  const [text, setText] = useState(value);
  const [saved, setSaved] = useState(false);
  useEffect(() => setText(value), [value]);
  return (
    <span className="te-note-wrap">
      <input className="te-note" value={text} placeholder="Add a note" aria-label="Note"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        onBlur={() => { if (text !== value) { time.update(id, { note: text }); setSaved(true); setTimeout(() => setSaved(false), 1500); } }} />
      {saved && <span className="saved-tag">Saved</span>}
    </span>
  );
}

/** Two clicks, then a confirmation. */
function DeleteEntry({ id }: { id: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <button className={`icon-btn two-step${armed ? ' armed' : ''}`} aria-label={armed ? 'Click again to delete' : 'Delete entry'} title={armed ? 'Click again to delete' : 'Delete'}
      onClick={async () => {
        if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 2000); return; }
        setArmed(false);
        if (await confirmDialog({ title: 'Delete this time entry?', message: "This can't be undone.", confirmLabel: 'Delete', danger: true })) time.remove(id);
      }}>
      <Icon name={armed ? 'trash' : 'x'} size={12} />
    </button>
  );
}

function MoveGroup({ group, onClose }: { group: Group; onClose: () => void }) {
  const [t, setT] = useState({ clientId: group.clientId, deliverableId: group.deliverableId, openAirTaskId: group.openAirTaskId });
  return (
    <EditTargetModal title={`Move ${group.entries.length} entr${group.entries.length === 1 ? 'y' : 'ies'}`} target={t} setTarget={setT} onClose={onClose}
      onSave={() => { time.moveMany(group.entries.map((e) => e.id), t); onClose(); }} />
  );
}

function EditTargetModal({ title, target, setTarget, onClose, onSave }: {
  title: string; target: { clientId: string | null; deliverableId: string | null; openAirTaskId: string | null };
  setTarget: (fn: (t: typeof target) => typeof target) => void; onClose: () => void; onSave: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose} width={400}>
      <form className="form edit-entry" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
        <TargetSelects {...target} onChange={(p) => setTarget((x) => ({ ...x, ...p }))} />
        <div className="form-actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" className="btn btn-primary">Move</button></div>
      </form>
    </Modal>
  );
}

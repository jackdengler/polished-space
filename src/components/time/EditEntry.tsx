import { useState } from 'react';
import { formatDue, todayIso } from '../../model/dates';
import { parseFlexDate } from '../../model/flexDate';
import { atMinutes, durationMs, formatTimeOfDay, formatTotal, localDay, parseTimeOfDay, type TimeEntry } from '../../time/model';
import { time, useTime } from '../../time/store';
import { Modal } from '../Modal';
import { TargetSelects } from './TimeFields';

/**
 * Edit a past entry, add a new one by hand, or reassign the running timer.
 * Times are typed ("9", "9:30 PM", "14:30"); a bare hour is read relative to the other time.
 */
export function EditEntry({ entryId, isTimer, onClose }: { entryId?: string; isTimer?: boolean; onClose: () => void }) {
  const entry = useTime((s) => s.entries.find((e) => e.id === entryId));
  const timer = useTime((s) => s.timer);
  const now = new Date().toISOString();
  const base: Omit<TimeEntry, 'id'> = isTimer && timer
    ? { clientId: timer.clientId, deliverableId: timer.deliverableId, openAirTaskId: timer.openAirTaskId, note: timer.note, startISO: timer.startedAtISO, endISO: now, dayKey: localDay(timer.startedAtISO) }
    : entry ?? { clientId: null, deliverableId: null, openAirTaskId: null, note: '', startISO: atMinutes(todayIso(), 9 * 60), endISO: atMinutes(todayIso(), 10 * 60), dayKey: todayIso() };

  const [target, setTarget] = useState({ clientId: base.clientId, deliverableId: base.deliverableId, openAirTaskId: base.openAirTaskId });
  const [note, setNote] = useState(base.note);
  const [dayText, setDayText] = useState(formatDue(base.dayKey));
  const [startText, setStartText] = useState(formatTimeOfDay(base.startISO));
  const [endText, setEndText] = useState(formatTimeOfDay(base.endISO));
  const [error, setError] = useState<string | null>(null);

  const day = (() => { const p = parseFlexDate(dayText); return p?.kind === 'exact' ? p.date : null; })();
  const startMin = parseTimeOfDay(startText, 'start', parseTimeOfDay(endText, 'end', null));
  const endMin = startMin === null ? null : parseTimeOfDay(endText, 'end', startMin);

  function save() {
    if (!day) return setError('Enter a date like 11/12 or Fri.');
    if (startMin === null) return setError('Enter a start time like 9, 9:30 AM or 14:30.');
    const startISO = atMinutes(day, startMin);
    if (isTimer) {
      if (Date.parse(startISO) > Date.now()) return setError("The timer can't start in the future.");
      time.retarget(target);
      time.retarget({ note });
      time.setTimerStart(startISO);
      return onClose();
    }
    let endISO = endMin === null ? null : atMinutes(day, endMin);
    // End before start keeps the original length from the new start.
    if (!endISO || Date.parse(endISO) <= Date.parse(startISO)) endISO = new Date(Date.parse(startISO) + (durationMs(base) || 3_600_000)).toISOString();
    const patch = { ...target, note, startISO, endISO, dayKey: localDay(startISO) };
    if (entry) time.update(entry.id, patch); else time.add(patch);
    onClose();
  }

  const preview = day && startMin !== null && !isTimer && endMin !== null ? formatTotal((endMin - startMin) * 60000) : null;
  return (
    <Modal title={isTimer ? 'Edit running timer' : entry ? 'Reassign or edit times' : 'Add time'} onClose={onClose} width={420}>
      <form className="form edit-entry" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <TargetSelects {...target} onChange={(p) => setTarget((t) => ({ ...t, ...p }))} />
        <label className="field-label" htmlFor="te-note">Note</label>
        <input id="te-note" className="text-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What were you working on?" />
        <div className="time-row">
          <div><label className="field-label" htmlFor="te-day">Date</label>
            <input id="te-day" className="text-input" value={dayText} onChange={(e) => setDayText(e.target.value)} /></div>
          <div><label className="field-label" htmlFor="te-start">Start</label>
            <input id="te-start" className="text-input" value={startText} onChange={(e) => setStartText(e.target.value)} /></div>
          {!isTimer && <div><label className="field-label" htmlFor="te-end">End</label>
            <input id="te-end" className="text-input" value={endText} onChange={(e) => setEndText(e.target.value)} /></div>}
        </div>
        <div className="flex-preview">{day ? formatDue(day) : 'Not a date'}{startMin !== null ? ` · ${formatTimeOfDay(atMinutes(day ?? todayIso(), startMin))}` : ''}{!isTimer && endMin !== null && day ? ` – ${formatTimeOfDay(atMinutes(day, endMin))}` : ''}{preview ? ` · ${preview}` : ''}{isTimer ? ' · keeps running' : ''}</div>
        {error && <p className="welcome-error" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary">{entry || isTimer ? 'Save' : 'Add time'}</button>
        </div>
      </form>
    </Modal>
  );
}

import { useRef, useState, type ReactNode } from 'react';
import { formatDue, todayIso } from '../model/dates';
import { parseFlexDate } from '../model/flexDate';
import { Popover } from './Popover';

/**
 * A date chip that opens a small box where you can either type the date
 * ("11/12", "Mar 3" — the year snaps to the next occurrence) and press Enter,
 * or pick it from the calendar. Works the same in hosted pages, where the
 * browser's own picker can be blocked.
 */
export function DatePickButton({ value, onChange, children, className, label, title, id }: {
  value: string | null; onChange: (iso: string | null) => void; children: ReactNode;
  className?: string; label: string; title?: string; id: string;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <span className="due-wrap">
      <button ref={button} className={className} onClick={(e) => { e.stopPropagation(); setOpen(true); }} aria-label={label} title={title}>
        {children}
      </button>
      <Popover anchor={button} open={open} onClose={() => setOpen(false)} width={244}>
        {open && <DateBox id={id} label={label} value={value} onChange={onChange} onDone={() => setOpen(false)} />}
      </Popover>
    </span>
  );
}

function DateBox({ id, label, value, onChange, onDone }: {
  id: string; label: string; value: string | null; onChange: (iso: string | null) => void; onDone: () => void;
}) {
  const [text, setText] = useState('');
  const today = todayIso();
  const parsed = text.trim() ? parseFlexDate(text, today) : null;
  const exact = parsed?.kind === 'exact' ? parsed.date : null;
  const hint = !text.trim() ? 'Type 11/12, Fri, Mar 3, or pick below'
    : exact ? formatDue(exact, today)
    : parsed ? 'Pick a specific day' : 'Not a date';
  const save = (iso: string | null) => { onChange(iso); onDone(); };
  return (
    <div className="form date-box" data-no-dnd>
      <label className="field-label" htmlFor={`date-text-${id}`}>{label.replace(/\. Change$/, '')}</label>
      <input id={`date-text-${id}`} className="text-input" autoFocus value={text} placeholder={value ? formatDue(value, today) : 'e.g. 11/12'}
        aria-label="Type a date" onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (exact) save(exact); else if (!text.trim()) onDone(); }
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone(); }
        }} />
      <div className={`flex-preview${text.trim() && !exact ? ' invalid' : ''}`}>{hint}</div>
      <input type="date" className="text-input" value={value ?? ''} aria-label="Pick a date" onChange={(e) => e.target.value && save(e.target.value)} />
      <div className="form-actions">
        {value && <button className="btn btn-sm" onClick={() => save(null)}>Clear</button>}
        <button className="btn btn-sm btn-primary" onClick={() => (exact ? save(exact) : onDone())}>{exact ? 'Set date' : 'Done'}</button>
      </div>
    </div>
  );
}

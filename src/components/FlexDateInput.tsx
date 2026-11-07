import { useState } from 'react';
import { formatLong } from '../model/dates';
import { FLEX_HINT, flexToInput, formatFlex, parseFlexDate, type FlexDate } from '../model/flexDate';

function describe(f: FlexDate) {
  return f.kind === 'exact' ? formatLong(f.date) : `${f.label} · ${formatLong(f.start)} – ${formatLong(f.end)}`;
}

/** Free-text date field accepting exact dates or periods, with a live preview of how it was understood. */
export function FlexDateField({ value, onChange, autoFocus, onEnter, placeholder = 'Date' }: {
  value: string; onChange: (text: string) => void; autoFocus?: boolean; onEnter?: () => void; placeholder?: string;
}) {
  const parsed = parseFlexDate(value);
  return (
    <div className="flex-field">
      <input className="text-input" value={value} autoFocus={autoFocus} placeholder={placeholder} aria-label={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter?.(); } }} />
      <div className={`flex-preview${value && !parsed ? ' invalid' : ''}`}>
        {!value ? FLEX_HINT : parsed ? describe(parsed) : `Not recognized — ${FLEX_HINT}`}
      </div>
    </div>
  );
}

/** Shows a FlexDate; click to edit it in place. */
export function FlexDateInput({ value, onChange, placeholder = 'Set date', allowClear = false, className = '', label }: {
  value: FlexDate | null; onChange: (v: FlexDate | null) => void; placeholder?: string; allowClear?: boolean; className?: string; label?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  if (draft === null) {
    return (
      <button className={`flex-date ${className}${value ? '' : ' placeholder'}`} aria-label={label ? `Edit ${label}` : undefined}
        title={value ? describe(value) : undefined} onClick={(e) => { e.stopPropagation(); setDraft(value ? flexToInput(value) : ''); }}>
        {value ? formatFlex(value) : placeholder}
      </button>
    );
  }

  const parsed = parseFlexDate(draft);
  const commit = () => {
    if (parsed) onChange(parsed);
    else if (!draft.trim() && allowClear) onChange(null);
    else if (draft.trim()) return; // keep editing so the user can fix it
    setDraft(null);
  };
  return (
    <span className="flex-edit" onBlur={(e) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) { if (parsed) onChange(parsed); else if (!draft.trim() && allowClear) onChange(null); setDraft(null); }
    }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setDraft(null); } }}>
      <FlexDateField value={draft} onChange={setDraft} autoFocus onEnter={commit} placeholder={label ?? 'Date'} />
    </span>
  );
}

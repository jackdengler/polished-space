import { useState, type KeyboardEvent } from 'react';

/** Text that turns into an input on click. Enter or blur saves, Esc cancels. Empty input reverts. */
export function InlineEdit({ value, onCommit, placeholder = 'Untitled', className = '', label }: {
  value: string; onCommit: (v: string) => void; placeholder?: string; className?: string; label?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  if (draft === null) {
    return (
      <span className={`inline-edit ${className}${value ? '' : ' placeholder'}`} role="button" tabIndex={0} aria-label={label ? `Edit ${label}` : undefined} title={value || undefined}
        onClick={(e) => { e.stopPropagation(); setDraft(value); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setDraft(value); } }}>
        {value || placeholder}
      </span>
    );
  }

  const commit = () => {
    const v = draft.trim();
    setDraft(null);
    if (v && v !== value) onCommit(v);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDraft(null); }
  };
  return (
    <input className={`inline-input ${className}`} autoFocus value={draft} aria-label={label} placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={onKey} onFocus={(e) => e.target.select()} />
  );
}

/** An input for adding items one after another: Enter adds and stays open; Esc or blurring empty closes. */
export function AddInput({ placeholder, onAdd, onDone, className = '' }: {
  placeholder: string; onAdd: (v: string) => void; onDone: () => void; className?: string;
}) {
  const [text, setText] = useState('');
  const add = () => { const v = text.trim(); if (v) { onAdd(v); setText(''); return true; } return false; };
  return (
    <input className={`add-input ${className}`} autoFocus value={text} placeholder={placeholder} aria-label={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { add(); onDone(); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); if (!add()) onDone(); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onDone(); }
      }} />
  );
}

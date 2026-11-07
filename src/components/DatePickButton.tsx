import { useRef, useState, type ReactNode } from 'react';
import { Popover } from './Popover';

/**
 * A button that opens the browser's date picker. Where the native picker is
 * blocked (some embedded pages), it falls back to a small popover.
 */
export function DatePickButton({ value, onChange, children, className, label, title, id }: {
  value: string | null; onChange: (iso: string | null) => void; children: ReactNode;
  className?: string; label: string; title?: string; id: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [fallback, setFallback] = useState(false);
  const open = () => {
    try { input.current!.showPicker(); } catch { setFallback(true); }
  };
  return (
    <span className="due-wrap">
      <button ref={button} className={className} onClick={(e) => { e.stopPropagation(); open(); }} aria-label={label} title={title}>
        {children}
      </button>
      <input ref={input} type="date" className="hidden-date" tabIndex={-1} aria-hidden="true" value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)} />
      <Popover anchor={button} open={fallback} onClose={() => setFallback(false)} width={220}>
        <div className="form">
          <label className="field-label" htmlFor={`date-${id}`}>{label}</label>
          <input id={`date-${id}`} type="date" className="text-input" autoFocus value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />
          <div className="form-actions">
            {value && <button className="btn btn-sm" onClick={() => { onChange(null); setFallback(false); }}>Clear</button>}
            <button className="btn btn-sm btn-primary" onClick={() => setFallback(false)}>Done</button>
          </div>
        </div>
      </Popover>
    </span>
  );
}

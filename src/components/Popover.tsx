import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

/** A floating panel anchored under (or above) an element. Closes on outside click or Esc. */
export function Popover({ anchor, open, onClose, children, width, align = 'start' }: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  align?: 'start' | 'end';
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const p = panel.current?.getBoundingClientRect();
      if (!a) return;
      const w = p?.width ?? width ?? 240;
      const h = p?.height ?? 200;
      let left = align === 'end' ? a.right - w : a.left;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      let top = a.bottom + 6;
      if (top + h > window.innerHeight - 8 && a.top - h - 6 > 8) top = a.top - h - 6;
      setPos({ top, left });
    };
    place();
    const raf = requestAnimationFrame(place); // re-place once the panel has its real size
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, anchor, width, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey, true); };
  }, [open, onClose, anchor]);

  if (!open) return null;
  return createPortal(
    <div ref={panel} className="popover" data-no-dnd style={{ width, top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}>
      {children}
    </div>,
    document.body,
  );
}

/** A "⋯" style menu. */
export interface MenuItem {
  label: string; onSelect: () => void; danger?: boolean; hidden?: boolean;
  /** Small deletes: the first click arms it ("Click again to delete"), a second within 2s does it. */
  twoStep?: boolean;
}

export function Menu({ items, button, label = 'More actions', className = 'icon-btn' }: {
  items: MenuItem[]; button: ReactNode; label?: string; className?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const close = () => { setOpen(false); setArmed(null); clearTimeout(timer.current); };
  const pick = (i: MenuItem) => {
    if (i.twoStep && armed !== i.label) {
      setArmed(i.label);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setArmed(null), 2000);
      return;
    }
    close();
    i.onSelect();
  };
  return (
    <>
      <button ref={ref} className={className} aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>
        {button}
      </button>
      <Popover anchor={ref} open={open} onClose={close} width={190} align="end">
        <div role="menu" className="menu">
          {items.filter((i) => !i.hidden).map((i) => (
            <button key={i.label} role="menuitem" className={`menu-item${i.danger ? ' danger' : ''}${armed === i.label ? ' armed' : ''}`}
              onClick={() => pick(i)}>
              {armed === i.label ? <><Icon name="trash" size={13} /> Click again to delete</> : i.label}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

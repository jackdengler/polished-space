import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';

export function Modal({ title, onClose, children, width = 440 }: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={{ width }}>
        <h2 className="modal-title">{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmRequest { title: string; message?: string; confirmLabel?: string; danger?: boolean; resolve: (ok: boolean) => void }
const useConfirm = create<{ req: ConfirmRequest | null }>(() => ({ req: null }));

/** Promise-based confirm dialog: `if (await confirmDialog({...})) …` */
export function confirmDialog(opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => useConfirm.setState({ req: { ...opts, resolve } }));
}

export function ConfirmHost() {
  const req = useConfirm((s) => s.req);
  if (!req) return null;
  const done = (ok: boolean) => { useConfirm.setState({ req: null }); req.resolve(ok); };
  return (
    <Modal title={req.title} onClose={() => done(false)} width={400}>
      {req.message && <p className="modal-text">{req.message}</p>}
      <div className="modal-actions">
        <button className="btn" onClick={() => done(false)}>Cancel</button>
        <button className={`btn ${req.danger ? 'btn-danger' : 'btn-primary'}`} autoFocus onClick={() => done(true)}>
          {req.confirmLabel ?? 'OK'}
        </button>
      </div>
    </Modal>
  );
}

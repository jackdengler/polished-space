import { usePersistence } from '../storage/persistence';

export function SaveStatus() {
  const { status, adapter, error } = usePersistence();
  if (adapter?.kind === 'memory') return <span className="save-status" title="Demo changes are not saved">Not saved (demo)</span>;
  const text = { saved: 'Saved', pending: 'Saving…', saving: 'Saving…', error: 'Save failed', conflict: 'Needs attention' }[status];
  return <span className={`save-status ${status}`} title={error ?? undefined} role="status">{text}</span>;
}

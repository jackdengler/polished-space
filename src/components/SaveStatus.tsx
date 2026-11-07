import { usePersistence } from '../storage/persistence';

export function SaveStatus() {
  const { status, error } = usePersistence();
  const text = { saved: 'Saved', pending: 'Saving…', saving: 'Saving…', error: 'Save failed', conflict: 'Needs attention' }[status];
  return <span className={`save-status ${status}`} title={error ?? text} role="status"><span className="dot" />{text}</span>;
}

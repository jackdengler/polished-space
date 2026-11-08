import { useEffect, useState } from 'react';
import { useStore } from '../../store/store';
import { clientName, findDeliverable } from '../../time/lookup';
import { formatClock } from '../../time/model';
import { time, useTime } from '../../time/store';
import { ClientLogo } from '../Avatar';
import { Icon } from '../Icon';
import { EditEntry } from './EditEntry';

/** Ticks on the real second boundary so the clock never skips a second. */
export function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => { setNow(Date.now()); t = setTimeout(tick, 1000 - (Date.now() % 1000) + 5); };
    tick();
    return () => clearTimeout(t);
  }, [active]);
  return now;
}

/** Top-bar timer: what you're on + live clock + Stop; ▶ starts an empty timer to fill in later. */
export function TimerPill() {
  const timer = useTime((s) => s.timer);
  const status = useTime((s) => s.status);
  const clients = useStore((s) => s.ws.clients);
  const [editing, setEditing] = useState(false);
  const now = useNow(!!timer);
  if (status !== 'ready') return null;
  if (!timer) {
    return <button className="icon-btn timer-start" onClick={() => time.start()} aria-label="Start a timer" title="Start a timer (fill in the details later)"><Icon name="play" size={14} /></button>;
  }
  const client = clients.find((c) => c.id === timer.clientId);
  const deliv = findDeliverable(clients, timer.deliverableId)?.deliverable;
  const label = deliv?.title ?? (timer.clientId ? clientName(clients, timer.clientId) : 'No client yet');
  return (
    <span className="timer-pill" role="timer">
      <button className="tp-main" onClick={() => setEditing(true)} title="Edit what this timer is on">
        {client ? <ClientLogo client={client} size={16} /> : <span className="tp-dot" />}
        <span className="tp-label">{label}</span>
        <span className="tp-clock">{formatClock(now - Date.parse(timer.startedAtISO))}</span>
      </button>
      <button className="tp-stop" onClick={() => time.stop()} aria-label="Stop timer" title="Stop and save"><Icon name="stop" size={12} /></button>
      {editing && <EditEntry isTimer onClose={() => setEditing(false)} />}
    </span>
  );
}

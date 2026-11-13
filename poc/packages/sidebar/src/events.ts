import { BRAIN_SSE_EVENTS, PATHS } from '@poc/contracts';
import { api, checked } from './api';
import { useUi } from './store';

/**
 * Keeps the sidebar in sync with the brain: one `GET /api/state` on connect,
 * then `GET /api/events` (SSE) for `state` snapshots and `nudge` events.
 * Shows "connection lost" while the stream is down and keeps retrying.
 */
export function connectBrain(): () => void {
  let es: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let delay = 1000;
  const ui = () => useUi.getState();

  const refresh = async () => {
    try {
      ui().setState(await api.state());
    } catch {
      /* the stream's own error handling reports the outage */
    }
  };

  const open = () => {
    if (stopped) return;
    es = new EventSource(PATHS.brain.events);
    es.onopen = () => {
      delay = 1000;
      ui().setConnection('live');
      void refresh();
    };
    es.addEventListener('state', (ev) => {
      try {
        ui().setState(checked(BRAIN_SSE_EVENTS.state, JSON.parse((ev as MessageEvent<string>).data), 'state event'));
        ui().setConnection('live');
      } catch {
        /* ignore a malformed frame; the next snapshot replaces it */
      }
    });
    es.addEventListener('nudge', (ev) => {
      try {
        ui().addNudge(checked(BRAIN_SSE_EVENTS.nudge, JSON.parse((ev as MessageEvent<string>).data), 'nudge event'));
      } catch {
        /* ignore */
      }
    });
    es.onerror = () => {
      ui().setConnection('lost');
      // EventSource retries by itself unless the server refused outright.
      if (es && es.readyState === EventSource.CLOSED) {
        es = null;
        retry = setTimeout(open, delay);
        delay = Math.min(delay * 2, 10000);
      }
    };
  };

  void refresh();
  open();
  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    es?.close();
  };
}

/** Manual "Try again" from the connection-lost banner. */
export async function reconnectNow(): Promise<void> {
  try {
    useUi.getState().setState(await api.state());
  } catch {
    /* still down */
  }
}

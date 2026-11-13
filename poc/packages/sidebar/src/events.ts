import { BRAIN_SSE_EVENTS, HEARTBEAT_TIMEOUT_MS, PATHS } from '@poc/contracts';
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
  let lastHeard = Date.now();
  const ui = () => useUi.getState();
  const heard = () => {
    lastHeard = Date.now();
    if (ui().connection !== 'live') ui().setConnection('live');
  };
  // The brain sends a heartbeat every few seconds. A stream that stays open but goes silent
  // (a proxy holding it while the brain is gone) is a lost connection too (D2): reopen it.
  const watchdog = setInterval(() => {
    if (stopped || !es || Date.now() - lastHeard < HEARTBEAT_TIMEOUT_MS) return;
    ui().setConnection('lost');
    es.close();
    es = null;
    if (!retry) retry = setTimeout(() => ((retry = null), open()), delay);
    delay = Math.min(delay * 2, 10000);
    lastHeard = Date.now(); // wait a full timeout before the next try
  }, 1000);

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
    lastHeard = Date.now();
    es.onopen = () => {
      delay = 1000;
      // "live" only once the brain itself speaks (state or heartbeat), not when a proxy accepts the stream.
      void refresh();
    };
    es.addEventListener('heartbeat', heard);
    es.addEventListener('state', (ev) => {
      try {
        ui().setState(checked(BRAIN_SSE_EVENTS.state, JSON.parse((ev as MessageEvent<string>).data), 'state event'));
        heard();
      } catch {
        /* ignore a malformed frame; the next snapshot replaces it */
      }
    });
    es.addEventListener('nudge', (ev) => {
      try {
        ui().addNudge(checked(BRAIN_SSE_EVENTS.nudge, JSON.parse((ev as MessageEvent<string>).data), 'nudge event'));
        heard();
      } catch {
        /* ignore */
      }
    });
    es.onerror = () => {
      ui().setConnection('lost');
      // EventSource retries by itself unless the server refused outright.
      if (es && es.readyState === EventSource.CLOSED) {
        es = null;
        if (!retry) retry = setTimeout(() => ((retry = null), open()), delay);
        delay = Math.min(delay * 2, 10000);
      }
    };
  };

  void refresh();
  open();
  return () => {
    stopped = true;
    clearInterval(watchdog);
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

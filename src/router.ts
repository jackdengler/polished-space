import { useSyncExternalStore } from 'react';

/** URL shape: #/c/<clientId>[/m/<meetingId> | /adhoc][?t=<taskId>] — so pages can be bookmarked. */
export interface Route { clientId: string | null; boardId: string | null; taskId: string | null }

function parse(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const taskId = new URLSearchParams(query).get('t');
  if (parts[0] !== 'c' || !parts[1]) return { clientId: null, boardId: null, taskId: null };
  const boardId = parts[2] === 'adhoc' ? 'adhoc' : parts[2] === 'm' && parts[3] ? parts[3] : null;
  return { clientId: parts[1], boardId, taskId };
}

export function routeHref(r: Partial<Route>): string {
  if (!r.clientId) return '#/';
  let h = `#/c/${encodeURIComponent(r.clientId)}`;
  if (r.boardId === 'adhoc') h += '/adhoc';
  else if (r.boardId) h += `/m/${encodeURIComponent(r.boardId)}`;
  if (r.taskId) h += `?t=${encodeURIComponent(r.taskId)}`;
  return h;
}

// The current route lives in memory and is mirrored to the address bar when the
// browser allows it (embedded previews may not), so navigation always works.
let current = location.hash;
let cached: { hash: string; route: Route } | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function navigate(r: Partial<Route>, opts: { replace?: boolean } = {}) {
  const href = routeHref(r);
  if (current === href) return;
  current = href;
  try {
    if (opts.replace) history.replaceState(null, '', href);
    else history.pushState(null, '', href);
  } catch { /* address bar not available — in-memory routing still works */ }
  notify();
}

function snapshot(): Route {
  if (!cached || cached.hash !== current) cached = { hash: current, route: parse(current) };
  return cached.route;
}

function onBrowserNav() {
  if (location.hash !== current) { current = location.hash; notify(); }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (listeners.size === 1) {
    window.addEventListener('hashchange', onBrowserNav);
    window.addEventListener('popstate', onBrowserNav);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) {
      window.removeEventListener('hashchange', onBrowserNav);
      window.removeEventListener('popstate', onBrowserNav);
    }
  };
}

export const useRoute = () => useSyncExternalStore(subscribe, snapshot);

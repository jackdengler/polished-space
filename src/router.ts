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

export function navigate(r: Partial<Route>, opts: { replace?: boolean } = {}) {
  const href = routeHref(r);
  if (location.hash === href) return;
  if (opts.replace) history.replaceState(null, '', href);
  else history.pushState(null, '', href);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

let cached: { hash: string; route: Route } | null = null;
function snapshot(): Route {
  if (!cached || cached.hash !== location.hash) cached = { hash: location.hash, route: parse(location.hash) };
  return cached.route;
}
function subscribe(cb: () => void) {
  window.addEventListener('hashchange', cb);
  window.addEventListener('popstate', cb);
  return () => { window.removeEventListener('hashchange', cb); window.removeEventListener('popstate', cb); };
}

export const useRoute = () => useSyncExternalStore(subscribe, snapshot);

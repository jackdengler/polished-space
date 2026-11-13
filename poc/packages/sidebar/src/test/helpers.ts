import { vi } from 'vitest';
import type { SidebarState, Suggestion } from '@poc/contracts';
import { FixtureBrain } from '../../fixture/brain';
import { useUi } from '../store';

export const NOW = new Date('2026-11-11T09:40:00Z');

/** A full contract-valid SidebarState from the fixture data. */
export function fixtureState(): SidebarState {
  return new FixtureBrain(() => NOW).state();
}

export function resetStore(state: SidebarState | null = fixtureState()): void {
  useUi.setState({ state, connection: 'live', tab: 'list', overlay: null, dismissedNudges: [], expandedNudges: [], chat: [], chatBusy: false, inFlight: {}, decisionErrors: {}, decided: {}, liveNudges: [] });
}

export interface Call {
  url: string;
  method: string;
  body: unknown;
}

/** Stub fetch: `routes` maps "METHOD /path" (or a function) to a JSON response. Records every call. */
export function stubFetch(handler: (c: Call) => unknown | Promise<unknown>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const c: Call = { url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined };
      calls.push(c);
      const out = await handler(c);
      return new Response(JSON.stringify(out ?? {}), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }),
  );
  return calls;
}

/** Answer approve/deny with the suggestion marked applied/denied. */
export function decisionHandler(state: SidebarState) {
  return (c: Call) => {
    const m = /\/api\/suggestions\/([^/]+)\/(approve|deny)$/.exec(c.url);
    if (!m) return {};
    const s = state.suggestions.find((x) => x.id === decodeURIComponent(m[1]!)) as Suggestion;
    return { suggestion: { ...s, status: m[2] === 'approve' ? 'applied' : 'denied', decidedAt: NOW.toISOString() } };
  };
}

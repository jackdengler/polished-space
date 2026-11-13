import type { Nudge, SidebarState, Suggestion } from '@poc/contracts';

export interface Arranged {
  /** Visible nudges, newest first, each with its still-open suggestions. */
  nudges: { nudge: Nudge; suggestions: Suggestion[]; total: number; inInbox: number }[];
  /** Open suggestions with no visible nudge that need a client (shown in Inbox). */
  inbox: Suggestion[];
  /** Other open suggestions with no visible nudge. */
  loose: Suggestion[];
  /** Suggestion ids that belong to a task's prepared work (shown in the prepared view only). */
  preparedIds: Set<string>;
}

/**
 * Decide where each open suggestion shows:
 * - a suggestion for a task's prepared work appears only in that task's
 *   prepared-work view (contract: TaskMeta.preparedSuggestionId);
 * - an uncertain client match (confirm_client, or a task with no client or
 *   a low-confidence one) goes to Inbox, even when a nudge names it (brief:
 *   "uncertain matches go to the sidebar Inbox for a quick confirmation");
 * - any other suggestion named by a visible nudge appears under that nudge;
 * - the rest in "Waiting for your OK". Kinds that need no client (calendar
 *   blocks, emails, completing or moving a task) never land in Inbox.
 */
export function needsClient(s: Suggestion): boolean {
  if (s.kind === 'confirm_client') return true;
  return s.kind === 'create_task' && (s.clientId === null || s.clientConfidence === 'low');
}

export function arrange(state: SidebarState, dismissed: readonly string[], liveNudges: readonly Nudge[] = []): Arranged {
  const preparedIds = new Set<string>();
  for (const sec of state.sections) for (const t of sec.items) if (t.preparedSuggestionId) preparedIds.add(t.preparedSuggestionId);

  const open = state.suggestions.filter((s) => (s.status === 'pending' || s.status === 'failed') && !preparedIds.has(s.id));
  const byId = new Map(open.map((s) => [s.id, s]));

  const seen = new Set<string>();
  const all: Nudge[] = [];
  for (const n of [...liveNudges, ...state.nudges]) {
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    all.push(n);
  }
  all.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

  const claimed = new Set<string>();
  const nudges: Arranged['nudges'] = [];
  for (const n of all) {
    if (dismissed.includes(n.id)) continue;
    const suggestions: Suggestion[] = [];
    let inInbox = 0;
    for (const id of n.suggestionIds) {
      const open1 = byId.get(id);
      if (open1 && needsClient(open1)) inInbox++;
      const s = byId.get(id);
      if (s && !claimed.has(id) && !needsClient(s)) {
        suggestions.push(s);
        claimed.add(id);
      }
    }
    nudges.push({ nudge: n, suggestions, total: n.suggestionIds.length, inInbox });
  }

  const inbox: Suggestion[] = [];
  const loose: Suggestion[] = [];
  for (const s of open) {
    if (claimed.has(s.id)) continue;
    if (needsClient(s)) inbox.push(s);
    else loose.push(s);
  }
  return { nudges, inbox, loose, preparedIds };
}

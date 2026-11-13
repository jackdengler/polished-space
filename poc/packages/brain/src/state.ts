/**
 * Builds the SidebarState from list_tasks + the TaskMeta overlay, using the
 * contract's `sectionKeyFor` / `sectionKeys` so the sidebar and brain agree.
 */
import {
  SidebarState,
  sectionKeyFor,
  sectionKeys,
  sectionLabel,
  type CalEvent,
  type Nudge,
  type PmClient,
  type PmTask,
  type SidebarTask,
  type Suggestion,
  type TaskMeta,
  type UsageSummary,
} from '@poc/contracts';

export interface StateInput {
  now: Date;
  today: string;
  me: { id: string; name: string };
  internalClientId: string | null;
  clients: PmClient[];
  tasks: PmTask[];
  meta: Record<string, TaskMeta>;
  suggestions: Suggestion[];
  nudges: Nudge[];
  calendarToday: CalEvent[];
  usageToday: UsageSummary;
}

export function toSidebarTask(t: PmTask, m: TaskMeta | undefined, inToday: boolean): SidebarTask {
  return {
    taskId: t.id,
    title: t.title,
    clientId: t.clientId,
    clientName: t.clientName,
    dueDate: t.dueDate,
    done: t.done,
    assigneeIds: t.assigneeIds,
    taskType: m?.taskType ?? null,
    direction: m?.direction ?? null,
    onHold: m?.onHold ?? false,
    order: inToday ? (m?.order ?? null) : null,
    quickWin: m?.quickWin ?? false,
    reason: m?.reason ? m.reason : null,
    source: m?.source ?? null,
    preparedStatus: m?.preparedStatus ?? 'none',
    preparedSuggestionId: m?.preparedSuggestionId ?? null,
  };
}

export function buildState(i: StateInput): SidebarState {
  const keys = sectionKeys(i.today);
  const buckets = new Map<string, SidebarTask[]>(keys.map((k) => [k, []]));
  for (const t of i.tasks) {
    if (t.done) continue;
    const m = i.meta[t.id];
    const key = sectionKeyFor({ dueDate: t.dueDate, onHold: m?.onHold ?? false, clientId: t.clientId }, i.today, i.internalClientId);
    const list = buckets.get(key);
    // sectionKeyFor and sectionKeys come from the same contract, so every key has a bucket.
    if (list) list.push(toSidebarTask(t, m, key === 'today'));
  }
  const byDateTitle = (a: SidebarTask, b: SidebarTask) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.title.localeCompare(b.title);
  const byOrder = (a: SidebarTask, b: SidebarTask) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title);
  const sections = keys.map((key) => {
    const items = buckets.get(key)!;
    items.sort(key === 'today' ? byOrder : byDateTitle);
    return { key, label: sectionLabel(key), items };
  });
  const suggestions = i.suggestions
    .filter((s) => s.status === 'pending' || s.status === 'failed')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return SidebarState.parse({
    now: i.now.toISOString(),
    today: i.today,
    me: i.me,
    clients: i.clients.filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name })),
    sections,
    suggestions,
    nudges: i.nudges.slice(0, 20),
    calendarToday: i.calendarToday,
    usageToday: i.usageToday,
  });
}

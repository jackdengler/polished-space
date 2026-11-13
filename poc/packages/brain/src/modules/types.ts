/**
 * The module API: how the Phase 2 features (prioritise + calendar, prepare,
 * profiles, chat + voice) plug into the brain without editing core files.
 * See src/MODULES.md for who implements what.
 *
 * Safety rule built into these types: a module never receives a connector
 * that can write. It reads through `ctx.read`, proposes through
 * `ctx.suggestions.add`, and its only path to a write is an executor that the
 * approve endpoint calls for a suggestion the user approved.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import type { CalEvent, ChatMessage, MailMessage, Nudge, PmClient, PmTask, SidebarState, SourceRef, Suggestion, SuggestionKind, TaskMeta } from '@poc/contracts';
import type { Claude } from '../claude';
import type { BrainConfig, Clock } from '../config';
import type { Connectors, ReadConnectors } from '../guard';
import type { Candidate } from '../intake/prematch';
import type { TriageItem, TriageOutput } from '../intake/triage';
import type { ProfileFiles } from '../profileFiles';
import type { NewNudge } from '../store/nudges';
import type { NewSuggestion } from '../store/suggestions';
import type { TaskMetaPatch } from '../store/taskMeta';

// ---- HTTP ------------------------------------------------------------------

export interface RouteRequest {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  /** Path parameters from the pattern, e.g. `{ id }` for `/api/tasks/:id/prepared` (decoded). */
  params: Record<string, string>;
  /** Parsed JSON body ({} when empty). Rejects with HttpProblem(400) on bad JSON. */
  body(): Promise<unknown>;
}
export type RouteHandler = (r: RouteRequest) => void | Promise<void>;
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
/** Handles an HTTP upgrade (WebSocket) on an exact path. */
export type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => void;

// ---- executing approved suggestions -----------------------------------------

export interface ApplyResult {
  /** Planr tasks created or changed by the action. */
  taskIds?: string[];
  /** Short human note, logged. */
  detail?: string;
  /** Set when the task list changed (core then emits onTasksChanged and pushes state). */
  tasksChanged?: boolean;
  /** Set when the calendar changed (core then emits onCalendarChanged). */
  calendarChanged?: boolean;
}

export interface ExecContext {
  config: BrainConfig;
  /**
   * Connectors with write methods. ONLY handed to executors, which only the
   * approve path calls. Writes outside an approval throw (see guard.ts).
   */
  writes: Connectors;
  taskMeta: ModuleContext['taskMeta'];
  suggestions: ModuleContext['suggestions'];
  /** The core executor for this kind, to call through to from an override. */
  core: Executor;
}

/** Runs the action of one approved suggestion (already edited and re-validated). Throw to mark it failed. */
export type Executor = (suggestion: Suggestion, x: ExecContext) => Promise<ApplyResult>;

// ---- events ----------------------------------------------------------------

export interface MessageTriagedEvent {
  source: SourceRef;
  /** What was triaged (header/subject/body as Claude saw it). */
  item: TriageItem;
  /** The original message, for mail and chat. */
  mail?: MailMessage;
  chat?: ChatMessage;
  /** Claude's answer after code checks. `profileEdits` are for the profiles module to apply. */
  triage: TriageOutput;
  /** Suggestions stored for this item (create_task, and confirm_client when uncertain). */
  suggestions: Suggestion[];
  candidates: Candidate[];
}

export interface SuggestionAppliedEvent {
  suggestion: Suggestion;
  result: ApplyResult;
}

export interface SuggestionDecidedEvent {
  suggestion: Suggestion;
}

export interface TasksChangedEvent {
  /** My open tasks (assigned to me), as list_tasks returned them. */
  tasks: PmTask[];
  reason: 'startup' | 'approved' | 'pm_changed' | 'hold';
}

export interface CalendarChangedEvent {
  /** Events from the start of today to 14 days ahead. */
  events: CalEvent[];
}

// ---- the context a module gets ---------------------------------------------

export interface ModuleContext {
  config: BrainConfig;
  clock: Clock;
  log: (msg: string, extra?: unknown) => void;
  /** The one Claude wrapper (usage log, spend cap, stop_reason checks). Pick the call type: 'prioritise' | 'prepare' | 'chat' | 'profile'. */
  claude: Claude;
  /** Read-only connectors. No write methods exist on these. */
  read: ReadConnectors;
  /** Active clients from list_clients (cached for a few seconds). */
  clients(): Promise<PmClient[]>;
  /** Read-only profile files (re-read every call). The profiles module owns writing them. */
  profiles: ProfileFiles;
  suggestions: {
    /** Create pending suggestions (validated). The state push happens automatically. */
    add(input: NewSuggestion): Promise<Suggestion>;
    get(id: string): Suggestion | null;
    list(): Suggestion[];
    /**
     * Edit a still-pending suggestion's own fields (e.g. fill in a draft).
     * Refuses to change id, kind or status. Not a write to any outside system.
     */
    revise(id: string, fn: (s: Suggestion) => Suggestion): Promise<Suggestion>;
    /**
     * Take a pending or failed suggestion off the list because a newer one
     * replaces it (e.g. regenerated prepared work). It becomes `denied` with
     * error "Replaced by a newer version." No action runs; nothing outside
     * changes. Returns null if it was already decided another way.
     */
    retire(id: string, reason?: string): Promise<Suggestion | null>;
  };
  taskMeta: {
    get(taskId: string): TaskMeta | null;
    all(): Record<string, TaskMeta>;
    upsert(taskId: string, patch: TaskMetaPatch): Promise<TaskMeta>;
    upsertMany(entries: [string, TaskMetaPatch][]): Promise<TaskMeta[]>;
  };
  nudges: { add(n: NewNudge): Nudge; remove(match: (n: Nudge) => boolean): number; retext(id: string, text: string): void; list(): Nudge[] };
  /** Run text through the same triage as typed input (source `manual` or `voice`). */
  intake: { submitText(text: string, connector: 'manual' | 'voice'): Promise<Suggestion[]> };
  state: {
    build(): Promise<SidebarState>;
    /** Ask for a state push to the sidebar (debounced). */
    changed(): void;
  };
  /** My open tasks (assigned to me). */
  myTasks(): Promise<PmTask[]>;
  routes: { add(method: HttpMethod, pattern: string, handler: RouteHandler): void };
  upgrades: { add(path: string, handler: UpgradeHandler): void };
  executors: {
    /** Replace the core executor for one suggestion kind. At most one module may override a kind. */
    override(kind: SuggestionKind, executor: Executor): void;
  };
}

/**
 * A brain feature. Register routes, upgrades and executors in `init`. Event
 * hooks run in the background (never inside an approval), are awaited by
 * `brain.idle()` in tests, and a throw is logged, never fatal.
 */
export interface BrainModule {
  name: string;
  init?(ctx: ModuleContext): void | Promise<void>;
  /** A mail, chat, typed or spoken item was triaged and its suggestions stored. */
  onMessageTriaged?(e: MessageTriagedEvent): void | Promise<void>;
  /**
   * New pending suggestions were stored, from ANY source (intake, chat or
   * voice `propose_*`, prepared work, next steps, calendar blocks). The same
   * change notification for all of them, so e.g. Today's order never lags.
   */
  onSuggestionsAdded?(e: { suggestions: Suggestion[] }): void | Promise<void>;
  /** A suggestion was approved and its action succeeded. */
  onSuggestionApplied?(e: SuggestionAppliedEvent): void | Promise<void>;
  onSuggestionDenied?(e: SuggestionDecidedEvent): void | Promise<void>;
  /** An approved action failed (the suggestion is now `failed`, with `error`). */
  onSuggestionFailed?(e: SuggestionDecidedEvent): void | Promise<void>;
  /** My open task list changed (approval, hold, or someone edited Planr). */
  onTasksChanged?(e: TasksChangedEvent): void | Promise<void>;
  /** The calendar (today to +14 days) changed, or at startup. */
  onCalendarChanged?(e: CalendarChangedEvent): void | Promise<void>;
  /** Every intake poll (2-3 s). Keep it cheap: no Claude call unless something changed. */
  onTick?(now: Date): void | Promise<void>;
  stop?(): void | Promise<void>;
}

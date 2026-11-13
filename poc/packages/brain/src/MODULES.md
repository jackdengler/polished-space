# Brain modules (Phase 2)

Each Phase 2 builder owns **one folder** under `src/` and exports **one
`BrainModule`** from that folder's `index.ts`. `src/modules/index.ts` already
lists all four, so nobody edits it. Put any extra files (helpers, tests,
sub-folders) inside your own folder. Do not edit core files (`brain.ts`,
`approve.ts`, `executors.ts`, `guard.ts`, `claude.ts`, `models.ts`,
`intake/`, `store/`, `state.ts`, `server.ts`, `modules/`). If you need a core
change, stop and tell the lead.

| Folder | Builder | Module export | Starts as |
|---|---|---|---|
| `src/prioritise/` (+ calendar code in the same folder or `src/prioritise/calendar/`) | 2A | `prioritiseModule` | no-op |
| `src/prepare/` | 2B | `prepareModule` | `GET /api/tasks/:id/prepared`, `POST /api/tasks/:id/prepare` answer 501 |
| `src/profiles/` | 2C | `profilesModule` | `GET /api/profiles`, `GET /api/profiles/:clientId` answer 501 |
| `src/chat/` (+ voice in the same folder or `src/chat/voice/`) | 2D | `chatModule` | `POST /api/chat` answers 501, `WS /api/voice` refused with 501 |

Replace the stub routes in your own `index.ts` (same method and path).

## The API (`src/modules/types.ts`)

```ts
export const myModule: BrainModule = {
  name: 'prepare',
  init(ctx) { /* register routes, upgrades, executor overrides; keep ctx */ },
  onMessageTriaged(e) {},    // { source, item, mail?, chat?, triage, suggestions, candidates }
  onSuggestionApplied(e) {}, // { suggestion, result: { taskIds?, tasksChanged?, calendarChanged? } }
  onSuggestionDenied(e) {},  // { suggestion }
  onSuggestionFailed(e) {},  // { suggestion } (status 'failed', error set)
  onTasksChanged(e) {},      // { tasks: my open PmTask[], reason: 'startup'|'approved'|'pm_changed'|'hold' }
  onCalendarChanged(e) {},   // { events: CalEvent[] from start of today to +14 days }
  onTick(now) {},            // every intake poll (2-3 s); keep it cheap
  stop() {},
};
```

Hooks run in the background, outside any approval, and a throw is logged,
not fatal. Tests wait for them with `await brain.idle()`.

`ctx` (`ModuleContext`) gives you:

| Member | Use |
|---|---|
| `ctx.claude` | The only way to call Claude. `parse(meta, req, zodSchema)`, `create(meta, req)`, `stream(meta, req)`. `meta = { call: 'prioritise' \| 'prepare' \| 'chat' \| 'profile', sourceId }`. The model comes from `models.ts`; effort defaults per call type (set `req.effort` to override). Usage logging, the spend cap and `stop_reason` checks are done for you: catch `SpendCapError`, `ClaudeRefusalError`, `ClaudeMaxTokensError`, `ClaudeOutputError`, `ClaudeUnavailableError` from `../claude`. Haiku chat may pass `thinking: 'disabled'` (effort high or below). Never import `@anthropic-ai/sdk` (a test fails if you do, except `import type`). |
| `ctx.read` | Read-only connectors: `pm.listClients/listTasks`, `mail.get/listSince`, `calendar.view`, `chat.listSince`, `files.list/read`. **There are no write methods here.** |
| `ctx.suggestions` | `add(newSuggestion)` creates a pending suggestion (validated against the contract; the sidebar updates). `revise(id, fn)` edits a still-pending one (cannot change id, kind or status). `get`, `list`. |
| `ctx.taskMeta` | The overlay: `get`, `all`, `upsert(taskId, patch)`, `upsertMany`. Order, quick win, reason, prepared work, `preparedStatus`, `preparedSuggestionId`, on hold. |
| `ctx.nudges.add({ kind, text, source, suggestionIds?, taskId? })` | `fit_now` (with `taskId`), `new_item`, `info`. Pushed to the sidebar as an SSE `nudge`. |
| `ctx.intake.submitText(text, 'manual' \| 'voice')` | Same triage as typed input; returns the suggestions. |
| `ctx.state.build()` / `ctx.state.changed()` | Build the `SidebarState`; request a (debounced) push. Store changes push automatically. |
| `ctx.clients()`, `ctx.myTasks()` | Cached client list; my open tasks. |
| `ctx.profiles` | Read-only profile files: `read(clientName)`, `aliases(clientName)`, `pathFor(clientName)`. |
| `ctx.routes.add(method, '/api/x/:id', handler)` | `handler({ req, res, url, params, body() })`. Throw `HttpProblem(status, msg)` from `../httpProblem` for errors; `sendJson(res, status, body)` from `../server`. Clashing routes throw at start-up. |
| `ctx.upgrades.add('/api/voice', (req, socket, head) => …)` | Raw HTTP upgrade. `ws` is already a dependency: `new WebSocketServer({ noServer: true }).handleUpgrade(req, socket, head, cb)`. |
| `ctx.executors.override(kind, executor)` | Replace what approving one suggestion kind does. Call through with `x.core(s, x)`. Writes go through `x.writes` (only here). |
| `ctx.config`, `ctx.clock`, `ctx.log` | Config (`speechUrl`, `dataDir`, `me`, `internalClientId`…), the clock (`now()`, `today()`, `tz`), a prefixed logger. |

### The one rule

**Nothing outside the brain changes without an approval.** Modules propose
(`ctx.suggestions.add`); the approve endpoint runs the action through the core
executor for that kind (or your override). Core already executes all six
kinds: `create_task`, `complete_task`, `reschedule_task`, `calendar_block`
(writes the event), `send_reply` (sends, then completes `payload.taskId`),
`confirm_client` (sets the client on the related suggestions). A write
attempted anywhere else throws `WriteOutsideApprovalError`. Profile files and
the TaskMeta overlay are the assistant's own notes and may change without
approval.

## What each builder implements

### 2A `prioritise/` (+ calendar)
- On `onTasksChanged`, `onCalendarChanged`, `onSuggestionApplied` (and `onTick` for time passing): debounce, hash the input, and only then call `ctx.claude.parse({ call: 'prioritise', sourceId: null }, …)` → `{ order: [{ taskId, quickWin, reason }], fitNow: { taskId, sentence } | null }`.
- Write the result with `ctx.taskMeta.upsertMany` (`order` for Today items, `quickWin`, `reason`).
- Free gaps and the lunch check are computed in code from `ctx.read.calendar.view` (`ctx.clock`, `zonedTime`/`localMinutes` from `@poc/contracts`). `fitNow` → `ctx.nudges.add({ kind: 'fit_now', taskId, text })`.
- Lunch and focus blocks: `ctx.suggestions.add({ kind: 'calendar_block', payload: { subject, start, end, purpose, taskId } })`. Approving writes the event (core executor); no override needed.
- Checks: gap maths with a fixed clock; approving a block calls `createEvent` once; unchanged input does not call Claude.

### 2B `prepare/`
- On `onSuggestionApplied` for an applied `create_task` (`result.taskIds[0]`), prepare in the background: `ctx.taskMeta.upsert(id, { preparedStatus: 'preparing' })`, gather context (`ctx.read.mail.get(source.id)`, `ctx.read.files.read`, `ctx.read.calendar.view`, `ctx.profiles.read`), call `ctx.claude.parse({ call: 'prepare', sourceId: taskId }, …)` (PDFs as document blocks), store `prepared` + `preparedStatus: 'ready'`.
- Create the one approving suggestion (`send_reply` with `taskId` for reply/meeting/follow-up drafts; `complete_task` for file review and "other") and store its id in `preparedSuggestionId`.
- Next step: on `onSuggestionApplied` of that prepared suggestion, add one follow-on suggestion with `source: { connector: 'next_step', id: taskId, label }`.
- Meeting slots come from code (free time in `ctx.read.calendar.view`), never overlapping events.
- Routes: `GET /api/tasks/:id/prepared` → `PreparedResponse`; `POST /api/tasks/:id/prepare` regenerates.

### 2C `profiles/`
- `onMessageTriaged`: apply `e.triage.profileEdits` (already limited to a confident client) to `ctx.profiles.pathFor(clientName)`; append to `## Change log` (ISO time first). Use `parseProfile`/`renderProfile` from `@poc/contracts`; keep unknown `##` sections and hand edits (re-read the file every time).
- `onSuggestionApplied` for `confirm_client`: add `payload.alias` under "Also known as" in the confirmed client's file. The core pre-match already reads "Also known as", so the next message using that shorthand matches.
- Optional profile-update call after an approval: `ctx.claude.parse({ call: 'profile', … })`.
- Routes: `GET /api/profiles` → `ProfileListResponse`; `GET /api/profiles/:clientId` → `ProfileDoc`.

### 2D `chat/` (+ voice)
- `POST /api/chat` → SSE stream of `CHAT_SSE_EVENTS` (`delta`, `suggestion`, `done`, `error`), using `ctx.claude.stream({ call: 'chat', sourceId: null }, …)` (`on('text')`, `abort()`, `finalMessage()`).
- Tools: `list_tasks`, `list_clients` (run at once via `ctx.read.pm`) and `propose_*` tools that only call `ctx.suggestions.add`. Set `eager_input_streaming: true` on streamed tools and validate each tool input with zod before use. Never forced `tool_choice` (the wrapper rejects it).
- History is append-only in `DATA_LAYOUT.brainConversation`.
- `WS /api/voice` via `ctx.upgrades.add`; speech service clients (`SpeechToText`/`TextToSpeech` from `@poc/contracts`) live in this folder, using `ctx.config.speechUrl`. Barge-in aborts the Claude stream and the TTS job.
- If Haiku cannot hold the conversation, changing the chat model is a one-line change in `models.ts`: ask the lead.

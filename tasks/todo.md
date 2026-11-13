# Project Management App — v1 Plan (Client Pages)

Status: **v1 BUILT** (see Review)

## Goal
Track timelines and statuses of client work. A left sidebar lists clients. Each
client page shows its info at the top, then a **timeline of meetings**. Clicking a meeting
opens that meeting's page, where its work is laid out as
**Deliverables (columns) → Tasks (cards) → (optional) Subtasks (checklist)**.

v1: one user, desktop browser, data saved as files on your own computer.
Later: a self-hosted server for secure multi-user live sync, a mobile layout, AI and API integrations.

---

## Recommended setup

| Layer | Choice | Why |
|---|---|---|
| App | **React + TypeScript + Vite** | The standard modern stack. Types keep the data model honest as it grows. The same code can later be wrapped for desktop or mobile. |
| Styling | Plain CSS with design tokens (CSS variables) | No framework lock-in. Easy to make responsive later. |
| State | A small store (Zustand), with every change made through named actions (`addTask`, `toggleDone`, …) | Named actions are what later becomes the sync protocol and what AI tools call. |
| Storage | A **`StorageAdapter` interface**. v1 implementation: **local folder** via the browser File System Access API (Chrome/Edge). | Swapping in a `ServerAdapter` later changes one file, not the app. |
| Validation | **Zod** schemas for the data model | The same schemas later validate server API payloads and AI tool inputs. |
| Hosting | Static build, which can run from GitHub Pages or locally (`npm run dev`) | The code is public. **Client data never touches the repo.** It stays only in the folder you pick. |

### Why this works for the future
- **Server sync:** each record has `id` (UUID), `createdAt`, `updatedAt`. Every change is an
  action, so a server can replay or merge actions and broadcast them over WebSockets. A likely backend:
  Node/TypeScript + Postgres on your own server, with company login (SSO).
- **AI / APIs:** the store's actions *are* the tool list ("create task", "move due date", …).
  An AI assistant or an external integration calls the same actions the UI does, validated by Zod.
- **Mobile:** keep the layout responsive-ready (the sidebar becomes a drawer). Later, add an installable app (PWA) or wrap it with Capacitor.

### Alternatives considered
- **Desktop app (Tauri/Electron):** works in any browser and feels native, but means more tooling now. We can wrap the same React app later if needed.
- **Plain single HTML file (like the old chore app):** fastest to start, but won't scale to sync, AI or mobile.

---

## Data model

```
Workspace
 ├─ teamMembers: TeamMember[]      { id, name, initials, color }
 └─ clients: Client[]
     { id, name, logo (file in /logos), teamMemberIds[], plannedThrough: FlexDate }
     ├─ adhoc: { deliverables[] }  ← one per client, no date; same structure as a meeting
     └─ meetings: Meeting[]        { id, title?, date: FlexDate }
         └─ deliverables[]         { id, title }
             └─ tasks[]            { id, title, assigneeId, dueDate, done: boolean }
                 └─ subtasks[]     { id, title, done: boolean }   (optional checklist, personal tracking)
```

**FlexDate** is either an exact date or a broader period, typed freely and parsed:
- `10/28/26` → exact date 2026-10-28
- `Nov 2026`, `Q4 2026`, `Fall 2026`, `2026` → period, stored with a start and end so it can be sorted
- Meetings are sorted chronologically by start date. A period sorts by its start.

**Status is binary:** done or not done (tasks and subtasks).
Deliverables have no due date or owner of their own. Their progress ("3/5 done") and
latest due date are **derived** from their tasks. Meeting progress is derived the same way.
No notes or links on any item (decided for v1).

### Files on disk (the folder you choose)
```
my-workspace/
  workspace.json     ← all data, human-readable, versioned schema
  logos/<clientId>.png
```
Autosaves shortly after each change. The app remembers the folder between visits.

---

## UI (desktop)

- **Left sidebar:** client list (logo + name), search, "+ New client", and team settings at the bottom.
- **Client header:** logo, name, assigned team (avatar chips), "Planned through" date. Edit in place.
- **Meeting timeline:** a horizontal strip under the header with meetings placed in date order,
  each showing date, title and progress. Broad dates ("Fall 2026") show as a soft band.
  Marks for **today** and **planned through**. Click a meeting to open it. "+ Meeting" adds one.
- **Ad-hoc tile:** pinned at the left edge of the timeline (doesn't scroll away). It shows the open count,
  plus an overdue count in red if any. Clicking it opens the ad-hoc page, which works exactly like a meeting page
  (deliverable columns → task cards → subtasks) but has no date.
  - Ad-hoc tasks with a due date also appear as **small dots** on the timeline at that date
    (red if overdue, hidden once done). Hovering a dot shows the task; clicking it opens the ad-hoc page with that card highlighted.
  - Tasks cannot be moved between ad-hoc and meetings.
- **Meeting page** (below the timeline; the URL updates so it can be linked or bookmarked):
  - Header: meeting date (flex), title, overall progress.
  - **Deliverables as columns** side by side (scroll sideways when there are many), with title and progress in each header.
  - **Tasks as cards** in each column: done checkbox, title, assignee initials, due date (overdue highlighted).
  - Subtasks: a small checklist that expands on the card (title + checkbox only), with a count shown ("2/3").
- Add or edit anything inline. Delete with confirmation. Use keyboard (Enter to add the next item, Esc to cancel).
- Team settings: add or edit team members (name, color).

---

## Build checklist

- [x] Scaffold Vite + React + TS, linting, `npm run build` / `dev`
- [x] Zod schemas and types for the data model, plus a schema version
- [x] FlexDate parser, formatter and sort key, with unit tests (Vitest)
- [x] Store with named actions, plus unit tests
- [x] `StorageAdapter` interface, plus `LocalFolderAdapter` (File System Access API) and an in-memory/IndexedDB fallback for testing
- [x] Welcome screen: "Open folder" / "Create new workspace"
- [x] Sidebar with client list, search and new client
- [x] Client header: logo upload, team chips, planned-through date
- [x] Meeting timeline (today + planned-through markers, flex-date bands)
- [x] Ad-hoc tile pinned on the timeline, an ad-hoc page (reuses the meeting page), and ad-hoc task dots on the timeline
- [x] Meeting page: deliverable columns, task cards, subtask checklist; inline create, edit and delete
- [x] Done toggle, assignee and due-date controls; overdue styling; derived progress
- [x] Team members settings (shared list); client team picker; assignee picker with search
- [x] Drag to reorder tasks within a column and to reorder columns (dnd-kit)
- [x] Light/dark theme tokens (follows system)
- [x] Autosave and a save-status indicator; handle a folder permission prompt on reload
- [x] Playwright smoke test: create client → meeting → deliverable → task → subtask, reload, data persists
- [x] Update README (setup, privacy: data stays local)

## Decisions log
- Stack: TypeScript + React + Vite. Rust considered; possibly later for the server or a Tauri desktop wrapper.
- Client page: meeting timeline at top → click opens that meeting's page.
- Meeting page: deliverable columns with task cards.
- Done/not done only. Subtasks are a title + checkbox. Deliverables get progress only from their tasks.
- Ad-hoc: a tile pinned on the timeline. Same deliverable/task structure as a meeting. Dated tasks show as dots on the timeline. No moving tasks in or out.
- No notes. No extra views (My tasks etc.). Templates later.
- Team: one shared company list managed in settings. Clients pick their team from it.
- Assignee picker: shows the client's team first, plus a search to find anyone in the company.
  Picking someone from outside the team does not add them to the client's team.
- Drag & drop: reorder tasks within a column, and reorder deliverable columns. Tasks do not move between columns.
  Clients in the sidebar are sorted alphabetically.
- Style: clean and minimal (Linear/Notion-like): white, subtle grays, one accent color. Dark mode follows the system setting.

- Browser: Chrome. Workspace folder may live in OneDrive (single user). The app checks for outside changes before each save and warns instead of overwriting.
- Safety: undo/redo (Ctrl+Z / Ctrl+Shift+Z) and rolling backups (last 20, at most one every 5 min) in `backups/`.
- Clients are archived (collapsed sidebar section), not deleted. Delete is still available behind a confirmation.
- Timeline warnings: amber dot on a past meeting with open tasks; meetings after planned-through are faded.
- Dates: US format. Broad dates: Nov 2026, Q4 2026, H1 2027, Fall 2026, Early 2027, Early Nov 2026, 2026.
- Demo data: "Try the demo" (in memory, not saved), or start a new folder pre-filled with demo data.
- Repo is public for now; the owner will make it private later. Importing existing client JSONs comes later.

## Later (not v1)
Import existing client JSONs · Meeting templates / duplicate · search across clients · print/export · My tasks & upcoming views · server sync · mobile · AI assistant · notes

## Open questions
See the chat.

## Review

**Built:** everything in the checklist above. Deviations from the plan:
- **Linting** is `tsc --strict` (with unused-code checks) only. ESLint was skipped to keep the toolchain small.
- **Deleting a task or subtask** has no confirmation; Undo covers it. Clients, meetings, deliverables with tasks, and team members all ask first.
- **Old logo files** are kept when a logo is replaced or removed, so Undo can restore them.
- **The storage fallback** for tests uses the browser's private file system (`?storage=opfs`), which exercises the real FolderAdapter code.
  In test mode the folder isn't remembered across reloads, because headless Chromium crashes reloading a page whose IndexedDB holds a private-file-system handle.
  Real folder handles are unaffected.

**Verified:**
- `npm test`: 38 unit tests pass (flex-date parsing for exact and broad formats, ordering, store actions, undo/redo, member deletion, timeline scale, demo data validity).
- `npm run e2e`: 11 steps pass in Chromium:
  - demo setup
  - add client
  - broad planned-through date
  - add meeting (faded when after planned-through)
  - deliverable → tasks → subtask, assign via search, complete
  - drag reorder
  - ad-hoc due date shows as an overdue timeline dot
  - undo/redo
  - autosave, then reload, with all data and task order intact
  - archive
  - no browser console errors
- Screenshots reviewed in light and dark mode.

**Not verified here:** the real OS folder picker and OneDrive syncing. These need a person in Chrome.
The same code path is tested via the browser's private file system.

**Next ideas:** import existing client JSONs, meeting templates, My tasks view, server sync.

---

# Weekly Calendar — Plan

Status: **BUILT** (see Review at the end of this section)

## Goal
One place to see and move this week's work across **all clients**. Top row is my work; bottom row is
other people's work at my clients.

## Decisions (from the user)
- **Placement:** its own page, "This week", at the top of the sidebar (above Clients). All clients.
- **Rows:**
  - **Meetings band** across the top of each day: meetings with an exact date, at my clients.
  - **My work:** tasks assigned to me, at any client.
  - **Others at my clients:** tasks at my clients assigned to someone else, plus unassigned ones (tagged "Unassigned").
- **Who am I:** picked once from the team list, remembered on this device (not in the shared data). Changeable from the header ("Viewing as Jack Dengler ▾").
- **My clients** = clients whose team includes me.
- **Days:** Mon–Fri, with a weekend toggle (remembered on this device). When the weekend is hidden, Sat/Sun items show on Friday with a "Sat"/"Sun" tag.
- **Overdue column** on the left: open tasks due before the week starts.
- **Card:** client logo + task name, plus "x/y" if it has subtasks. Hover shows more: client, meeting or ad-hoc, deliverable, assignee, due date, and the subtask list.
- **Actions:**
  - Check a task off.
  - Drag to another day to change its due date. The row is decided by the assignee, so dragging never reassigns.
  - Drag onto a **"Next week →"** drop zone on the right edge to set the due date to **Monday of next week**.
  - Click a card or meeting to open it on the client page (task highlighted).
  - **Add a task on a day:** pick the client, then a meeting or Ad-hoc, then a deliverable. Defaults to Ad-hoc → General. Added in "My work" = assigned to me; added in the bottom row = unassigned.

## Defaults I'll use (say if any is wrong)
- **Navigation:** header with "Week of Nov 9 – 13", ‹ › to change week, "Today" to jump back. Opens on the current week. The URL remembers the week (`#/week/2026-11-09`).
- **Overdue column** only appears when viewing the current week. It's a drag source (drag an overdue task onto a day or Next week), not a drop target.
- **Done tasks** stay on their day, faded with a strikethrough, so the week shows what got done. A "Hide done" toggle is remembered on this device.
- **Excluded:** archived clients, broad-dated meetings ("Fall 2026" can't sit on one day), and tasks with no due date.
- **Today's column** gets a subtle highlight.
- **Within a day:** cards sorted by client name, then deliverable order.
- **Row headers** show counts ("My work · 7 open").
- **Empty states:** "Nothing due" on empty days; before "me" is picked, a short prompt to choose yourself.
- **Hover:** the card is a drag handle (6px threshold) and a click target; the checkbox toggles done; the hover card is read-only.

## Key tasks (added)
- **Personal:** each person stars their own key tasks, and you only see gold on yours.
  Stored with the data as `task.keyFor: memberId[]`, so it follows you across devices and works once coworkers share a workspace.
- **Mark or unmark** from the task card's ⋯ menu, or with a ☆ that appears on hover. On the calendar, use the hover card's star.
  If "me" isn't chosen yet, starring asks you to pick yourself first.
- **Gold on:** task cards on meeting and ad-hoc pages (gold border, gold ★) and weekly-calendar chips (gold background, gold ★), including in Overdue.
  Not on the timeline or sidebar (decided).
- **Done key tasks** keep a faint gold edge, so you can still tell what they were.

## Meeting kickoff dates (added)
- **What it is:** a meeting can have a **kickoff date**, when work on it should start. Set it from the meeting page header ("Kickoff: Set date"), with a date picker and a clear option.
  Stored as `meeting.kickoff: { date, done } | null`.
- **On the calendar,** it flows through like a task: a chip "⚑ Kickoff · <meeting>" with the client logo, in **My work** for everyone on that client's team.
  - Check it off, which means work has started.
  - Drag it to another day or to Next week →.
  - If it's past and not checked off, it goes to Overdue.
  - Click it to open that meeting.
- **On the timeline:** a small ⚑ flag on the axis at the kickoff date, in the meeting's lane color. Hover shows "Kickoff for <meeting>". Faded once done.
- **Not available:** kickoffs can't be starred as key tasks, and they have no assignee (they belong to the client's team).

## Due-date display (added)
- **Day of week** on every due date on client pages: "Tue Oct 28" (the year is added when it's not this year).
  Also used in hover cards and timeline dot tooltips.
- **Weekend flag:** a task due on a Saturday or Sunday gets an amber due chip with a small ⚠ ("⚠ Sat Nov 14"), with the tooltip "Due on a weekend".
  - Shown on client-page cards and calendar chips (with the weekend hidden, the chip already lands on Friday tagged Sat/Sun; it gets the same amber flag).
  - Overdue red takes priority over amber.
  - Done tasks drop the flag.

## Data model
- **Schema stays version 1:** the two new fields have defaults (`keyFor: []`, `kickoff: null`), so existing workspace.json files, browser copies and imports load unchanged.
- **Everything else** comes from existing fields (`dueDate`, `assigneeId`, `teamMemberIds`, meeting `date`).
- **Per device:** "me", the weekend toggle and the hide-done toggle live in localStorage.
- **New store actions:**
  - `moveTaskToDate(taskId, isoDate)`
  - `toggleKey(taskId, memberId)`
  - `setKickoff(clientId, meetingId, isoDate | null)`
  - `toggleKickoffDone(clientId, meetingId)`
  - `moveKickoffToDate(clientId, meetingId, isoDate)`

## Build checklist
- [x] Pure `model/week.ts`: week start (Monday), days, task/meeting bucketing (rows, weekend → Friday, overdue) — unit tests
- [x] Route `#/week[/<monday>]`; "This week" sidebar item with an open-task badge for me
- [x] Week page: header (week label, ‹ Today ›, viewing-as picker, weekend + hide-done toggles)
- [x] Grid: Overdue column + day columns × (Meetings band, My work, Others) + "Next week →" drop zone
- [x] Task chip: logo, name, x/y; hover card; checkbox; click → client page with highlight
- [x] Drag & drop between days / to next week (dnd-kit, one DndContext for the grid)
- [x] Add task on a day: popover (client → meeting/Ad-hoc → deliverable → name)
- [x] First-run "who are you?" picker
- [x] Key tasks: schema default, toggleKey, star on cards and calendar chips, gold styling (light and dark)
- [x] Due dates: weekday format helper (unit-tested), weekend flag on cards and calendar
- [x] Kickoff dates: schema default, meeting-header control, calendar chips (check, drag, overdue), timeline flag
- [x] e2e: pick me, check off, drag to a day, push to next week, add task, click through
- [x] Screenshot review in light and dark, then republish the hosted page with your data

## Review — weekly calendar, key tasks, kickoffs, design pass

**Built:**
- **Weekly calendar:** meetings band, My work, Others at my clients, Overdue (current week), weekend toggle and Friday tags, hide done, drag to a day or to Next week (Monday), check off, hover details, add a task on a day, click through.
- **Personal key tasks** (gold) on cards and calendar chips.
- **Kickoff dates:** set from the meeting header; flow to the calendar and the timeline.
- **Due dates:** weekday shown, plus an amber weekend flag.
- **Archive and unarchive** from the sidebar.
- **Logos:** no white box behind them; logos with white baked into the image blend in light mode.

**Design pass (all review notes):**
- **Scrollbars, contrast, numerals:**
  - Thin, light scrollbars.
  - Text grays now ≥ 4.5:1 contrast.
  - Tabular numerals everywhere.
  - A 4px spacing scale.
- **Calmer layers and color:**
  - No gray fill behind the timeline.
  - Softer, tinted avatars.
  - One "selected" style (tinted fill) for clients, meetings and Ad-hoc.
- **Timeline:**
  - Header row with "Add meeting" (no pinned gray column).
  - Legend, darker axis, labels and stems.
  - The broad-date band is neutral with a tooltip.
  - Tiles are taller (no clipped letters).
  - Complete meetings say "All done" (no duplicate check and bar).
- **Meeting header and columns:**
  - The meeting name is primary and the date is a secondary pill.
  - Progress appears only at summary level; columns show a count pill, green when complete.
  - Column headers are one line at a fixed height, so cards and "Add task" align.
  - The "Add deliverable" column has a proper minimum height.
  - Columns grow to use wide screens.
  - All ⋯ buttons are one size.
- **Client header:**
  - Smaller logo, larger avatars with readable initials.
  - Uppercase labels with dark values ("PLANNED THROUGH Jan 1, 2027").
- **Sidebar:**
  - A product mark and name, with undo and redo beside it.
  - A workspace switcher (browser or folder icon, save status) whose menu holds Team, Import, the theme choice (System / Light / Dark) and Back to start or Switch folder.
  - Logos in uniform tiles, tighter rows, stronger section labels.
- **Narrow screens:** the sidebar becomes a drawer below 860px.

**Verified:**
- 51 unit tests and 17 end-to-end steps, including week drag, push to next week, key star from hover, kickoff and weekend flag.
- Screenshot reviews with the real data in light and dark, the week page, and narrow widths.

**Bugs found and fixed while testing:**
- The hover card closed when you pressed its own star (React portal events bubble). Fixed.
- The test clicked within dnd-kit's 50ms post-drop click guard. That was a test-only problem; a pause was added.

**Not done:** see `tasks/roadmap.md`.

## Review — mockup layout (user-supplied design)
- **Adopted:**
  - **Top bar:** breadcrumb, undo/redo, "Saved in this browser only" pill, Export backup.
  - **Meetings card:** white, with an Ad-hoc pill in its header; simpler tiles ("5/5 complete") and a "+ Meeting" button.
  - **Meeting header:** the name, with a "date · n deliverables · kickoff" line, and "x of y tasks done" on the right.
  - **Columns:** open (no gray), wrapping to new rows.
  - **Task cards:** always show Unassigned / No date.
  - **Selected client:** a white card; a red dot marks clients with overdue work.
  - **Planned through:** shows a "Set a date" link when empty.
- **Kept per the user:** real client logos, and no search.
- **Added:**
  - **Export backup:** downloads the file in the full app; the hosted page shows a copy box instead.
  - **Restore:** Import restores a backup as one undoable step.
- **Data:** "(T)" people merged into their base names in the built-in data (51 → 45 people).
- **Verified:** 51 unit tests, 18 e2e steps (including backup export and restore), and screenshots in light and dark.

---

# Time Tracking — Plan

Status: **BUILT** (decisions: client, deliverable and OpenAir are each optional; timer pill in the top bar; OpenAir list to be pasted by the user)

Carried over from the old app's spec, simplified as it suggests, with its three bugs fixed and its four hidden features given buttons.

## Data (personal, kept apart from the shared client data)
- **One flat list of entries:** `{ id, clientId, deliverableId?, taskId?, startISO, endISO, note, openAirTaskId?, dayKey }`.
  - Exact times; `dayKey` is the local day of the start.
  - Duration is computed, not stored.
- **Running timer:** `{ startedAtISO, clientId?, deliverableId?, taskId?, note, openAirTaskId? }`. Nothing is written as an entry until Stop.
- **Owner:** belongs to "me" (the person picked on this device).
  - **Storage:** a separate store (its own file in the folder, its own key in the browser), so client files stay clean and a future server can keep time private per person.
- **OpenAir task list** (Client / Internal / Firm): kept with the workspace settings, editable in a small Settings list. Empty → "No OpenAir tasks yet", with no built-in defaults.
- **Safety:**
  - Duplicate IDs dropped on load.
  - If two timers are somehow found, the newest keeps running and the others are saved as entries.
  - Time changes save immediately.

## Starting
- **Quick-start bar** on the Time page:
  - Client (type-ahead, unique prefix selects).
  - Deliverable ("Deliverable — Meeting", current meetings plus Ad-hoc).
  - OpenAir task (tabs).
  - Note.
  - Start.
- **Unknown client name** → creates a normal client (fixes the "temporary client" bug). **New deliverable name** → created in that client's Ad-hoc.
- **Start with nothing filled in** → a "no client" timer you reassign later.
- **▶ buttons:** on deliverable headers and task cards ("track time on this"), on Time-page group rows, and **Resume** on past entries (copies deliverable, note and OpenAir task; never edits the old entry).
- **Starting any timer stops the running one first** and saves it.

## While running
- **Timer pill in the top bar:** visible on every page, with logo, deliverable or task, and a live clock that ticks on the real second.
  - **Stop** saves the entry.
  - **Edit** opens the edit dialog for the running timer.
- **Live edits:** note, OpenAir task and deliverable update the running timer.
  - Note saves are debounced, so there's no save per keystroke (fixes bug 2).
- **Switching client mid-timer:** saves the old stretch as an entry and **restarts the timer at now** on the new client (fixes double-counting).
- **Survives reloads:** the timer is saved, and keeps counting across a reload or restart.

## Stopping
- **One stop function used everywhere.** A 0-second timer saves nothing. A timer running past midnight files under its start day.
- **Deleting or archiving a client with a running timer** asks first and saves the entry.
- **No fake "Pause":** it's called Stop. Resume starts a new entry.

## Entries list (Time page)
- **Grouping:** Week (**Saturday–Friday**, "This week" / "Last week" / "Nov 1 – Nov 7") → Day ("Today · …", "Yesterday · …") → group (Client | Deliverable | OpenAir task).
  - Groups are sorted by client, then OpenAir task (blank last), then deliverable.
- **Totals:** week, day and group ("1h 5m"). Collapse state is remembered.
- **Group row actions:** ▶ start (Stop when running) and **Move group…** (change the deliverable or client for all entries at once, previously hidden).
- **Entry row:**
  - Start, end and duration.
  - Note, edited inline with a green "Saved".
  - **Edit**, **Duplicate** (previously hidden) and **Delete** (two clicks).
- **+ Add time** (manual entry, previously hidden): client, deliverable, date, start, end, note.
- **Empty state:** "Start your first timer".

## Edit dialog (past entry or running timer)
- **Fields:** client, deliverable, OpenAir task, date, start, end.
- **Times use the local day.** End before start keeps the entry's original length from the new start.
- **Smart time typing:**
  - Accepts "9am", "9:30 PM", "14:30".
  - A bare "9" is read relative to the other time: for an end time, the next 9 after the start; for a start time, the previous 9 before the end. Rolls across midnight if needed.
- **Running timer:** editing it keeps it running.

## Weekly timesheet
- **Layout:** rows are client × OpenAir task; columns Sat–Fri, with prev/next week.
- **Cells:** hours, with notes collected; row, column and grand totals.
- **Rounding:** None → 0.1h → 0.25h, applied per cell before summing (matches OpenAir entry).

## Day timeline (beside the list)
- **View:** vertical, latest time at top, ~8 hours visible over a scrollable 24-hour day.
  - A now line, with auto-scroll to now. Scroll position is kept per day.
- **Overlaps:** overlapping entries sit side by side.
- **Colors:** sampled from each client's logo (dominant non-white color), with readable text. Falls back to a stable color from the name.
- **Controls:** prev/next day and Hide. Hidden by default on narrow screens; the choice is remembered.

## Elsewhere
- **Time totals:** on meeting cards (timeline tiles) and deliverable headers, e.g. "1h 20m".
- **Navigation:** Time page in the sidebar; timer pill in the top bar.

## Build checklist
- [x] Pure modules + tests: duration formatting, Sat–Fri weeks, grouping/totals, rounding, smart time parser, timer start/stop/switch (no double count), midnight
- [x] Personal time store (folder file / browser key) + safety on load
- [x] OpenAir task list in settings
- [x] Quick-start bar, timer pill, ▶ buttons, Resume
- [x] Entries list with groups, totals, inline notes, Edit / Duplicate / Delete, Move group, + Add time
- [x] Edit dialog with smart time typing
- [x] Weekly timesheet with rounding
- [x] Day timeline with logo colors
- [x] Time chips on meetings and deliverables
- [x] e2e: start → switch client → stop (no double count), edit times, resume, timesheet totals

---

# AI Work Assistant POC

Status: **PLAN, awaiting approval. Nothing is built.**

Source: `POC_BRIEF.md`. Rules carried from `tasks/lessons.md`: invented names only, this repo is public, look at what the user will actually see before calling anything done.

## Summary

**Planr has no server and no API.** It is a browser-only app that keeps one JSON document (`workspace.json`). It has clients, but clients carry **no** email domains, contacts, file folder or nicknames. Tasks have no source link, no "on hold" state and no "internal" flag.

**Key recommendations**

1. **Give the test copy a tiny server (`pm-server`) that owns a test `workspace.json` in a Docker volume.** Planr gets a third `StorageAdapter` (`ServerAdapter`), switched on only by `?storage=server`. The same process serves the MCP server with exactly five tools. One process owns the file, so the Planr test copy, the MCP server and the sidebar all see the same data. Planr changes: about five files, about 150 lines.
2. **Add four optional client fields to Planr's schema, with defaults.** `schemaVersion` stays 1 and existing files load unchanged. No editing UI in the POC.
3. **Everything else lives in a new `poc/` folder,** with its own `package.json`. TypeScript on Node 22 throughout, reusing Planr's zod schemas by import.
4. **The brain is the only MCP client.** Claude never receives the write tools. Claude can only create *suggestions*; only the approve endpoint calls a write. This makes "nothing without approval" structural.
5. **Sidebar: a browser window at sidebar width** (Chrome `--app` mode). Not Electron or Tauri for the POC.
6. **Voice: local speech models inside the sandbox** (streaming speech-to-text and text-to-speech), so only Claude sits outside. This is a user decision (Question 1).
7. **Network: every service sits on a Docker network with no internet.** One `gateway` container is the only door. It forwards to `api.anthropic.com` and nothing else.
8. **Models:** `claude-sonnet-5-5` for triage and ordering, `claude-opus-5-5` for drafting and file review, `claude-haiku-5-5` for the live conversation. `claude-fable-5-2` is not used at runtime.

---

## 1. How Planr works today

| Topic | Finding | Where |
|---|---|---|
| Stack | React 19, TypeScript, Vite, zustand + immer, zod 4. Static build on GitHub Pages. | `package.json`, `vite.config.ts`, `.github/workflows/deploy.yml` |
| Server / API | **None.** No `fetch`, no WebSocket, no backend anywhere in `src/`. | `src/` |
| Data model | One `Workspace` document: `{ schemaVersion: 1, teamMembers[], clients[], settings }`. | `src/model/schema.ts` (`WorkspaceSchema`) |
| Clients | `Client { id, createdAt, updatedAt, name, logo, teamMemberIds[], plannedThrough, archived, adhoc: { deliverables[] }, meetings[] }` | `ClientSchema` |
| Tasks | Nested: client → (meeting or `adhoc`) → `Deliverable` → `Task { id, title, assigneeIds[], dueDate (YYYY-MM-DD or null), done, subtasks[], keyFor[] }`. Task ids are globally unique. | `TaskSchema`, `DeliverableSchema`, `MeetingSchema` |
| Meetings | `Meeting { title, date: FlexDate, kickoff, deliverables[] }`. These are client meetings as plan items, not a calendar. | `MeetingSchema` |
| People | `TeamMember { id, name, color, role }`. "Me" is per device, in localStorage key `compensian-pm-prefs`. | `TeamMemberSchema`, `src/prefs.ts` |
| Time entries | Personal, separate from the workspace: `{ entries[], timer }` per person. Not needed by the POC. | `src/time/model.ts`, `src/time/store.ts` |
| Changes | Every change is a named zustand action (`addTask`, `updateTask`, `toggleTask`, …) with undo. Browser only. | `src/store/store.ts` |
| Storage seam | `StorageAdapter { kind, name, load, save, writeLogo, readLogo, loadPersonal, savePersonal }`, plus `ConflictError`. | `src/storage/adapter.ts` |
| Local folder | `FolderAdapter`: File System Access API. Writes `workspace.json`, `logos/`, `backups/`, `personal/<id>.json`. | `src/storage/folderAdapter.ts` |
| Browser storage | `MemoryAdapter`: memory, plus localStorage key `compensian-pm-demo`. | `src/storage/memoryAdapter.ts` |
| Built-in data | `window.__COMPENSIAN_SEED__`, injected only into the single-file hosted page. | `src/seed.ts`, `scripts/build-artifact.mjs` |
| Import | Old-tracker client JSONs, and backup restore. | `src/import/legacy.ts`, `src/components/ImportClients.tsx` |
| Autosave | Saves the whole document 600 ms after a change. A conflict shows a banner with "Load the file's version" / "Keep mine". | `src/storage/persistence.ts`, `src/App.tsx` |
| Test hook | `?storage=opfs` swaps the storage for tests. We copy this pattern. | `src/components/Welcome.tsx`, `e2e/smoke.mjs` |

**Stated plainly**

- Clients exist. They do **not** carry email domains, contacts, a file-server folder or nicknames.
- Tasks have **no** source link, notes, "on hold" or "internal" marker.
- There is **no** calendar or mail concept in Planr.

**Smallest way to add the client fields.** Add four fields to `ClientSchema`, each with a default, the same way `keyFor` and `kickoff` were added:

```ts
emailDomains: z.array(z.string()).default([]),
contacts: z.array(z.object({ name: z.string(), email: z.string(), role: z.string().default('') })).default([]),
fileFolder: z.string().nullable().default(null),
nicknames: z.array(z.string()).default([]),
```

Because the inferred type then requires them, three places that build a `Client` literal need the defaults added: `addClient` in `src/store/store.ts`, `src/import/legacy.ts`, `src/model/demo.ts`. No UI. The POC edits these values in seed data only.

---

## 2. What the sandbox needs from Planr

### 2.1 Changes inside `src/` (the only Planr changes)

| File | Change |
|---|---|
| `src/model/schema.ts` | The four client fields above. |
| `src/store/store.ts`, `src/import/legacy.ts`, `src/model/demo.ts` | Fill the new fields with empty defaults where a `Client` is built. |
| `src/storage/adapter.ts` | `kind` gains `'server'`. Optional `watch?(onChange: () => void): () => void`. |
| `src/storage/serverAdapter.ts` (new) | `ServerAdapter` over same-origin `/api`. Keeps the last `rev`. A 409 on save throws `ConflictError`. `name` is "POC sandbox (test data)", so the workspace switcher shows it is a test copy. |
| `src/storage/persistence.ts` | In `attach`, if the adapter has `watch`, subscribe. On a change with status `saved`, call `reloadFromDisk()`. Otherwise the existing conflict banner handles it. |
| `src/components/Welcome.tsx` | If `?storage=server`, build a `ServerAdapter`, load and attach on mount. |
| `src/App.tsx` and others | Check every `adapter.kind ===` use so `'server'` behaves sensibly. |

The live app is unaffected. `?storage=server` is never set there, and the new fields default to empty.

### 2.2 `pm-server` (new, in `poc/packages/pm-server`)

One Node process. It owns `data/pm/workspace.json`.

- **Refuses to start** unless the data folder contains the marker file `.poc-sandbox`. This is the guard against ever pointing it at live data.
- Validates every read and write with Planr's own `parseWorkspace`, imported from `src/model/schema.ts`. No copy of the schema, so no drift.
- **Port 8080 (app):** serves the Planr build, and the storage API the `ServerAdapter` uses:
  - `GET /api/workspace` → `{ rev, workspace }`
  - `PUT /api/workspace` with `If-Match: <rev>` → `{ rev }`, or 409
  - `GET /api/events` (SSE): `{ rev }` on every change
  - `GET|PUT /api/logos/:name`, `GET|PUT /api/personal/:personId`
- **Port 8081 (MCP):** the MCP server, Streamable HTTP, `@modelcontextprotocol/sdk` (verify transport and package versions at build time).
- All writes go through one in-process queue: load → change → validate → atomic write (temp file, then rename) → `rev + 1` → SSE.

**Why this is the smallest honest option.** Planr holds the whole document in memory and saves the whole document. A second writer on the same file would be silently overwritten. The alternatives are worse:

| Option | Problem |
|---|---|
| MCP server writes the folder that `FolderAdapter` has open | The browser file API cannot reach into a Docker volume. Planr only notices outside changes when it next saves, and then stops with a conflict banner. No live update. |
| MCP server drives the Planr page through a headless browser | Fragile and slow. Not what V1 would do. |
| Separate task database, with Planr showing a copy | Two sources of truth. Fails "approved tasks land in the test PM app". |

A `ServerAdapter` is also the step `README.md` and `tasks/roadmap.md` already plan for.

### 2.3 MCP tools (exactly five)

| Tool | Input | Result | Notes |
|---|---|---|---|
| `list_clients` | `{}` | `{ clients: [{ id, name, archived, nicknames, emailDomains, contacts, fileFolder, projects: [{ meetingId, title, date, deliverables: [title] }] }] }` | Read only. |
| `list_tasks` | `{ clientId?, assigneeId?, includeDone? (false), dueFrom?, dueTo? }` | `{ tasks: [{ id, title, done, dueDate, assigneeIds, clientId, clientName, boardId, boardLabel, deliverableId, deliverableTitle, updatedAt }] }` | Flattens the nesting. |
| `create_task` | `{ clientId, title, dueDate?, assigneeIds?, deliverableId? }` | `{ task }` | Default home: the client's Ad-hoc → deliverable "General", created if missing. This matches Planr's own "add task on a day" default. |
| `complete_task` | `{ taskId }` | `{ task }` | Sets `done: true`. Idempotent, not a toggle. |
| `reschedule_task` | `{ taskId, dueDate }` (`YYYY-MM-DD` or `null`) | `{ task }` | |

Not exposed: delete, rename, client edits, meetings, team, time. A test asserts that `tools/list` returns exactly these five names.

**Honest limits**

- The storage API on port 8080 is Planr's own backend, not part of the MCP surface. The brain is configured with the MCP URL only, and a test greps the brain for any use of the storage API.
- Claude's hosted MCP connector cannot be used, because Anthropic's servers cannot reach into the sandbox. The brain is the MCP client.
- Learned shorthand cannot be written back to the client list (no tool for it). It is kept in the client profile file instead.

### 2.4 Things Planr lacks, kept in the brain as an overlay

`data/brain/taskmeta.json`, keyed by Planr task id: source link, direction (I owe / owed to me), task type, on-hold flag, Today order, quick-win flag, prepared work. "Internal" is a seeded client named "Internal" whose id is in config. See Question 4.

---

## 3. Architecture

### 3.1 Services

| Service | What it is | Stack | Internal port | Host port (127.0.0.1 only) |
|---|---|---|---|---|
| `gateway` | The only container with internet. Inbound: routes the three host ports. Outbound: one listener that forwards to `https://api.anthropic.com` only. | nginx, config only | 8443 (outbound) | 5180, 5181, 5182 |
| `pm` | Planr test copy, storage API, MCP server | Node 22 + TypeScript | 8080, 8081 | 5181 → 8080 |
| `mocks` | Fake Outlook mail and calendar (Graph-shaped), fake Zoom Team Chat, demo control page | Node 22 + TypeScript | 8090 | 5182 → 8090 |
| `brain` | Watches sources, calls Claude, holds suggestions, serves the sidebar's API | Node 22 + TypeScript, `@anthropic-ai/sdk` | 7000 | via 5180 `/api` |
| `speech` | Local streaming speech-to-text, voice activity detection, text-to-speech | sherpa-onnx (Node bindings if they work, else a small Python service). Verify at build time. | 7100 | none |
| `sidebar` | Static React build, served by `gateway` | React 19 + Vite + zustand | n/a | 5180 |

**Network**

- `sandbox` network: `internal: true`. All services are on it. No route out.
- `edge` network: only `gateway` is on it.
- The brain reaches Claude with `ANTHROPIC_BASE_URL=http://gateway:8443`. This avoids proxy settings in Node. Streaming must pass through unbuffered (`proxy_buffering off`).
- Host ports bind to `127.0.0.1` only.
- Speech models are baked into the image at build time. Build needs internet; run does not.

**Volumes** (all under `poc/data/`, gitignored, created by `npm run poc:seed`)

```
poc/data/
  pm/        workspace.json, .poc-sandbox, logos/, personal/
  mocks/     mail.json, sent.json, calendar.json, chat.json
  files/     <Client Folder>/...            fake file server (read-only to the brain)
  profiles/  <client-slug>.md               plain files, hand-editable
  brain/     suggestions.json, taskmeta.json, cursors.json, conversation.json
  logs/      usage.jsonl
```

### 3.2 Repo layout

```
poc/
  README.md               how to run, how to demo
  docker-compose.yml
  Dockerfile.node         one image for pm, mocks, brain
  Dockerfile.speech
  env.example             ANTHROPIC_API_KEY=   (copy to poc/.env, which is gitignored)
  gateway/nginx.conf
  package.json            npm workspaces; root package.json is not touched
  packages/
    contracts/            zod schemas and types shared by every piece
    pm-server/
    mocks/
    brain/
    speech/
    sidebar/
  seed/                   invented clients, mail, chat, calendar, files, starter profiles
  e2e/demo.mjs            the 11-step check
```

Note: `.gitignore` has `.env.*`, which would also ignore `.env.example`. Hence `env.example`. Add `poc/data/` to `.gitignore`.

### 3.3 Fake sources

**Fake Outlook (Graph-shaped).** Verify exact field names against Microsoft Graph docs at build time.

- `GET /v1.0/me/messages?$filter=receivedDateTime gt {iso}&$orderby=receivedDateTime`
- `GET /v1.0/me/messages/{id}`
- `POST /v1.0/me/sendMail` → lands in the fake Sent folder only
- `GET /v1.0/me/calendarView?startDateTime=&endDateTime=`
- `POST /v1.0/me/events`
- Message shape: `{ id, conversationId, subject, from: { emailAddress: { name, address } }, toRecipients, receivedDateTime, body: { contentType, content }, bodyPreview }`
- Event shape: `{ id, subject, start: { dateTime, timeZone }, end, attendees, showAs }`

**Fake Zoom Team Chat.** Verify against Zoom docs at build time.

- `GET /v2/chat/users/me/messages?from={iso}` → `{ messages: [{ id, message, sender, sender_display_name, date_time, to_contact | to_channel }] }`
- Personal chats and channels only. No client-named channels.

**Dropping items in live**

- `POST /_control/mail`, `POST /_control/chat`, `POST /_control/reset`.
- Control page at `http://localhost:5182`: tabs for Inbox, Sent, Calendar and Chat, a "drop an email" form, and one-click buttons for the demo's canned messages. This page is also how a person sees the sent reply and the lunch block.
- The seed calendar is built **relative to now** (as `src/model/demo.ts` does), so there is always a free hour before the next meeting. The brain and mocks accept `POC_NOW` to fix the clock in tests.

**Fake file server.** `poc/data/files/<folder>/`, with text, markdown, CSV and one or two PDFs per client. Claude reads PDFs as document blocks. Word and Excel files are left for V1.

**Invented clients** (domains use the reserved `.example` ending)

| Client | Nicknames | Domain | Contacts | Folder |
|---|---|---|---|---|
| Acme Tooling Co. | "Acme", "ATC" | `acmetooling.example` | Michael Okafor (VP HR), Lena Hartwell | `Acme Tooling/` |
| Harborlight Freight | "Harbor", "HLF" | `harborlight.example` | Dmitri Vance, Priscilla Mbeki | `Harborlight Freight/` |
| Quillon Robotics | "Quill" | `quillon.example` | Renata Solis | `Quillon Robotics/` |
| Tessera Foods | "Tess", "TF" | `tesserafoods.example` | Gareth Lindqvist | `Tessera Foods/` |
| Internal | n/a | n/a | n/a | n/a |

The user is "Alex Rivera", a name already used in `src/model/demo.ts`. Every name in seed data, tests, comments and commits is invented.

### 3.4 Connector interfaces (`poc/packages/contracts/src/connectors.ts`)

```ts
interface MailConnector     { listSince(cursor: string): Promise<{ items: MailMessage[]; cursor: string }>; get(id: string): Promise<MailMessage>; send(draft: MailDraft): Promise<{ id: string }> }
interface CalendarConnector { view(startIso: string, endIso: string): Promise<CalEvent[]>; createEvent(e: NewCalEvent): Promise<CalEvent> }
interface ChatConnector     { listSince(cursor: string): Promise<{ items: ChatMessage[]; cursor: string }> }
interface FilesConnector    { list(folder: string): Promise<FileInfo[]>; read(path: string): Promise<FileContent> }
interface PmConnector       { listClients(); listTasks(q); createTask(i); completeTask(id); rescheduleTask(id, dueDate) }   // MCP-backed
interface SpeechToText      { open(): SttStream }      // push PCM; emits speech_start, partial, final
interface TextToSpeech      { speak(text: string, signal: AbortSignal): AsyncIterable<Uint8Array> }
```

The brain imports only these. The POC implementations are thin HTTP clients for the mocks. V1 swaps the base URL and auth, or the class. The brain polls every 2 to 3 seconds; real Graph change notifications stay hidden behind the same interface.

### 3.5 Brain

- **Intake loop.** Poll connectors → skip ids already processed → triage call → save `Suggestion`s → push to the sidebar.
- **Approval.** `approve` (with optional edits) → run the action through a connector → mark `applied` → refresh the list → re-order Today → update the profile. `deny` → mark `denied`. A failed action is marked `failed` and shown, never retried silently.
- **Prepared work.** When a task is approved, its prepared work is generated in the background so the click-through is instant.
- **Next step.** After prepared work is approved, the same call proposes one follow-on suggestion (for example "Email Lena the review notes").
- **Calendar awareness.** Free gaps and the lunch check are computed in code. Claude chooses which task fits the gap and words the nudge.
- **State.** JSON files, atomic writes. No database.
- **Guards.** Debounce and input-hash on re-ordering. A hard stop when estimated spend passes `POC_MAX_USD_PER_DAY`.
- **Email text is untrusted input.** It can only ever produce suggestions.

### 3.6 Sidebar

**Recommendation: a browser window at sidebar width.** Launch with `chrome --app=http://localhost:5180 --window-size=400,1040 --window-position=<right edge>`.

| Option | Verdict |
|---|---|
| Browser at sidebar width | **Pick.** No install, no packaging, no IT approval. `localhost` is a secure context, so the microphone works. Same React stack as Planr. |
| Tauri | The V1 target. Small and can pin on top. Needs a Rust toolchain and signing. It adds nothing the demo must prove. |
| Electron | Heavier than Tauri, same costs. |

What is lost for now: always-on-top and edge pinning. The React app is written so a Tauri shell can wrap it unchanged.

**Layout.** Nudges at the top. Then the sections in the brief's order: Inbox, On hold, Overdue, Today, Tomorrow, each remaining day this week, Next week, Next week +1, Next week +2, Internal. Chat input with a mic button, fixed at the bottom. Clicking a task opens its prepared work. Every suggestion has Approve, Edit and Deny. A small footer shows today's token cost and links to the client profiles.

---

## 4. Shared contracts (fixed in Phase 0, before any parallel work)

All in `poc/packages/contracts`, as zod schemas with inferred types.

```ts
SourceRef  = { connector: 'mail'|'chat'|'calendar'|'files'|'manual'|'voice', id, label, threadId? }
TaskType   = 'reply_email' | 'schedule_meeting' | 'review_file' | 'follow_up' | 'other'
Suggestion = { id, kind: 'create_task'|'complete_task'|'reschedule_task'|'calendar_block'|'send_reply'|'confirm_client',
               status: 'pending'|'approved'|'denied'|'applied'|'failed',
               title, nudge, clientId|null, clientConfidence: 'high'|'low', source: SourceRef|null,
               direction?: 'i_owe'|'owed_to_me', taskType?, duplicateOf?: string|null,
               payload, createdAt, decidedAt|null, error|null }
TaskMeta   = { taskId, source, direction, taskType, onHold, order|null, quickWin, reason, prepared: PreparedWork|null }
PreparedWork =
  | { type: 'reply_email',      draft: MailDraft }
  | { type: 'schedule_meeting', slots: [{ start, end }], draft: MailDraft }
  | { type: 'review_file',      path, summary, keyPoints: string[] }
  | { type: 'follow_up',        draft: MailDraft }
  | { type: 'other',            context: [{ label, text, source: SourceRef }] }
SidebarState = { now, sections: [{ key, label, items: SidebarTask[] }], suggestions, nudges, calendarToday, usageToday }
```

**Brain HTTP** (reached by the sidebar as same-origin `/api`)

| Endpoint | Purpose |
|---|---|
| `GET /api/state` | Full `SidebarState` |
| `GET /api/events` (SSE) | `state` (full snapshot on any change), `nudge` |
| `POST /api/suggestions/:id/approve` `{ edits? }`, `POST /api/suggestions/:id/deny` | Decisions |
| `POST /api/input` `{ text }` | Typed task. Goes through the same triage with source `manual`. |
| `POST /api/chat` `{ text }` → SSE stream | `delta`, `suggestion`, `done` |
| `GET /api/tasks/:id/prepared`, `POST /api/tasks/:id/prepare` | Read or regenerate prepared work |
| `POST /api/tasks/:id/hold` `{ onHold }` | Overlay flag |
| `GET /api/profiles`, `GET /api/profiles/:clientId` | Profile markdown |
| `GET /api/usage`, `GET /api/health` | Cost log summary, liveness |
| `WS /api/voice` | See section 6 |

**Speech service:** `WS /stt` (binary PCM16, 16 kHz mono in; JSON `speech_start | partial | final` out). `POST /tts` `{ text }` → streamed PCM16.

**Profile file format** (`poc/data/profiles/<slug>.md`): fixed headings: `# <Client>`, `## Also known as`, `## Key contacts`, `## Active projects`, `## Commitments: we owe`, `## Commitments: they owe`, `## Preferences and quirks`, `## Recent decisions`, `## Change log`.

---

## 5. Claude usage

One wrapper, `poc/packages/brain/src/claude.ts`, makes every call. It logs usage and is the only file that names a model. Model ids live in `models.ts`.

| Call | When | Model | Output | Notes |
|---|---|---|---|---|
| **Triage** | Each new mail, chat message, typed or spoken item | `claude-sonnet-5-5`, effort `low` | Structured: `{ clientId|null, confidence, nudge, tasks: [{ title, direction, taskType, dueDate|null, duplicateOf|null }], meetingRequest: boolean, profileEdits: [...] }` | Tagging, extraction both ways, dedupe and profile edits in **one** call, to keep cost at one call per message. Code pre-matches on sender domain, contact email and nickname, then includes only the candidate clients' profiles. The client's open tasks and pending suggestions are included for dedupe. |
| **Prioritise** | Task list, calendar or suggestions change (debounced, hash-skipped) | `claude-sonnet-5-5`, effort `low` | Structured: `{ order: [{ taskId, quickWin, reason }], fitNow: { taskId, sentence }|null }` | Free gaps are computed in code and passed in. |
| **Prepare work** | Task approved, or "regenerate" | `claude-opus-5-5`, effort `medium`, set explicitly | Structured `PreparedWork` plus `nextStep` | File review sends the file (PDF as a document block). Meeting slots come from code; Claude writes the reply. |
| **Chat and voice** | Each user turn | `claude-haiku-5-5`, effort `low`, streaming | Text plus tool calls | Tools: `list_tasks` and `list_clients` (read, run at once) and `propose_*` tools that only create suggestions. One model for the whole conversation, so thinking blocks never cross models. History is append-only. |
| **Profile update** | Folded into triage. A separate small call after an approval only when needed. | `claude-sonnet-5-5` | Structured edits: `{ section, op: 'add'|'replace'|'remove', text }` | Code applies the edits and appends to `## Change log`. The file is re-read on every call, so hand edits are respected. |

**Structured outputs.** `client.messages.parse()` with `output_config: { format: zodOutputFormat(Schema) }` from `@anthropic-ai/sdk/helpers/zod`. Do **not** use forced `tool_choice`; it is rejected on `claude-opus-5-5` and `claude-sonnet-5-5`. Keep schemas flat and simple.

**Thinking and effort.** Do not send `budget_tokens` or sampling parameters. Set `output_config.effort` explicitly on every call, because defaults differ by model.

**Always check `stop_reason`** before reading content: handle `refusal` and `max_tokens`.

**Prompt caching.** Order: tools → stable system prompt → client roster → profile(s) → the message. Cache breakpoints go after the roster and after the profile. No timestamps or ids in the cached part; "now" goes in the user message. Check `usage.cache_read_input_tokens` is above zero on the second call. Caches are per model.

**Token and cost logging.** Every call appends one line to `poc/data/logs/usage.jsonl`: `{ ts, call, model, sourceId, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens, ms, estUsd }`. Prices sit in one config table. `/api/usage` totals by call type and day. The sidebar footer shows today's total.

**Verify against docs at build time**

- That `zodOutputFormat` works with zod 4, which this repo uses.
- Minimum cacheable prompt length per model (believed to be 512 tokens on these models) and the `ttl: "1h"` option. Demo messages are minutes apart, so the 5-minute default may miss.
- Whether `thinking: { type: "disabled" }` is accepted on `claude-haiku-5-5` at effort `low`, and its measured time to first token. If Haiku cannot hold the conversation well enough, try `claude-sonnet-5-5` with `thinking: { type: "between_tools" }`.
- Server-side refusal fallbacks (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) on the Opus and Sonnet calls, and whether they combine with `messages.parse`. `claude-haiku-5-5` has no server-side fallback.
- `eager_input_streaming` on streamed tool definitions, and validating each tool input before use.
- Current prices for the cost table.
- That the SDK honours `ANTHROPIC_BASE_URL` for streaming through the gateway.

---

## 6. Live voice

Claude's API does not do speech. Something else must turn audio into text and text into audio.

| Option | Speed and quality | Fits "only Claude outside"? | Notes |
|---|---|---|---|
| **A. Browser Web Speech API** | Recognition is good. The voice is the operating system's: instant but robotic. | **No, by default.** Chrome's recognition sends audio to Google. An on-device mode may exist; verify at build time. Synthesis is on-device. | Least code. Chrome and Edge only. Little control over barge-in. |
| **B. Local models in the sandbox** | Streaming recognition runs in real time on a laptop CPU. Accuracy is good on clear speech, weaker on names. The voice is decent and starts in roughly 100 to 300 ms per sentence. | **Yes.** | A larger image (models baked in). Uses CPU. Docker on Windows or Mac runs in a VM with no GPU. |
| **C. Third-party speech service** | Best accuracy, voice and latency. | **No.** Audio and text leave the sandbox to a second vendor. | Needs another key and another data-handling review. |

**Recommendation: B**, behind the `SpeechToText` / `TextToSpeech` interfaces, so C can be swapped in for V1 if quality demands it. The browser's own voice is kept as a text-to-speech fallback behind the same interface. **This is the user's decision (Question 1).**

**How the loop works**

1. The sidebar captures the microphone (`getUserMedia`, echo cancellation on) and streams 20 ms PCM frames over `WS /api/voice`.
2. The brain forwards frames to `speech` `/stt`. Partial transcripts are shown live in the chat box.
3. On a `final` transcript (after about 300 to 500 ms of silence), the brain runs the **same chat pipeline as typed text**, in the same conversation history. That is what makes voice and text one conversation.
4. Claude's reply streams. The brain cuts it at sentence ends and sends each sentence to `/tts` at once. Audio frames stream to the browser, which plays them through an audio worklet queue.
5. **Barge-in.** If `/stt` reports `speech_start` while audio is playing: the brain sends `interrupted`, the browser drops its audio queue immediately, the Claude stream and the speech job are aborted, and only the text actually spoken is kept in history. Listening carries on.

**Honest latency budget:** end-of-speech detection (about 0.3 to 0.5 s) + Claude's first tokens + first sentence of speech (about 0.1 to 0.3 s). "About a second" is only possible with a fast model, thinking off, a short cached prompt and short first sentences. Stage timings are logged on every turn. If the target is missed, re-plan (try Sonnet, try Opus fast mode, or raise Question 1 again) rather than fake it.

**WS `/api/voice` protocol.** Client → server: binary PCM16 16 kHz mono frames; JSON `{ type: 'start' | 'stop' }`. Server → client: JSON `stt.partial`, `stt.final`, `assistant.delta`, `assistant.audio.start`, `interrupted`, `assistant.done`; binary audio frames.

---

## 7. Build order

Builders use `model: opus`, one focused piece each. **Phase 0 must finish first.** Pieces inside a phase run in parallel. Every item has a check; an item is not ticked until its check passes.

### Phase 0: Foundations (one builder, in order)

- [x] **0.1 Scaffold `poc/`:** workspaces, `tsconfig.base.json`, vitest, `Dockerfile.node`, `env.example`, `.gitignore` additions (`poc/data/`). *Check:* `npm --prefix poc run typecheck` and an empty test run pass; root `npm test` and `npm run build` still pass.
- [x] **0.2 Contracts package:** every schema in section 4, connector interfaces, MCP tool schemas, endpoint constants, plus a `FakeClaude` and fake connectors for tests. *Check:* unit tests parse one valid and one invalid sample of each schema.
- [x] **0.3 Seed data and `npm run poc:seed`:** the five clients, team, tasks, mail, chat, calendar relative to now, files, starter profiles, `.poc-sandbox` marker. *Check:* the seeded workspace passes `parseWorkspace`; a test scans seed text against a deny-list; a person reads the seed once for realism.
- [x] **0.4 Compose skeleton and gateway config:** networks, volumes, ports, placeholder services. *Check:* `docker compose config` is valid.

### Phase 1: Independent pieces (five builders in parallel; all depend only on Phase 0)

- [x] **1A Planr changes + `pm-server` + MCP server** (sections 2.1 to 2.3). *Checks:* root `npm test` and `npm run e2e` still pass. Unit tests for each MCP tool. `tools/list` is exactly five. The server refuses to start without the marker. A stale `rev` gives 409. Playwright: open `/?storage=server`, call `create_task` over MCP, the task appears in Planr without a reload; edit in Planr, `list_tasks` shows it. Screenshot looked at.
- [x] **1B `mocks`:** fake Graph mail and calendar, fake Zoom chat, control endpoints, control page. *Checks:* route tests for each endpoint; a dropped email appears in `listSince`; `sendMail` lands in Sent; a created event appears in `calendarView`; control page screenshot looked at.
- [x] **1C `sidebar` UI** against a fixture brain (a tiny server replaying contract fixtures). All sections, nudges, suggestion cards with Approve / Edit / Deny, the four prepared-work views plus "other", chat box, profile viewer, cost footer. *Checks:* component tests for section ordering and buttons; Playwright at 400 px wide; screenshots in light and dark looked at.
- [x] **1D `speech` service:** streaming STT with voice activity events, streaming TTS, models baked into the image. *Checks:* a fixture WAV of an invented sentence transcribes with the expected key words; `/tts` returns its first audio in under 400 ms on the build machine; the container runs with no network.
- [x] **1E Brain core:** config, `claude.ts` wrapper with usage log, connector clients, MCP client, intake loop, triage, suggestion store, approve / deny, state builder (sections from `list_tasks` + overlay), `/api/state`, SSE, `/api/input`, and a module registry that Phase 2 plugs into. *Checks:* with `FakeClaude` and fake connectors, new mail → suggestion → approve → `create_task` called once; deny calls nothing; the same message id twice gives one suggestion; **no write tool is ever called outside the approve path** (test with a spy); a usage line is written per call.

### Phase 2: Brain features (four builders in parallel; all depend on 1E; each owns its own folder under `poc/packages/brain/src/`)

- [x] **2A `prioritise/` + `calendar/`:** Today ordering, quick wins, free-gap detection, "fits before your next meeting" nudge, lunch and focus block suggestions, writing approved blocks to the calendar. *Checks:* gap maths unit tests with a fixed clock; approving a block calls `createEvent` once; unchanged input does not call Claude again.
- [x] **2B `prepare/`:** prepared work for the four task types plus "other"; meeting slot finder; approval sends the reply to the fake Sent folder and completes the task; next-step suggestion. *Checks:* one test per task type with `FakeClaude`; proposed slots never overlap seeded events; approval sends exactly one mail and makes one `complete_task` call.
- [x] **2C `profiles/`:** read, apply edits, change log, shorthand learning on a confirmed uncertain match, profile endpoints. *Checks:* edits land under the right heading; a hand edit survives the next update; a confirmed nickname appears under "Also known as" and is used by the next pre-match.
- [x] **2D `chat/` + `voice/`:** streaming chat with read tools and `propose_*` tools, `WS /api/voice`, sentence chunking, barge-in. Depends on 1D's contract only, with a fake speech service in tests. *Checks:* typed "add a task to chase Michael on Friday" gives one `create_task` suggestion with a Friday date; a simulated `speech_start` during playback aborts the Claude stream and no audio frame is sent after `interrupted`.

### Phase 3: Integration (one builder; depends on everything above)

- [ ] **3.1 Wire the sidebar to the real brain;** remove the fixture server from the runtime path. *Check:* the sidebar e2e passes against the real brain with `FakeClaude`.
- [ ] **3.2 Compose up end to end,** with `npm run poc:up`, `poc:reset`, `poc:down` and `poc/README.md`. *Check:* all health endpoints are green.
- [ ] **3.3 Isolation checks.** *Check:* from inside `brain`, `pm`, `mocks` and `speech`, a request to an outside host fails; from `brain`, a request through the gateway to Claude succeeds; the gateway refuses any other upstream; host ports listen on 127.0.0.1 only.
- [ ] **3.4 Secret checks.** *Check:* grep of the repo and built images finds no `sk-ant-`; `poc/.env` is ignored by git; logs do not print the key.
- [ ] **3.5 `poc/e2e/demo.mjs`:** the 11-step check in section 8, with live Claude. *Check:* passes three runs in a row.
- [ ] **3.6 Live prompt tuning** on the seed messages: correct client, both task directions, duplicates caught, cache hits seen, voice timings logged.

### Phase 4: Independent verification

- [ ] A separate `model: opus` agent that built nothing runs section 8 from a clean `poc:reset` and reports failures. Fix root causes, then verify again.
- [ ] Human pass on the items marked "human" in section 8.

### Phase 5: Write-up

- [ ] Add a Review section here: what works, what doesn't, measured cost per message, measured voice latency, what to do next.
- [ ] Add any user corrections to `tasks/lessons.md`.

---

## 8. End-to-end check: the 11 demo steps

Run by `poc/e2e/demo.mjs` (Playwright driving the sidebar, the Planr test copy and the control page, plus direct API calls). Claude's wording varies, so checks assert on **structure** (client id, counts, dates, state changes), never on exact sentences. Screenshots go to `poc/test-results/` and are looked at.

| # | Demo step | Automated check | Needs a human |
|---|---|---|---|
| 1 | Start the sandbox, open the sidebar | `poc:reset` then `poc:up`; all health checks green; isolation check passes; the sidebar shows every section header; the Planr test copy shows the five seeded clients and "POC sandbox (test data)" | Glance at both windows |
| 2 | Drop in a client email asking for an update and a meeting | `POST /_control/mail` with the canned Acme Tooling email from Michael Okafor; it appears in the control page Inbox | No |
| 3 | Sidebar nudges, tags the client, suggests tasks and meeting times | Within 30 s: a nudge exists that is a sentence and not equal to the subject line; suggestions have `clientId` = Acme Tooling with `confidence: 'high'`; at least one `create_task` with `taskType: 'reply_email'` and one with `'schedule_meeting'`; each carries a `source` pointing at the email id; a usage line was logged | Read the nudge: does it sound like an assistant? |
| 4 | Approve; tasks appear in Planr; list reorders | Click Approve on each; MCP `list_tasks` contains the new tasks; the Planr page shows them under Acme Tooling → Ad-hoc → General with no reload; a prioritise usage line follows the approval; Today has an `order` on every item | No |
| 5 | A Zoom message gets the same treatment | `POST /_control/chat` with a message that says only "Harbor" and names a file; the suggestion is tagged Harborlight Freight and links to the chat message. A second message that names no client gives a `confirm_client` item in **Inbox**. Dropping the step-2 email again creates **no** new suggestion. A reworded repeat of the same ask gives a suggestion with `duplicateOf` set. One seeded message yields an `owed_to_me` task. | No |
| 6 | Say "add a task to chase Michael Friday" | A WAV of that sentence (made once by the sandbox's own text-to-speech, plus one recorded by a person if available) is streamed into `WS /api/voice`; the final transcript contains "chase" and "Friday"; a `create_task` suggestion appears with `taskType: 'follow_up'`, client Acme Tooling, due the coming Friday; approve; it is in `list_tasks`. A second run uses Chromium's fake-microphone flags to cover the browser capture path. The typed version of the same sentence is also checked. | Say it into a real microphone once |
| 7 | Spots a free hour, suggests what to work on, offers lunch; approve lunch | With the seeded calendar: a nudge whose `fitNow.taskId` is an open Today task and whose text mentions the next meeting; a pending `calendar_block` suggestion for lunch, 30 minutes long; approve; `GET /v1.0/me/calendarView` now contains the event; the control page Calendar tab shows it | No |
| 8 | Click the top task; prepared work opens; approve; next step lines up | Click the first Today item; the prepared-work panel renders the right type; approve; the task is `done` in `list_tasks` and ticked in Planr; a new pending suggestion with a "next step" source appears within 30 s | Judge the draft's quality |
| 9 | Repeat for each of the four task types | **Reply:** draft has recipient, subject and body; approve → one new item in fake Sent. **Meeting:** at least two slots, none overlapping calendar events, plus a draft; approve → Sent. **File review:** shows the file path, a summary and at least three key points; approve → the next step is a follow-up email suggestion. **Follow-up:** a chaser draft addressed to the quiet contact; approve → Sent. Also: Edit changes the draft and the edited text is what gets sent; Deny sends nothing. One "other" task opens with gathered context. | Judge the quality of each |
| 10 | Interrupt mid-sentence by voice | Ask a question with a long answer; after the first audio frame, stream a speech WAV; assert `interrupted` arrives within 500 ms, no audio frames follow it, the Claude stream was aborted (logged), and the next utterance is transcribed and answered | **Yes.** Interrupt out loud, on speakers and on a headset. Confirm it stops and listens, and that speech starts within about a second. |
| 11 | Open a client profile; it reflects what happened | `GET /api/profiles/<acme>`: "Commitments" mentions the update and the meeting; "Change log" has entries newer than the run start; the nickname confirmed in step 5 is under "Also known as" in the right client's file; a line hand-added to the file before the run is still there | Open the `.md` file in a text editor and read it |

**After the run, also assert**

- `usage.jsonl` has a line for every Claude call, and at least one has `cache_read_input_tokens` above zero.
- Total run cost is printed.
- No request left the sandbox except to the gateway's Claude listener (gateway access log).
- Planr was never written except through MCP calls that followed an approval (compare the MCP call log with the approval log).
- No browser console errors.

---

## 9. Constraints carried into the build

- **Do not build:** morning briefing; end-of-day wrap-up or weekly review; pulling data and reports together or Slide Factory drafts; automatic chasers (follow-up tasks are only created by the user or from a message, and the brain never detects silence on its own); meeting prep rundowns; focus mode; mirroring client tags to Outlook.
- **No real systems.** No Outlook, Zoom, file server or live Planr data. No real hostnames or credentials in config. `pm-server` refuses to start without the `.poc-sandbox` marker.
- **Fake, invented data only,** in seed files, tests, comments and commit messages. Domains end in `.example`. Before each commit, scan the staged diff for names (per `tasks/lessons.md`).
- **Nothing is sent or changed without approval.** The only code paths to `sendMail`, `createEvent`, `create_task`, `complete_task` and `reschedule_task` run from the approve endpoint. A test enforces this. Profile files and Today's order are the assistant's own notes and update without approval, as the brief describes (confirm in Question 8).
- **API key from the environment only:** `poc/.env`, gitignored, passed by compose. Never in an image, a log, a test or a commit.
- **Only Claude is reachable outside the sandbox,** enforced by the Docker network and checked by a test.
- **Touch Planr as little as possible:** only the files in section 2.1. Root `npm test`, `npm run e2e` and the Pages deploy keep working.
- **Work stays on branch `claude/ai-work-assistant-poc-bg4nke`.** No merge to `main` until the user says so (a merge deploys to GitHub Pages).
- Look at screenshots of what the user will see before marking any visual piece done.
- If something goes sideways, stop and re-plan.

---

## 10. Risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| **Voice latency and quality on a laptop CPU inside Docker** | The most likely place to go sideways. Local speech may be slow, or may mishear names. "About a second" is tight. | Measure in 1D before building on it. Log stage timings. Keep the browser voice as a fallback. Be ready to revisit Question 1. |
| **Barge-in false triggers** | The assistant's own voice can re-enter the mic and interrupt itself. | Echo cancellation on, a minimum speech length before interrupting, and a headset for the demo. |
| **Docker not allowed, or the laptop is too small** | The whole sandbox depends on it. The speech image needs spare RAM and CPU. | Ask IT now (Question 2). The same services also run as plain local processes for development, but without network isolation. |
| **Planr's whole-document save vs MCP writes** | A stale Planr tab could overwrite a task the assistant just added. | `rev` check gives a 409 and the existing conflict banner; Planr auto-reloads when it has nothing unsaved. Tested in 1A. |
| **Claude output varies run to run** | Flaky end-to-end checks; wrong client tags on vague chat messages. | Structural assertions, structured outputs, deterministic pre-match, low-confidence items go to Inbox, three green runs required. |
| **Cost creep** | Re-ordering on every change, or a loop, burns tokens. | Debounce, input hash, prompt caching, a daily spend cap that halts calls, cost shown in the sidebar. |
| **Claude API details differ from this plan** | Parameters and limits change. | Everything unsure is listed under "verify against docs at build time" in section 5. One wrapper file to fix. |
| **Email text steering the assistant** | A message could say "mark everything done". | Claude can only propose. Every action needs a click. |
| **Scope creep into the exclusions** | "Follow up" drifts into auto-chasers; "context gathered" drifts into meeting prep. | Section 9 list; the verifier checks for it. |
| **Parallel builders colliding** | Four builders in the brain package. | Contracts fixed in Phase 0; one folder per builder; the registry from 1E is the only shared file. |
| **Public repo** | Everything committed is public. | Invented data only, name scan before commits, key never committed. |

---

## 11. Questions for the user

Each has a recommended answer. The build can start on the recommendations if you agree.

1. **Voice: where does speech run?** Local models in the sandbox, the browser's built-in speech, or a third-party service? A third-party service gives the best voice but breaks "only Claude outside the sandbox". **Recommend: local models in the sandbox,** swappable later.
2. **Is Docker Desktop approved by IT, and what is the laptop** (Windows or Mac, RAM, CPU)? It decides the speech model size. **Recommend: confirm before Phase 1.** Need roughly 8 GB free RAM and 4 cores.
3. **Client fields in Planr.** OK to add `emailDomains`, `contacts`, `fileFolder` and `nicknames` to Planr's client schema with empty defaults and **no editing screen** for now? They would exist (empty) in the live app's data too. **Recommend: yes.**
4. **On hold, Internal and source links.** Planr has none of these. Keep them in the assistant's own overlay for the POC, with "Internal" as a seeded client, or add fields to Planr now? **Recommend: overlay now, Planr fields in V1.** This means "On hold" shows in the sidebar but not in Planr.
5. **Where approved tasks land in Planr.** **Recommend:** the client's Ad-hoc area, deliverable "General", assigned to you. Matching tasks to a specific meeting's deliverable is left for V1.
6. **Models and cost.** OK with Sonnet for triage and ordering, Opus for drafting and file review, Haiku for the live conversation, and a daily spend cap? **Recommend: yes, cap at $5 a day,** then adjust from the logged numbers.
7. **How far ahead should the sidebar go?** **Recommend:** through "Next week +2", as in the brief. Undated tasks go to Inbox.
8. **What may run without approval?** **Recommend: nothing external.** The assistant updates its own client profile files and re-orders Today without asking, since those are its notes. Is that acceptable?
9. **Sidebar form.** OK to demo in a Chrome app-mode window at sidebar width, with a desktop shell (Tauri) after the POC? **Recommend: yes.**
10. **File types on the fake file server.** **Recommend:** text, markdown, CSV and PDF only. Word and Excel wait for V1.
11. **Where the POC code lives.** This repo is public. **Recommend:** `poc/` on this branch, invented data only, not merged to `main` until you say so.
12. **Users and delegation.** **Recommend:** one user ("Alex Rivera") and no delegation in the POC.
13. **Client contracts and cloud AI** (from the brief). Not blocking: the POC only ever sends invented data to Claude. It must be answered before V1.

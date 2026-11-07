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

Status: **DRAFT — awaiting approval**

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
- [ ] Pure `model/week.ts`: week start (Monday), days, task/meeting bucketing (rows, weekend → Friday, overdue) — unit tests
- [ ] Route `#/week[/<monday>]`; "This week" sidebar item with an open-task badge for me
- [ ] Week page: header (week label, ‹ Today ›, viewing-as picker, weekend + hide-done toggles)
- [ ] Grid: Overdue column + day columns × (Meetings band, My work, Others) + "Next week →" drop zone
- [ ] Task chip: logo, name, x/y; hover card; checkbox; click → client page with highlight
- [ ] Drag & drop between days / to next week (dnd-kit, one DndContext for the grid)
- [ ] Add task on a day: popover (client → meeting/Ad-hoc → deliverable → name)
- [ ] First-run "who are you?" picker
- [ ] Key tasks: schema default, toggleKey, star on cards and calendar chips, gold styling (light and dark)
- [ ] Kickoff dates: schema default, meeting-header control, calendar chips (check, drag, overdue), timeline flag
- [ ] e2e: pick me, check off, drag to a day, push to next week, add task, click through
- [ ] Screenshot review in light and dark, then republish the hosted page with your data

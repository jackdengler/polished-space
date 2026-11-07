# Project Management App — v1 Plan (Client Pages)

Status: **DRAFT — nearly final, awaiting approval**

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
- **Meeting page** (below the timeline; the URL updates so it can be linked or bookmarked):
  - Header: meeting date (flex), title, overall progress.
  - **Deliverables as columns** side by side (scroll sideways when there are many), with title and progress in each header.
  - **Tasks as cards** in each column: done checkbox, title, assignee initials, due date (overdue highlighted).
  - Subtasks: a small checklist that expands on the card (title + checkbox only), with a count shown ("2/3").
- Add or edit anything inline. Delete with confirmation. Use keyboard (Enter to add the next item, Esc to cancel).
- Team settings: add or edit team members (name, color).

---

## Build checklist

- [ ] Scaffold Vite + React + TS, linting, `npm run build` / `dev`
- [ ] Zod schemas and types for the data model, plus a schema version
- [ ] FlexDate parser, formatter and sort key, with unit tests (Vitest)
- [ ] Store with named actions, plus unit tests
- [ ] `StorageAdapter` interface, plus `LocalFolderAdapter` (File System Access API) and an in-memory/IndexedDB fallback for testing
- [ ] Welcome screen: "Open folder" / "Create new workspace"
- [ ] Sidebar with client list, search and new client
- [ ] Client header: logo upload, team chips, planned-through date
- [ ] Meeting timeline (today + planned-through markers, flex-date bands)
- [ ] Meeting page: deliverable columns, task cards, subtask checklist; inline create, edit and delete
- [ ] Done toggle, assignee and due-date controls; overdue styling; derived progress
- [ ] Team members settings (shared list); client team picker; assignee picker with search
- [ ] Drag to reorder tasks within a column and to reorder columns (dnd-kit)
- [ ] Light/dark theme tokens (follows system)
- [ ] Autosave and a save-status indicator; handle a folder permission prompt on reload
- [ ] Playwright smoke test: create client → meeting → deliverable → task → subtask, reload, data persists
- [ ] Update README (setup, privacy: data stays local)

## Decisions log
- Stack: TypeScript + React + Vite. Rust considered; possibly later for the server or a Tauri desktop wrapper.
- Client page: meeting timeline at top → click opens that meeting's page.
- Meeting page: deliverable columns with task cards.
- Done/not done only. Subtasks are a title + checkbox. Deliverables get progress only from their tasks.
- No notes. No extra views (My tasks etc.). Templates later.
- Team: one shared company list managed in settings. Clients pick their team from it.
- Assignee picker: shows the client's team first, plus a search to find anyone in the company.
  Picking someone from outside the team does not add them to the client's team.
- Drag & drop: reorder tasks within a column, and reorder deliverable columns. Tasks do not move between columns.
  Clients in the sidebar are sorted alphabetically.
- Style: clean and minimal (Linear/Notion-like): white, subtle grays, one accent color. Dark mode follows the system setting.

## Later (not v1)
Meeting templates / duplicate · My tasks & upcoming views · server sync · mobile · AI assistant · notes

## Open questions
See the chat.

## Review
_(filled in after the build)_

# Project Management App — v1 Plan (Client Pages)

Status: **DRAFT — awaiting approval**

## Goal
Track timelines and statuses of client work. A left sidebar lists clients; each
client page shows its info at the top, then its work organized as
**Meetings → Deliverables → Tasks → (optional) Subtasks**.

v1: one user, desktop browser, data saved as files on your own computer.
Later: a self-hosted server for secure multi-user live sync, a mobile layout, AI and API integrations.

---

## Recommended setup

| Layer | Choice | Why |
|---|---|---|
| App | **React + TypeScript + Vite** | The standard modern stack. Types keep the data model honest as it grows. The same code can later be wrapped for desktop or mobile. |
| Styling | Plain CSS with design tokens (CSS variables) | No framework lock-in. Easy to make responsive later. |
| State | A small store (Zustand), with every change made through named actions (`addTask`, `setStatus`, …) | Named actions are what later becomes the sync protocol and what AI tools call. |
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
             └─ tasks[]            { id, title, assigneeId, dueDate, status }
                 └─ subtasks[]     { id, title, assigneeId?, dueDate?, status }  (optional, personal tracking)
```

**FlexDate** is either an exact date or a broader period, typed freely and parsed:
- `10/28/26` → exact date 2026-10-28
- `Nov 2026`, `Q4 2026`, `Fall 2026`, `2026` → period, stored with a start and end so it can be sorted
- Meetings are sorted chronologically by start date. A period sorts by its start.

**Status** (tasks and subtasks): Not started · In progress · Blocked · Done.
Deliverable and meeting progress is **derived** from their tasks (e.g. "3/5 done"), never entered by hand.

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
- **Work area:** meetings in date order, each a collapsible section.
  - Meeting row: date (flex), optional title, progress.
  - Deliverables inside: title, progress bar.
  - Tasks inside: checkbox/status, title, assignee chip, due date (overdue highlighted).
  - Subtasks: expandable under a task, same fields, visually lighter.
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
- [ ] Meetings → Deliverables → Tasks → Subtasks: inline create, edit and delete
- [ ] Status, assignee and due-date controls; overdue styling; derived progress
- [ ] Team members settings
- [ ] Autosave and a save-status indicator; handle a folder permission prompt on reload
- [ ] Playwright smoke test: create client → meeting → deliverable → task → subtask, reload, data persists
- [ ] Update README (setup, privacy: data stays local)

## Open questions
See the chat — answers get folded in here before the build.

## Review
_(filled in after the build)_

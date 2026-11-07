# Compensian PM

A project tracker for client work. Clients are listed in a left sidebar. Each client page shows
the client's info, a **timeline of meetings**, and the selected meeting's work as
**deliverable columns → task cards → optional subtasks**. Each client also has an
**ad-hoc** area for work that isn't tied to a meeting.

Your data stays on your computer, in a folder you choose (a OneDrive folder works). Nothing is uploaded.

## Use it

- **Online:** <https://jackdengler.github.io/polished-space/> (in Chrome or Edge), once Pages is set up (see below).
- **Locally:**
  ```bash
  npm install
  npm run dev
  ```
  Then open the printed URL in Chrome.

On first open, either pick a workspace folder (empty folders can start blank or with demo data),
or click **Try the demo** to explore sample data without saving anything.

### Workspace folder

```
your-folder/
  workspace.json     all data (readable JSON, schema version 1)
  logos/             client logos
  backups/           last 20 copies of workspace.json (at most one every 5 min)
```

The app autosaves shortly after each change. If `workspace.json` changes outside the app
(for example, edited on another computer), the app stops and asks which version to keep rather
than overwriting it.

### Main views

- **Client page:**
  - Header (logo, team, planned-through).
  - Meeting timeline: Today line, kickoff flags, ad-hoc due dots.
  - The selected meeting's deliverable columns, task cards and subtasks.
- **This week:**
  - Your work across all clients and your teammates' work at your clients.
  - Overdue items, plus meetings and kickoffs.
  - Drag a task to another day or to "Next week", check it off, or add a task on a day.
- **Key tasks:** star a task to highlight it in gold, for you only.

### Tips

- **Dates** can be exact (`10/28/26`) or broad (`Nov 2026`, `Q1 2027`, `H2 2026`, `Fall 2026`, `Early 2027`, `Late Nov 2026`, `2026`).
- **Undo/redo:** Ctrl+Z / Ctrl+Shift+Z (or the arrows next to the app name).
- **Workspace menu** (under the app name): Team, Import clients, Theme (System / Light / Dark), and Switch folder.
- **"Me":** the calendar asks which team member you are once per device.
- **Reorder:** drag task cards within a column, and drag columns by their ⋮⋮ handle.
- **Timeline cues:**
  - An amber dot marks a past meeting with open tasks.
  - Meetings after "planned through" are faded.
  - Dots under the timeline are ad-hoc tasks with due dates (red when overdue).

### Hosted demo

`npm run build:artifact` packs the app into one self-contained HTML file (`artifact/compensian-pm.html`) for hosting as a single page.
When the app runs embedded like that:
- it offers only the demo, since embedded pages can't open folders
- demo changes are saved in that browser's local storage

## Development

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm test` | Unit tests (date parsing, store actions, timeline scale, demo data) |
| `npm run e2e` | Builds the app and drives it in Chromium: creates a client → meeting → deliverable → task → subtask, drags, undoes, reloads and checks that everything persisted. Screenshots go to `test-results/`. |
| `npm run build` | Typecheck and production build to `dist/` |

**Stack:** React + TypeScript + Vite, Zustand + Immer store, Zod schemas, dnd-kit.

**Layout:**
- `src/model/`: data model (Zod), flexible dates, derived progress, timeline scale, demo data
- `src/store/store.ts`: every change is a named action (`addTask`, `toggleTask`, …) with undo history.
  These actions are the hook for future server sync and AI/API integrations.
- `src/storage/`: the `StorageAdapter` interface, with these implementations:
  - `FolderAdapter`: a local folder via the File System Access API
  - `MemoryAdapter`: the demo
  - a future `ServerAdapter` will plug in here without changing the UI
- `src/components/`: UI

## GitHub Pages setup (one time)

The site is built by GitHub Actions. In **Settings → Pages**, set **Source** to **GitHub Actions**.
Every push to `main` then tests, builds and deploys.

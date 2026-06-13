# polished-space

The apartment chore split for two people — **The Chore Split**. A single-file
static web app, served by GitHub Pages. This repo (and what's served from
GitHub Pages) is **public** — but your data lives in a separate **private**
repo, [`private-data-storage`](https://github.com/jackdengler/private-data-storage),
read/written via the GitHub Contents API using a token you paste once per device.

## What it does

- Sectioned chore checklists (Daily / As needed / Weekly / Monthly).
- Assign each task to **Jack**, **Jordan**, or **Both** — a balance beam shows
  who's carrying more.
- Open a task to set its standard: steps start maximal, tap × to cut what you
  don't do, or add your own. Tick steps off as you clean.
- Copy or download a plain-text snapshot anytime.

## How it works

- Open the app → paste a fine-grained GitHub Personal Access Token once per device.
- The app reads/writes `chore-split.json` in the **private** `private-data-storage` repo.
- Assignments and checked-off steps are saved (debounced) on every change, so
  both phones stay in sync. Each save is a commit in `private-data-storage`.
- The token is stored only in your browser's `localStorage` and only sent to `api.github.com`.
- Both devices poll every 30s, so changes show up on the other person's phone.

## Setup

1. **Enable GitHub Pages** for this repo (Settings → Pages → Source: `main` branch, `/` root).
2. Visit `https://jackdengler.github.io/polished-space/`.
3. Create a **fine-grained PAT** at <https://github.com/settings/personal-access-tokens/new>:
   - Resource owner: `jackdengler`
   - Repository access: *Only select repositories* → `private-data-storage`
   - Permissions → Repository → **Contents: Read and write**
   - Pick a short expiry (e.g. 90 days)
4. Paste the token into the app on first load.

The `chore-split.json` data file is created automatically on first save.

## Privacy notes

- The app code is public; chore data is not.
- The token is scoped to only `private-data-storage` with Contents read/write — not your whole account.
- The token never leaves your browser except in `Authorization: Bearer …` calls to `api.github.com`.
- Lost device → revoke the token at <https://github.com/settings/tokens?type=beta>.

# polished-space

A tiny chore tracker for two people. Static web app, served by GitHub Pages, with data stored in `chores.json` in this repo (read/written via the GitHub API).

## How it works

- Open the app → paste a GitHub Personal Access Token once per device.
- The app reads/writes `chores.json` through the GitHub Contents API.
- Both devices poll every 30s so changes show up on the other person's phone.

## Setup

1. **Enable GitHub Pages** (Settings → Pages → Source: `main` branch, `/` root).
2. Visit `https://jackdengler.github.io/polished-space/`.
3. Create a **fine-grained PAT** at <https://github.com/settings/personal-access-tokens/new>:
   - Resource owner: `jackdengler`
   - Repository access: *Only select repositories* → `polished-space`
   - Permissions → Repository → **Contents: Read and write**
4. Paste the token into the app on first load. Pick who you are.

Each completed chore creates a commit in this repo — that's the "sync."

# AI Work Assistant: proof of concept

An assistant that reads fake email, chat, calendar and client files, turns them
into suggested tasks, prepares the work, and only changes anything after you
approve it. Everything here is **invented test data**. Nothing connects to real
Outlook, Zoom, the file server or the live Planr data. Only Claude sits outside
the sandbox.

| What | Where |
|---|---|
| Sidebar (task list, nudges, chat, voice) | http://localhost:5180 |
| Planr test copy (its own test database) | http://localhost:5181/?storage=server |
| Control page (fake Outlook and Zoom: drop messages, see Sent and the calendar) | http://localhost:5182 |

There are two ways to run it:

- **With Docker (the real sandbox).** Each service runs in its own container on a
  network with no internet. Only the gateway can reach the internet, and only
  `api.anthropic.com`.
- **Without Docker (local processes).** Same services, same ports, for
  development or when Docker is not available. **No network isolation.**

## Prerequisites

- Node.js 22 or newer, and npm.
- Google Chrome (for the sidebar window).
- For the Docker path: Docker Desktop (ask IT first). About 8 GB of free memory
  and 4 CPU cores. The first build downloads the speech models (about 150 MB).
- A Claude API key (Anthropic Console).

Install once, from the repository root:

```sh
npm ci                  # Planr itself (pm-server reuses its schema; builds the test copy)
npm --prefix poc ci     # the POC packages
```

For the no-Docker path, also download the speech models once (about 150 MB, kept
in a gitignored folder):

```sh
npm --prefix poc run models -w @poc/speech
```

## The API key

Copy `poc/env.example` to `poc/.env` and put your key in it:

```sh
cp poc/env.example poc/.env
# then edit poc/.env:  ANTHROPIC_API_KEY=<your key>
```

`poc/.env` is ignored by git and is never committed. Only the brain receives the
key. The scripts never print it. Check this at any time:

```sh
npm --prefix poc run check:secrets
```

Without a key everything starts, but every Claude call fails with a clear
message in the sidebar.

The brain sends Claude requests to `POC_CLAUDE_BASE_URL` only (Docker sets the
gateway; the local path defaults to `https://api.anthropic.com`). It never reads
`ANTHROPIC_BASE_URL`, so a setting from another tool in your shell cannot
redirect it.

## Run it with Docker

```sh
npm --prefix poc run up       # seed if needed, build the images, start, wait until healthy
npm --prefix poc run reset    # stop, start again from a fresh seed (the usual way to restart a demo)
npm --prefix poc run down     # stop (your data in poc/data stays)
```

Then check the isolation on the laptop (it needs the running sandbox):

```sh
sh poc/scripts/check-isolation.sh
```

It checks that no service container can reach the internet, that the brain
reaches Claude only through the gateway, that the gateway forwards to nothing
else, and that the ports listen on 127.0.0.1 only.

## Run it without Docker

```sh
npm --prefix poc run dev:up                 # seed if needed, build, start; Ctrl+C stops everything
npm --prefix poc run dev:up -- --detach     # same, in the background
npm --prefix poc run dev:reset              # stop, fresh seed, start (in the background)
npm --prefix poc run dev:down               # stop what dev:up started
```

Logs go to `poc/data/logs/<service>.log`. Options after `--`: `--now=<ISO time>`
fixes the sandbox clock, `--skip-build` reuses the last build.

`--claude-standin` (with `dev:up` or `dev:reset`) runs against a **scripted
test stand-in** instead of Claude (canned answers, no key needed). It is only
for trying the plumbing and is never used unless you ask for it. The stand-in
runs as its own process (port 7999), so `dev:reset -- --claude-standin` also
returns and runs in the background; `dev:down` stops it with the rest.

**What a reset does to the data and logs.** `reset` / `dev:reset` replace
`poc/data` with a fresh seed: Planr, the fake mailbox, calendar and chat, the
client profiles, the assistant's suggestions, nudges and conversation, and the
service logs (`<service>.log`) all start again. The Claude cost log
`poc/data/logs/usage.jsonl` is **kept**, so cost history (and today's spend cap)
survives a reset.

## Open the sidebar at the right edge of the screen

Open it as a Chrome app window, about 400 pixels wide, pinned to the right.

**macOS** (for a 1512-pixel-wide screen; use your screen's width minus 400):

```sh
open -na "Google Chrome" --args --app=http://localhost:5180 --window-size=400,982 --window-position=1112,0
```

**Windows** (PowerShell, for a 1920-pixel-wide screen):

```powershell
& "C:\Program Files\Google\Chrome\Application\chrome.exe" --app=http://localhost:5180 --window-size=400,1040 --window-position=1520,0
```

**Linux:**

```sh
google-chrome --app=http://localhost:5180 --window-size=400,1040 --window-position=$(( $(xdpyinfo | awk '/dimensions/{print $2}' | cut -dx -f1) - 400 )),0
```

The first time you press the microphone button, Chrome asks for microphone
access: allow it. `localhost` counts as a secure page, so voice works.

Open the Planr test copy and the control page in ordinary browser tabs.

## The demo, step by step

Start from a fresh seed (`npm --prefix poc run reset`, or `dev:reset`), during a
weekday working day: the seed puts a free hour before your next meeting, counted
from the moment you seed.

1. **Start and open.** Open the sidebar window, the Planr test copy and the
   control page. The first time, Planr asks **"Which team member are you?"**:
   choose **Alex Rivera** (the sandbox user; the assistant files every task for
   Alex). The sidebar shows every section (Inbox, On hold, Overdue, Today, ...).
   Planr shows five clients and "POC sandbox (test data)". The green dot in the
   sidebar header means it is connected to the assistant.
2. **Drop in a client email.** On the control page, under *Demo messages*, click
   **"Michael Okafor (Acme) asks for an update and a meeting"**. It appears in
   the control page's Inbox.
3. **The nudge.** Within a few seconds the sidebar shows a plain-English nudge
   ("Michael just asked where ... Want me to draft a reply with some times?").
   Click **Review 2**: a reply task and a meeting task, both tagged Acme Tooling
   Co. and both **due today** (Claude schedules what you owe; a reply someone is
   waiting on is due today). The meeting card already lists **three free times**
   that fit Michael's ask (worked out from your calendar). Click the **email
   chip** on a card to read Michael's original email (sender, time, subject,
   text); Escape closes it.
4. **Approve.** Click **Approve** on each. They appear in the Planr test copy
   (Acme Tooling Co. > Ad-hoc > General) without a reload. In the sidebar they
   land in **Today**, which re-orders (for example the quick reply moves up,
   marked *Quick win*). Each task's envelope button opens its source email.
5. **A Zoom message.** On the control page click **"Priya mentions "Harbor" and a
   file to review (Zoom)"**: a file-review task tagged Harborlight Freight, due
   before Priya's Thursday deadline. Click **"Marcus mentions "the robo team""**:
   no client is named, so a "Which client?" card lands in **Inbox** (it says
   which client approving assigns when there is one candidate, or offers a
   picker); approve it to teach the assistant the shorthand. Click **"Michael
   repeats the step 2 ask"**: the cards say *Possible duplicate*; deny them.
   **"Dmitri promises the updated census"** gives an *owed to me* task. A client
   email with nothing to act on still shows a quiet **FYI** nudge linking to it.
6. **Voice.** Press the microphone and say "add a task to chase Michael Friday".
   Your words show as you speak; the task appears, tagged Acme and due Friday.
   On a Friday, "Friday" means **next week's** Friday. Approve it. (Saying the
   same thing twice gives a second card marked *Possible duplicate*.)
7. **Free time.** The green nudge says how long you have before your next
   meeting (worked out from the calendar, e.g. "You've got 1 hour 40 minutes
   before your 3:30pm ...") and what to work on. A *Calendar block* card offers
   30 minutes for lunch: approve it and look at the control page's **Calendar**
   tab. The free-time nudge is then recalculated (or withdrawn when less than
   30 minutes are left). A second *Calendar block* card offers **focus time**
   for the Harbor file review.
8. **Prepared work.** Click the top task in Today (usually the reply). Its
   prepared work opens. Approve it; the next step lines up underneath (no page
   reload).
9. **The four task types.** Open each and approve; each one lines up a next
   step:
   - the reply task: a drafted reply (approve sends it; see the control page's
     **Sent** tab); next step: a small task for what the reply promised;
   - the meeting task: the same times the card showed (still free), and a
     drafted reply (try **Edit**, put a time in, then **Approve with changes**);
     next step: "Send Michael the calendar invite once he confirms a time";
   - the Harbor file review: the file itself, a summary and key points; next
     step: an email to the client with your notes;
   - the "chase Michael" task: a drafted chaser that answers the email he has
     gone quiet on (sent days ago, not the reply you just sent); next step: a
     task to check for his reply in two working days (never an automatic
     chaser).

   **Deny** on prepared work discards the draft and offers to prepare a new one.
10. **Interrupt.** Ask "tell me about my day" by voice and talk over the answer.
    It stops at once and listens. (Use a headset, so it does not hear itself.)
11. **The profile.** Click **Client profiles** > **Acme Tooling Co.** It now lists
    the update and the meeting under *Commitments* (only approved tasks become
    commitments; denied suggestions never do), and the change log shows what
    just happened and from which email. The same file is
    `poc/data/profiles/acme-tooling-co.md`: open it in a text editor; your own
    edits there are kept.

The footer shows today's Claude cost. Every call is logged in
`poc/data/logs/usage.jsonl`. The Chat tab keeps the conversation (typed and
spoken) across a page reload.

### Deliberate deviations from the brief

- **Typed or spoken tasks with a date go to their day, not Inbox.** The brief
  says Inbox holds "anything typed or said". A dated task ("chase Michael
  Friday") is filed under that day, because that is where you will look for it;
  undated typed or spoken tasks still land in Inbox.
- **Claude proposes due dates for what you owe** (decision pending your
  confirmation). Switch it off with `POC_TRIAGE_DUE_DATES=0` in `poc/.env`:
  tasks with no stated date then stay undated (in Inbox).

### Voice: barge-in timing

Barge-in is measured from the moment you start talking over the assistant to
the moment it stops (`interrupted`). That includes the speech service's 250 ms
minimum-speech check (`STT_MIN_SPEECH_MS`, a guard against clicks and coughs),
so about 250 ms of it is deliberate. Measured on the 4-core development
container (no Docker, scripted stand-in for Claude, 24 runs in one e2e run):
**min 405 ms, median 430 ms, max 441 ms**; every run kept the interrupting
sentence's first word. Speech recognition runs on the speech service's main
thread and never waits behind speech synthesis (which runs on worker threads,
one piece at a time). An earlier independent verification measured
351-1481 ms over six runs; that spread was not reproduced here, and the likely
cause is CPU contention on the machine (speech recognition, speech synthesis,
browsers and the services share four cores), so a busy laptop can be slower. The e2e check runs it `POC_E2E_BARGE_RUNS` times (default 6)
and fails if the median is over 500 ms or any run is over 600 ms
(`POC_E2E_BARGE_MEDIAN_MS`, `POC_E2E_BARGE_MAX_MS`); the spread is written to
`poc/test-results/demo/barge-in.json`.

## Checks

```sh
npm --prefix poc test                         # unit and integration tests
npm --prefix poc run typecheck
npm --prefix poc run e2e                      # the 11 steps, end to end, with the scripted stand-in (no key)
npm --prefix poc run e2e:live                 # the same against the real Claude API (uses your key; prints the cost)
npm --prefix poc run check:secrets
sh poc/scripts/check-isolation.sh             # Docker only, on the laptop
```

The end-to-end check runs the local (no-Docker) stack itself, so stop any
running copy first. Screenshots of every step go to `poc/test-results/demo/`.

## Troubleshooting

- **"port 5180 is already in use".** A copy is still running: `npm --prefix poc
  run dev:down` (local) or `npm --prefix poc run down` (Docker).
- **No suggestions appear.** Look at `poc/data/logs/brain.log` (local) or
  `docker compose -f poc/docker-compose.yml logs brain`. "Claude is not
  configured" means there is no key in `poc/.env`. "Daily Claude spend cap
  reached" means `POC_MAX_USD_PER_DAY` (default $5) was hit; raise it in
  `poc/.env` or wait until tomorrow (a reset does not clear it: the cost log is
  kept).
- **An email gave only an "FYI" nudge.** Claude found nothing for you to do in
  it (or refused to read it); open it from the nudge to check.
- **No free-hour nudge.** The seed builds the calendar around the time you
  seeded. Seed again during working hours (`reset`), or fix the clock:
  `npm --prefix poc run dev:reset -- --now=2026-11-13T13:47:00Z`. The nudge also
  goes away once less than 30 minutes are free before the next meeting.
- **Approve says "... is not a real calendar date" or "Planr refused it".**
  The edit was checked before anything was written; nothing changed. Fix the
  value and approve again.
- **Voice does nothing.** Allow the microphone in Chrome (the camera icon in the
  address bar). The speech service needs its models: `npm --prefix poc run
  models -w @poc/speech` (local path); `docker compose ... logs speech` shows
  model loading.
- **It hears itself and interrupts.** Use a headset.
- **`reset` fails with "permission denied" on Linux.** Files the containers
  wrote in `poc/data` belong to root. Remove the folder with `sudo rm -rf
  poc/data`, then `reset`.
- **The sidebar says "Connection lost".** The assistant (brain) stopped or is
  not answering: the header dot turns red within about 8 seconds, approvals are
  paused, and any action says "The assistant isn't answering right now, so
  nothing was changed." It reconnects by itself once the brain is back
  (`dev:up` / `up` again, or look at `brain.log`).

# Roadmap — ideas for what's next

Ideas are grouped by how soon they'd pay off. Each one says why it matters, using what I saw in your real data and feedback.
Nothing here is built yet; pick what you want and we'll plan it like the calendar.

## 1. Quick wins (small, high value)

| Idea | Why |
|---|---|
| **Recurring tasks** ("every month on the 20th") | Your old data has the same task recreated every month (e.g. monthly pre-bills). One recurring task would replace a dozen copies. |
| **Overdue triage** | Your week view has ~20 overdue items, many from months ago. Add "Older than 30 days (n)" collapsed, plus bulk actions: *Mark done*, *Move to this week*, *Clear due date*. |
| **Clean up duplicate people** | Merge now exists. Next, a one-screen "possible duplicates" list (e.g. names ending in "(T)", initials vs full names) with one-click merges. Needs your answer on what "(T)" meant. |
| **Quick switcher (Ctrl+K)** | Jump to any client, meeting or task by typing. Replaces the sidebar search you removed, without the clutter. |
| **Keyboard shortcuts** | `N` new task, `X` toggle done, `S` star, `←/→` change week, `T` today. |
| **Duplicate meeting** | Copy a meeting's deliverables and tasks to a new date (precursor to templates). |
| **Collapse finished columns** | Fully-done deliverables shrink to a slim "✓ Trends 2/2" column so open work stands out. |

## 2. Planning & visibility

| Idea | Why |
|---|---|
| **Team workload view** | Person × week grid of open tasks (heat map). Shows who's overloaded before a crunch. The calendar's data model already supports it. |
| **Client status report** | One click to get a clean, shareable summary for a client: upcoming meetings, what's done, what's next. Good for client calls and internal check-ins. |
| **Meeting templates** | Save a meeting's deliverable/task structure ("Annual comp review") and stamp it onto any client with dates offset from the meeting. |
| **Bring back "buckets"** | Your old tool had Internal / Active Work / Upstream / Waiting to Start on deliverables. Could return as optional tags with a filter. |
| **Staffing levels** | Keep principal / consultant / associate on team members (from the old staffing data) to filter the calendar and workload by level. |
| **Month view** | Same chips as the week, zoomed out, for planning further ahead. |

## 3. Sharing & sync (the server step)

| Idea | Why |
|---|---|
| **Company server + sign-in** | Node/TypeScript + Postgres on your own server, with company SSO. The app already talks to storage through one `StorageAdapter`; add a `ServerAdapter`. |
| **Live multi-user sync** | Every change is already a named store action, so the server can broadcast them over WebSockets. Each person keeps their own "me" and key tasks (already personal). |
| **Activity history** | Who changed what, when (your old tool had an edit log). Comes almost free once actions go through the server. |
| **Outlook/Google Calendar link** | Pull real meeting dates in, and push kickoffs and due dates out. |
| **Monday digest** | Email or Teams message each Monday: your week, overdue items, kickoffs. |

## 4. AI assist

| Idea | Why |
|---|---|
| **Natural-language add** | Type "send peer group deck to client Fri" → task on the right client with assignee and date. The store actions are already the tool list. |
| **Meeting prep brief** | For the next meeting: what's done, what's late, open questions, as a short brief. |
| **Smart rescheduling** | "Push everything not started this week to next week," or suggest new dates for overdue work based on workload. |
| **Import anything** | Paste an email or notes and get proposed deliverables and tasks to accept. |

## 5. Platform

| Idea | Why |
|---|---|
| **Phone layout** | The week as a simple day list. Installable as an app (PWA) so it opens from the home screen. |
| **Make the repo private** | You planned to. Needed before real data ever lives near the code. |
| **Hosted on GitHub Pages** | Set Settings → Pages → Source: GitHub Actions to get the full app (with folder saving) at a stable URL. |

## Open questions for you
1. What does "(T)" after a person's name mean in your old data? Same person, or something else (temp, team lead…)?
2. For recurring tasks: which ones recur, and on what schedule (monthly by date, monthly by weekday, quarterly)?
3. Who else would use this first, and would they share one workspace or each keep their own?

# Parity with the old Planr — decisions

From the user's checklist of the old app (branch `cleanup/single-user-refresh`).

## This round
- [x] **Roles:** the six roles (Principal, Sr Consultant, Consultant, Sr Associate, Associate, Unassigned), set per person in the Team/People list
- [x] **No temp concept:** strip "(T)" / "(t)" / "(?)" from names everywhere (importer + data), merging duplicates
- [x] **Staffing overview:** one row per client
  - Role columns (Unassigned only if used)
  - Active ad-hoc ✓/✗
  - Next meeting
  - Planned through (sortable)
- [x] **Smart year snapping:** "11/2" or "Mar 3" without a year → the next occurrence, with a 31-day grace for recent dates
- [x] **Copy tasks to clipboard:** `Deliverable` then `11/12 (Wed): Task` lines
- [x] **Deleting:**
  - Two-step delete (click → trash for 2s → click again) for small things: tasks, subtasks, empty deliverables
  - Confirm pop-up for big ones: client, meeting, deliverable with tasks, person

## Done next
- [x] Monthly calendar (weekdays only, drag between days, Hide done shared with the week, Only my tasks)
- [x] Due dates: type (with snapping, weekdays, today/tomorrow) or pick from a calendar
- [x] Multiple people per task; auto-matched names pick up roles

## Done
- [x] Time tracking (see tasks/todo.md)

## Next
- Load the OpenAir task list once the user pastes it (to discuss: timer, OpenAir tasks, timesheet, day timeline)

## Later / eventually
- PTO + coverage
- Templates

## Not doing (decided)
Key Tasks list view · data-request tracker · buckets board · search · sticky notes · Easter eggs · CC calendar images · per-client colors · client context (stock returns) · importing personal data (the user will re-enter it)

## Open question
- **Due dates:** keep the date picker, or type "11/12" (with snapping) in a small field with a calendar button?

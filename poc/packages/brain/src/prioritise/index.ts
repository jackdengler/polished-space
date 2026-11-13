/**
 * Phase 2A: prioritise + calendar awareness. See service.ts for the flow and
 * calendar/gaps.ts for the free-gap, lunch and focus-slot maths.
 *
 * Triggers (all debounced into one run, which skips Claude when its input
 * hash is unchanged): task list changes, calendar changes, a suggestion
 * applied or denied, a message triaged (new pending work), and a new
 * 15-minute bucket on the tick (time passing shrinks the gap).
 *
 * No executor override: approving a `calendar_block` suggestion runs the
 * core executor, which writes the event (UTC) through the approve path.
 */
import type { BrainModule } from '../modules/types';
import { Prioritiser, type PrioritiseOptions } from './service';

export { findFocusSlot, findLunchSlot, freeGapsToday, gapBeforeNextMeeting } from './calendar/gaps';

export function createPrioritiseModule(opts: PrioritiseOptions = {}): BrainModule & { prioritiser(): Prioritiser | null } {
  let p: Prioritiser | null = null;
  const schedule = () => p?.schedule();
  return {
    name: 'prioritise',
    init(ctx) {
      p = new Prioritiser(ctx, opts);
    },
    onTasksChanged: schedule,
    onCalendarChanged: schedule,
    onSuggestionApplied: schedule,
    onSuggestionDenied: schedule,
    onMessageTriaged: schedule,
    onSuggestionsAdded: schedule,
    onTick: (now) => p?.tick(now),
    stop: () => p?.stop(),
    prioritiser: () => p,
  };
}


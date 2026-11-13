import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { TaskList } from './components/TaskList';
import { fixtureState, resetStore } from './test/helpers';

describe('TaskList', () => {
  beforeEach(() => resetStore());

  it('renders sections in the order the brain sends them, with every section present', () => {
    const state = fixtureState();
    const { container } = render(<TaskList sections={state.sections} inboxSuggestions={[]} />);
    const keys = [...container.querySelectorAll('[data-section]')].map((e) => e.getAttribute('data-section'));
    expect(keys).toEqual(state.sections.map((s) => s.key));
    // The brief's order, with the remaining weekdays of a Wednesday.
    expect(keys).toEqual(['inbox', 'on_hold', 'overdue', 'today', 'tomorrow', 'day-2026-11-13', 'day-2026-11-14', 'day-2026-11-15', 'next_week', 'next_week_1', 'next_week_2', 'later', 'internal']);
    expect([...container.querySelectorAll('.section-label')].map((e) => e.textContent)).toContain('Friday');
  });

  it('does not re-sort: a different order from the brain is rendered as is', () => {
    const state = fixtureState();
    const reversed = [...state.sections].reverse();
    const today = reversed.find((s) => s.key === 'today')!;
    today.items = [...today.items].reverse();
    const { container } = render(<TaskList sections={reversed} inboxSuggestions={[]} />);
    expect([...container.querySelectorAll('[data-section]')].map((e) => e.getAttribute('data-section'))).toEqual(reversed.map((s) => s.key));
    const rows = [...container.querySelectorAll('[data-section="today"] li[data-task-id]')].map((e) => e.getAttribute('data-task-id'));
    expect(rows).toEqual(today.items.map((t) => t.taskId));
  });

  it("shows Today's order, quick-win flag and reason", () => {
    const state = fixtureState();
    render(<TaskList sections={state.sections} inboxSuggestions={[]} />);
    const today = screen.getByRole('region', { name: 'Today' });
    expect(within(today).getByText('Quick win')).toBeTruthy();
    expect(within(today).getByText('Two-minute email and it unblocks the pay equity memo.')).toBeTruthy();
    expect(today.querySelector('.task-order')?.textContent).toBe('1');
  });
});

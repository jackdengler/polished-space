import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FixtureBrain } from '../fixture/brain';
import { PreparedView } from './components/PreparedView';
import { NOW, resetStore, stubFetch, type Call } from './test/helpers';

describe('PreparedView', () => {
  let brain: FixtureBrain;
  let calls: Call[];
  beforeEach(() => {
    brain = new FixtureBrain(() => NOW);
    resetStore(brain.state());
    calls = stubFetch((c) => {
      const m = /\/api\/tasks\/([^/]+)\/(prepared|prepare)$/.exec(c.url);
      if (m && m[2] === 'prepared') return brain.prepared(decodeURIComponent(m[1]!));
      if (m && m[2] === 'prepare') {
        brain.prepare(decodeURIComponent(m[1]!));
        return brain.prepared(decodeURIComponent(m[1]!));
      }
      const d = /\/api\/suggestions\/([^/]+)\/approve$/.exec(c.url);
      if (d) return brain.approve(decodeURIComponent(d[1]!), c.body)[1];
      return {};
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  const cases: [string, string, (c: HTMLElement) => void][] = [
    ['t-acme-pricing', 'reply_email', () => {
      expect(screen.getByText('Re: Pricing summary?')).toBeTruthy();
      expect(screen.getByText(/Michael Okafor <michael.okafor@acmetooling.example>/)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Approve and send' })).toBeTruthy();
    }],
    ['t-harbor-meet', 'schedule_meeting', () => {
      expect(screen.getByRole('list', { name: 'Suggested times' }).querySelectorAll('li')).toHaveLength(3);
      expect(screen.getByText('Re: Census review')).toBeTruthy();
    }],
    ['t-quill-levels', 'review_file', () => {
      expect(screen.getByText('Quillon Robotics/Job Levels Draft.md')).toBeTruthy();
      expect(screen.getByText(/six-level framework/)).toBeTruthy();
      expect(document.querySelectorAll('.key-points li')).toHaveLength(3);
      expect(screen.getByRole('button', { name: 'Approve: mark reviewed' })).toBeTruthy();
    }],
    ['t-tess-chase', 'follow_up', () => {
      expect(screen.getByText('Comparator group data')).toBeTruthy();
      expect(screen.getByText('Drafted chaser')).toBeTruthy();
    }],
    ['t-acme-survey', 'other', () => {
      expect(screen.getByText('From the kickoff notes')).toBeTruthy();
      expect(screen.getByText('Kickoff notes.txt')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Approve: mark done' })).toBeTruthy();
    }],
  ];

  for (const [taskId, type, check] of cases) {
    it(`renders the ${type} view with Approve / Edit / Deny`, async () => {
      const { container } = render(<PreparedView taskId={taskId} />);
      await waitFor(() => expect(container.querySelector(`[data-prepared-type="${type}"]`)).toBeTruthy());
      expect(calls[0]!.url).toBe(`/api/tasks/${taskId}/prepared`);
      check(container);
      expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Deny' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Regenerate' })).toBeTruthy();
    });
  }

  it('approving goes through the prepared suggestion, with the edited draft', async () => {
    render(<PreparedView taskId="t-tess-chase" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hi Gareth, any news on the file?\n\nAlex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve with changes' }));
    await screen.findByText(/The email is sent/);
    const approve = calls.find((c) => c.url.endsWith('/approve'))!;
    expect(approve.url).toBe('/api/suggestions/sg-prep-tess-chase/approve');
    expect((approve.body as { edits: { payload: { draft: { body: string } } } }).edits.payload.draft.body).toBe('Hi Gareth, any news on the file?\n\nAlex');
    expect(brain.sent).toHaveLength(1);
  });

  it('regenerate posts to prepare and shows "Preparing…"', async () => {
    render(<PreparedView taskId="t-acme-pricing" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Regenerate' }));
    await screen.findByText('Preparing…');
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/tasks/t-acme-pricing/prepare')).toBe(true);
  });

  it('a task with nothing prepared offers "Prepare it now"', async () => {
    const t = brain.world.tasks.find((x) => x.taskId === 't-harbor-gaps')!;
    expect(t.preparedStatus).toBe('none');
    render(<PreparedView taskId="t-harbor-gaps" />);
    expect(await screen.findByRole('button', { name: 'Prepare it now' })).toBeTruthy();
  });
});

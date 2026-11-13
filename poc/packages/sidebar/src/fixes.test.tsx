/** Regression tests for the verifier's sidebar defects: D2 errors, D4 source dialog, D9, D10, D13 and the meeting times on the card. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Suggestion } from '@poc/contracts';
import { FixtureBrain } from '../fixture/brain';
import { api, ApiError, ASSISTANT_DOWN } from './api';
import { PreparedView } from './components/PreparedView';
import { SourceDialog } from './components/SourceDialog';
import { SuggestionCard } from './components/SuggestionCard';
import { useUi } from './store';
import { NOW, fixtureState, resetStore, stubFetch } from './test/helpers';

afterEach(() => vi.unstubAllGlobals());

describe('D2: plain-English errors when the assistant is down', () => {
  it('a gateway 502 (or no answer at all) reads as one sentence, never the proxy text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'upstream on port 7000 is not answering', code: 'upstream_down' }), { status: 502 })));
    await expect(api.approve('x')).rejects.toMatchObject({ message: ASSISTANT_DOWN });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Bad Gateway</html>', { status: 502 })));
    await expect(api.approve('x')).rejects.toMatchObject({ message: ASSISTANT_DOWN });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(api.approve('x')).rejects.toMatchObject({ message: ASSISTANT_DOWN });
    // The brain's own error sentences still come through.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'The due date (2026-02-30) is not a real calendar date. Nothing was changed.' }), { status: 400 })));
    const e = (await api.approve('x').then(() => null, (x: unknown) => x)) as ApiError;
    expect(e.message).toBe('The due date (2026-02-30) is not a real calendar date. Nothing was changed.');
  });
});

describe('cards', () => {
  beforeEach(() => resetStore());

  it('D9: a "Which client?" card with one candidate says which client approving assigns', () => {
    const base = fixtureState().suggestions.find((s) => s.kind === 'confirm_client') as Extract<Suggestion, { kind: 'confirm_client' }>;
    const one = { ...base, payload: { ...base.payload, candidateClientIds: ['poc-client-quillon'] } };
    stubFetch(() => ({}));
    const { container } = render(<SuggestionCard suggestion={one} />);
    expect(container.textContent).toMatch(/Approve to assign it to Quillon Robotics and remember “the robo team” as its name\./);
  });

  it('step 3: a schedule-meeting suggestion shows its code-computed times on the card', () => {
    const base = fixtureState().suggestions.find((s) => s.kind === 'create_task') as Extract<Suggestion, { kind: 'create_task' }>;
    const s = { ...base, taskType: 'schedule_meeting' as const, payload: { ...base.payload, slots: [{ start: '2026-11-16T14:00:00.000Z', end: '2026-11-16T14:45:00.000Z' }, { start: '2026-11-17T10:00:00.000Z', end: '2026-11-17T10:45:00.000Z' }] } };
    stubFetch(() => ({}));
    render(<SuggestionCard suggestion={s} />);
    expect(screen.getByRole('list', { name: 'Suggested meeting times' }).querySelectorAll('li')).toHaveLength(2);
  });

  it('D13: the calendar block edit form puts Starts and Ends on their own rows', () => {
    const lunch = fixtureState().suggestions.find((s) => s.kind === 'calendar_block')!;
    stubFetch(() => ({}));
    const { container } = render(<SuggestionCard suggestion={lunch} />);
    fireEvent.click(within(container).getByRole('button', { name: 'Edit' }));
    const starts = within(container).getByLabelText('Starts');
    expect(starts.closest('.field-row')).toBeNull();
  });
});

describe('D4: the source link opens the original message', () => {
  beforeEach(() => resetStore());

  it('a mail chip is a button; it opens a dialog with sender, time, subject and body; Escape-equivalent Close returns', async () => {
    const s = fixtureState().suggestions.find((x) => x.source?.connector === 'mail')!;
    stubFetch((c) =>
      c.url.startsWith('/api/sources/mail/')
        ? { connector: 'mail', id: s.source!.id, from: { name: 'Michael Okafor', address: 'michael.okafor@acmetooling.example' }, to: ['alex.rivera@brightline-advisory.example'], at: '2026-11-11T09:00:00.000Z', subject: 'Pricing summary?', body: 'Hi Alex, where are we?', truncated: false }
        : {},
    );
    render(
      <>
        <SuggestionCard suggestion={s} />
        <SourceDialog />
      </>,
    );
    const chip = screen.getByRole('button', { name: /Open the source/ });
    fireEvent.click(chip);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText('Hi Alex, where are we?')).toBeTruthy());
    expect(within(dialog).getByText('Pricing summary?')).toBeTruthy();
    expect(within(dialog).getByText(/Michael Okafor/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('D10: chat history after a reload', () => {
  beforeEach(() => resetStore());
  it('stored turns load into the Chat tab once, keeping interrupted markers', () => {
    useUi.setState({ chatLoaded: false, chat: [] });
    const turns = [
      { id: 't1', at: NOW.toISOString(), via: 'text' as const, user: 'What next?', assistant: 'The Acme reply.', interrupted: false, suggestionIds: [] },
      { id: 't2', at: NOW.toISOString(), via: 'voice' as const, user: 'Tell me about my day', assistant: 'Here is', interrupted: true, suggestionIds: [] },
    ];
    act(() => useUi.getState().loadHistory(turns));
    act(() => useUi.getState().loadHistory(turns));
    expect(useUi.getState().chat.map((m) => [m.role, m.via, m.text, m.status])).toEqual([
      ['user', 'text', 'What next?', 'done'],
      ['assistant', 'text', 'The Acme reply.', 'done'],
      ['user', 'voice', 'Tell me about my day', 'done'],
      ['assistant', 'voice', 'Here is', 'interrupted'],
    ]);
  });
});

describe('D13: prepared work after Deny, and after someone else approved it', () => {
  let brain: FixtureBrain;
  beforeEach(() => {
    brain = new FixtureBrain(() => NOW);
    resetStore(brain.state());
    stubFetch((c) => {
      const m = /\/api\/tasks\/([^/]+)\/prepared$/.exec(c.url);
      if (m) return brain.prepared(decodeURIComponent(m[1]!));
      const d = /\/api\/suggestions\/([^/]+)\/deny$/.exec(c.url);
      if (d) return brain.deny(decodeURIComponent(d[1]!))[1];
      return {};
    });
  });

  it('Deny discards the draft and offers a fresh one, instead of the stale draft with nothing to approve', async () => {
    render(<PreparedView taskId="t-acme-pricing" />);
    await screen.findByRole('button', { name: 'Approve and send' });
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    await screen.findByText(/You denied this draft, so nothing was sent/);
    expect(screen.queryByText('Nothing to approve here yet.')).toBeNull();
    expect(screen.queryByText('Re: Pricing summary?')).toBeNull();
    expect(screen.getByRole('button', { name: 'Prepare a new draft' })).toBeTruthy();
  });

  it('when the prepared work was approved elsewhere, the panel says Done', async () => {
    render(<PreparedView taskId="t-acme-pricing" />);
    await screen.findByRole('button', { name: 'Approve and send' });
    const sid = brain.prepared('t-acme-pricing')?.suggestion?.id ?? '';
    brain.approve(sid, {});
    act(() => resetStore(brain.state()));
    await screen.findByText(/Done\. The email is sent and the task is ticked off\./);
    expect(screen.queryByText('This task is no longer open.')).toBeNull();
  });
});

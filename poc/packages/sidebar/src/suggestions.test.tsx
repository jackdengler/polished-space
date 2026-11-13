import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Suggestion } from '@poc/contracts';
import { SuggestionCard } from './components/SuggestionCard';
import { decisionHandler, fixtureState, resetStore, stubFetch } from './test/helpers';
import { buildEdits, initialForm } from './edits';

const state = fixtureState();
const byKind = (kind: Suggestion['kind'], pred: (s: Suggestion) => boolean = () => true) => state.suggestions.find((s) => s.kind === kind && s.status === 'pending' && pred(s))!;

function renderCard(s: Suggestion) {
  const calls = stubFetch(decisionHandler(state));
  const view = render(<SuggestionCard suggestion={s} />);
  return { calls, card: within(view.container.querySelector('article')!) };
}

const KINDS: { kind: Suggestion['kind']; pick?: (s: Suggestion) => boolean; edit: (card: ReturnType<typeof within>) => void; expectEdits: (s: Suggestion) => unknown }[] = [
  {
    kind: 'create_task',
    pick: (s) => s.id === 'sg-acme-update',
    edit: (card) => {
      fireEvent.change(card.getByLabelText('Task'), { target: { value: 'Send Michael the status note' } });
      fireEvent.change(card.getByLabelText('Due'), { target: { value: '2026-11-13' } });
      fireEvent.change(card.getByLabelText('Client'), { target: { value: 'poc-client-tessera' } });
    },
    expectEdits: () => ({ title: 'Send Michael the status note', clientId: 'poc-client-tessera', payload: { title: 'Send Michael the status note', dueDate: '2026-11-13' } }),
  },
  {
    kind: 'complete_task',
    pick: (s) => s.id === 'sg-complete',
    edit: (card) => fireEvent.change(card.getByLabelText('Task to mark done'), { target: { value: 't-harbor-plan' } }),
    expectEdits: () => ({ payload: { taskId: 't-harbor-plan' } }),
  },
  {
    kind: 'reschedule_task',
    edit: (card) => fireEvent.change(card.getByLabelText('New date'), { target: { value: '2026-11-20' } }),
    expectEdits: () => ({ payload: { dueDate: '2026-11-20' } }),
  },
  {
    kind: 'calendar_block',
    pick: (s) => s.id === 'sg-lunch',
    edit: (card) => {
      fireEvent.change(card.getByLabelText('Name'), { target: { value: 'Lunch with Priya' } });
      fireEvent.change(card.getByLabelText('Ends'), { target: { value: '2026-11-11T13:15' } });
    },
    expectEdits: () => ({ payload: { subject: 'Lunch with Priya', end: '2026-11-11T13:15:00.000Z' } }),
  },
  {
    kind: 'send_reply',
    pick: (s) => s.id === 'sg-reply',
    edit: (card) => fireEvent.change(card.getByLabelText('Message'), { target: { value: 'Hi Renata,\n\nResent just now.\n\nAlex' } }),
    expectEdits: (s) => ({ payload: { draft: { ...(s as Extract<Suggestion, { kind: 'send_reply' }>).payload.draft, body: 'Hi Renata,\n\nResent just now.\n\nAlex' } } }),
  },
  {
    kind: 'confirm_client',
    edit: (card) => {
      fireEvent.change(card.getAllByLabelText('Client').at(-1)!, { target: { value: 'poc-client-harborlight' } });
      fireEvent.change(card.getByLabelText('Remember this name for the client'), { target: { value: 'robo crew' } });
    },
    expectEdits: () => ({ clientId: 'poc-client-harborlight', payload: { alias: 'robo crew' } }),
  },
];

describe('SuggestionCard: Approve / Edit / Deny for every kind', () => {
  beforeEach(() => {
    resetStore();
  });
  afterEach(() => vi.unstubAllGlobals());

  for (const k of KINDS) {
    it(`${k.kind}: Approve posts to the approve endpoint`, async () => {
      const s = byKind(k.kind, k.pick);
      const { calls, card } = renderCard(s);
      if (s.kind === 'confirm_client') fireEvent.change(card.getByLabelText('Which client is this?'), { target: { value: 'poc-client-quillon' } });
      fireEvent.click(card.getByRole('button', { name: 'Approve' }));
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]!.url).toBe(`/api/suggestions/${s.id}/approve`);
      expect(calls[0]!.method).toBe('POST');
      // confirm_client always names the client; everything else approves as is.
      expect(calls[0]!.body).toEqual(s.kind === 'confirm_client' ? { edits: { clientId: 'poc-client-quillon' } } : {});
    });

    it(`${k.kind}: Edit then approve sends only the changed fields`, async () => {
      const s = byKind(k.kind, k.pick);
      const { calls, card } = renderCard(s);
      fireEvent.click(card.getByRole('button', { name: 'Edit' }));
      k.edit(card);
      fireEvent.click(card.getByRole('button', { name: 'Approve with changes' }));
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]!.url).toBe(`/api/suggestions/${s.id}/approve`);
      expect(calls[0]!.body).toEqual({ edits: k.expectEdits(s) });
    });

    it(`${k.kind}: Deny posts to the deny endpoint`, async () => {
      const s = byKind(k.kind, k.pick);
      const { calls, card } = renderCard(s);
      fireEvent.click(card.getByRole('button', { name: 'Deny' }));
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]).toMatchObject({ url: `/api/suggestions/${s.id}/deny`, method: 'POST', body: {} });
    });
  }

  it('shows client, direction, source label and duplicate marker', () => {
    const s = state.suggestions.find((x) => x.id === 'sg-acme-dup')!;
    renderCard(s);
    expect(screen.getByText('Acme Tooling Co.')).toBeTruthy();
    expect(screen.getByText('I owe')).toBeTruthy();
    expect(screen.getByText('Email from Michael Okafor: Update and a meeting?')).toBeTruthy();
    expect(screen.getByText(/Possible duplicate of “Send Michael the revised market pricing summary”/)).toBeTruthy();
  });

  it('shows a failed suggestion with its error and offers Try again / Dismiss', () => {
    const s = state.suggestions.find((x) => x.status === 'failed')!;
    renderCard(s);
    expect(screen.getByRole('alert').textContent).toContain('The PM app did not answer in time');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
  });

  it('a create_task with no client cannot be approved until one is picked', async () => {
    const s = state.suggestions.find((x) => x.id === 'sg-robo-deck')!;
    const { calls, card } = renderCard(s);
    fireEvent.click(card.getByRole('button', { name: 'Approve' }));
    await screen.findByText('Pick a client first.');
    expect(calls).toHaveLength(0);
    fireEvent.change(card.getByLabelText('Which client is this for?'), { target: { value: 'poc-client-quillon' } });
    fireEvent.click(card.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body).toEqual({ edits: { clientId: 'poc-client-quillon' } });
  });

  it('shows the error when the brain rejects the edits (400)', async () => {
    const s = byKind('create_task');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Edits are not valid' }), { status: 400 })));
    render(<SuggestionCard suggestion={s} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Edits are not valid');
  });
});

describe('buildEdits', () => {
  it('approving an untouched form sends no edits', () => {
    for (const s of state.suggestions.filter((x) => x.kind !== 'confirm_client' && x.clientId)) {
      const r = buildEdits(s, initialForm(s));
      expect(r).toEqual({ ok: true, edits: undefined });
    }
  });
  it('rejects an empty title and a bad address', () => {
    const t = byKind('create_task');
    expect(buildEdits(t, { ...(initialForm(t) as Extract<ReturnType<typeof initialForm>, { kind: 'create_task' }>), title: ' ' }).ok).toBe(false);
    const r = byKind('send_reply');
    expect(buildEdits(r, { ...(initialForm(r) as Extract<ReturnType<typeof initialForm>, { kind: 'send_reply' }>), to: 'not an address' }).ok).toBe(false);
  });
});

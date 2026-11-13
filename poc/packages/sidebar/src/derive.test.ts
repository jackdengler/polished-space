import { describe, expect, it } from 'vitest';
import type { Nudge, Suggestion } from '@poc/contracts';
import { arrange } from './derive';
import { NOW, fixtureState } from './test/helpers';

const base = { status: 'pending', nudge: 'n', source: null, createdAt: NOW.toISOString(), decidedAt: null, error: null } as const;

describe('arrange', () => {
  it('sends uncertain matches to Inbox even when a nudge names them; client-free kinds never land in Inbox', () => {
    const state = fixtureState();
    const confirm = { ...base, id: 'sg-c', kind: 'confirm_client', title: 'Which client?', clientId: 'poc-client-quillon', clientConfidence: 'low', payload: { candidateClientIds: ['poc-client-quillon'], alias: 'the robo team', relatedSuggestionIds: ['sg-t'] } } as Suggestion;
    const lowTask = { ...base, id: 'sg-t', kind: 'create_task', title: 'Confirm levels', clientId: 'poc-client-quillon', clientConfidence: 'low', payload: { title: 'Confirm levels', dueDate: null, assigneeIds: [] } } as Suggestion;
    const lunch = { ...base, id: 'sg-l', kind: 'calendar_block', title: 'Lunch', clientId: null, clientConfidence: 'high', payload: { subject: 'Lunch', start: '2026-11-11T12:00:00.000Z', end: '2026-11-11T12:30:00.000Z', purpose: 'lunch', taskId: null } } as Suggestion;
    const nudge: Nudge = { id: 'n-robo', kind: 'new_item', text: 'Marcus mentioned the robo team.', createdAt: NOW.toISOString(), source: null, suggestionIds: ['sg-c', 'sg-t'], taskId: null };
    const a = arrange({ ...state, suggestions: [confirm, lowTask, lunch], nudges: [nudge] }, []);
    expect(a.inbox.map((s) => s.id)).toEqual(['sg-c', 'sg-t']);
    expect(a.loose.map((s) => s.id)).toEqual(['sg-l']);
    expect(a.nudges[0]!.suggestions).toEqual([]);
  });
});

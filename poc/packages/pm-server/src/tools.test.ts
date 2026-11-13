import { describe, expect, it } from 'vitest';
import { ADHOC_BOARD_ID, ListClientsOutput, ListTasksInput, PmTask } from '@poc/contracts';
import { parseWorkspace } from '../../../../src/model/schema';
import { completeTask, createTask, listClients, listTasks, rescheduleTask } from './tools';
import { seededWorkspace } from './testUtil';

const ACME = 'poc-client-acme';
const ME = 'poc-member-alex';

describe('list_clients', () => {
  it('returns every client with the four client fields and its meetings as projects', () => {
    const out = ListClientsOutput.parse(listClients(seededWorkspace()));
    expect(out.clients.map((c) => c.id)).toEqual(['poc-client-acme', 'poc-client-harborlight', 'poc-client-quillon', 'poc-client-tessera', 'poc-client-internal']);
    const acme = out.clients.find((c) => c.id === ACME)!;
    expect(acme.emailDomains).toContain('acmetooling.example');
    expect(acme.nicknames).toContain('ATC');
    expect(acme.contacts.length).toBeGreaterThan(0);
    expect(acme.fileFolder).toBe('Acme Tooling');
    expect(acme.projects.length).toBeGreaterThan(0);
    expect(acme.projects[0]!.deliverables.length).toBeGreaterThan(0);
  });
});

describe('list_tasks', () => {
  const ws = seededWorkspace();
  const q = (input: ListTasksInput) => listTasks(ws, ListTasksInput.parse(input)).tasks;

  it('flattens tasks and leaves done ones out by default', () => {
    const open = q({});
    expect(open.length).toBeGreaterThan(0);
    for (const t of open) expect(() => PmTask.parse(t)).not.toThrow();
    expect(open.every((t) => !t.done)).toBe(true);
    expect(q({ includeDone: true }).length).toBeGreaterThanOrEqual(open.length);
  });

  it('filters by client and assignee', () => {
    expect(q({ clientId: ACME }).every((t) => t.clientId === ACME && t.clientName === 'Acme Tooling Co.')).toBe(true);
    expect(q({ assigneeId: ME }).every((t) => t.assigneeIds.includes(ME))).toBe(true);
  });

  it('applies inclusive due bounds and drops undated tasks when a bound is given', () => {
    const all = q({ includeDone: true });
    const dates = all.map((t) => t.dueDate).filter((d): d is string => d !== null).sort();
    const from = dates[0]!;
    const ranged = q({ includeDone: true, dueFrom: from, dueTo: from });
    expect(ranged.length).toBe(dates.filter((d) => d === from).length);
    expect(q({ dueFrom: '2000-01-01' }).every((t) => t.dueDate !== null)).toBe(true);
  });
});

describe('create_task', () => {
  it("files under the client's Ad-hoc → General by default and validates", () => {
    const ws = seededWorkspace();
    const task = createTask(ws, { clientId: ACME, title: '  Send the pricing update  ', dueDate: '2026-11-20', assigneeIds: [ME] });
    expect(task).toMatchObject({ title: 'Send the pricing update', clientId: ACME, boardId: ADHOC_BOARD_ID, boardLabel: 'Ad-hoc', deliverableTitle: 'General', dueDate: '2026-11-20', assigneeIds: [ME], done: false });
    expect(() => parseWorkspace(ws)).not.toThrow();
    expect(listTasks(ws, { clientId: ACME }).tasks.some((t) => t.id === task.id)).toBe(true);
  });

  it('defaults assigneeIds to [] and dueDate to null', () => {
    const task = createTask(seededWorkspace(), { clientId: ACME, title: 'Undated' });
    expect(task.assigneeIds).toEqual([]);
    expect(task.dueDate).toBeNull();
  });

  it('creates the General deliverable when it is missing', () => {
    const ws = seededWorkspace();
    const acme = ws.clients.find((c) => c.id === ACME)!;
    acme.adhoc.deliverables = [];
    const task = createTask(ws, { clientId: ACME, title: 'First ad-hoc task' });
    expect(acme.adhoc.deliverables.map((d) => d.title)).toEqual(['General']);
    expect(task.deliverableId).toBe(acme.adhoc.deliverables[0]!.id);
  });

  it('files under a given deliverable of that client', () => {
    const ws = seededWorkspace();
    const meeting = ws.clients.find((c) => c.id === ACME)!.meetings[0]!;
    const task = createTask(ws, { clientId: ACME, title: 'In a meeting', deliverableId: meeting.deliverables[0]!.id });
    expect(task.boardId).toBe(meeting.id);
    expect(task.boardLabel).toBe(meeting.title);
  });

  it('rejects an unknown client or a deliverable of another client', () => {
    const ws = seededWorkspace();
    expect(() => createTask(ws, { clientId: 'nope', title: 'x' })).toThrow(/No client/);
    const other = ws.clients.find((c) => c.id === 'poc-client-quillon')!.meetings[0]!.deliverables[0]!.id;
    expect(() => createTask(ws, { clientId: ACME, title: 'x', deliverableId: other })).toThrow(/no deliverable/);
  });
});

describe('complete_task and reschedule_task', () => {
  it('complete sets done and is idempotent', () => {
    const ws = seededWorkspace();
    const id = listTasks(ws, {}).tasks[0]!.id;
    const first = completeTask(ws, id);
    expect(first.done).toBe(true);
    const again = completeTask(ws, id);
    expect(again.done).toBe(true);
    expect(again.updatedAt).toBe(first.updatedAt);
  });

  it('reschedule sets or clears the due date', () => {
    const ws = seededWorkspace();
    const id = listTasks(ws, {}).tasks[0]!.id;
    expect(rescheduleTask(ws, id, '2026-12-01').dueDate).toBe('2026-12-01');
    expect(rescheduleTask(ws, id, null).dueDate).toBeNull();
  });

  it('reject an unknown task id', () => {
    const ws = seededWorkspace();
    expect(() => completeTask(ws, 'missing')).toThrow(/No task/);
    expect(() => rescheduleTask(ws, 'missing', null)).toThrow(/No task/);
  });
});

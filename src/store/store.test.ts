import { beforeEach, describe, expect, it } from 'vitest';
import { ADHOC, WorkspaceSchema, emptyWorkspace } from '../model/schema';
import { makeDemoWorkspace } from '../model/demo';
import { parseFlexDate } from '../model/flexDate';
import { useStore } from './store';

const s = () => useStore.getState();

beforeEach(() => s().load(emptyWorkspace()));

describe('store actions', () => {
  it('builds client → meeting → deliverable → task → subtask', () => {
    const c = s().addClient('Acme');
    const m = s().addMeeting(c, parseFlexDate('10/28/26')!, 'Kickoff');
    const d = s().addDeliverable(c, m, 'Brand audit');
    const t = s().addTask(d, 'Collect assets');
    const sub = s().addSubtask(t, 'Pull 5 sites');
    s().toggleSubtask(sub);
    s().toggleTask(t);
    s().updateTask(t, { dueDate: '2026-10-20' });

    const client = s().ws.clients[0]!;
    expect(client.adhoc.deliverables.map((x) => x.title)).toEqual(['General']);
    const task = client.meetings[0]!.deliverables[0]!.tasks[0]!;
    expect(task).toMatchObject({ title: 'Collect assets', done: true, dueDate: '2026-10-20' });
    expect(task.subtasks[0]).toMatchObject({ title: 'Pull 5 sites', done: true });
    expect(WorkspaceSchema.safeParse(s().ws).success).toBe(true);
  });

  it('adds work to the ad-hoc board and reorders', () => {
    const c = s().addClient('Acme');
    const d1 = s().ws.clients[0]!.adhoc.deliverables[0]!.id;
    const d2 = s().addDeliverable(c, ADHOC, 'Billing');
    ['a', 'b', 'c'].forEach((x) => s().addTask(d1, x));
    s().moveTask(d1, 0, 2);
    s().moveDeliverable(c, ADHOC, 1, 0);
    const board = s().ws.clients[0]!.adhoc.deliverables;
    expect(board.map((d) => d.id)).toEqual([d2, d1]);
    expect(board[1]!.tasks.map((t) => t.title)).toEqual(['b', 'c', 'a']);
  });

  it('undo and redo', () => {
    s().addClient('One');
    s().addClient('Two');
    s().undo();
    expect(s().ws.clients.map((c) => c.name)).toEqual(['One']);
    s().redo();
    expect(s().ws.clients.map((c) => c.name)).toEqual(['One', 'Two']);
    s().undo(); s().undo();
    expect(s().ws.clients).toHaveLength(0);
    s().undo(); // nothing left — no-op
    expect(s().past).toHaveLength(0);
  });

  it('deleting a member unassigns their tasks and removes them from teams', () => {
    const member = s().addMember('Alex Rivera');
    const c = s().addClient('Acme');
    s().toggleClientMember(c, member);
    const d = s().ws.clients[0]!.adhoc.deliverables[0]!.id;
    const t = s().addTask(d, 'Call');
    s().updateTask(t, { assigneeId: member });
    s().deleteMember(member);
    const client = s().ws.clients[0]!;
    expect(client.teamMemberIds).toEqual([]);
    expect(client.adhoc.deliverables[0]!.tasks[0]!.assigneeId).toBeNull();
  });
});

describe('demo data', () => {
  it('is a valid workspace', () => {
    const ws = makeDemoWorkspace('2026-11-07');
    expect(() => WorkspaceSchema.parse(ws)).not.toThrow();
    expect(ws.clients.length).toBeGreaterThan(3);
  });
});

/**
 * The five MCP tools as plain functions over Planr's Workspace, so they can be
 * tested without HTTP. Reads take a workspace; writes change the draft they
 * are given (WorkspaceStore.update validates and saves it).
 */
import { randomUUID } from 'node:crypto';
import {
  ADHOC_BOARD_ID,
  DEFAULT_DELIVERABLE_TITLE,
  type CreateTaskInput,
  type ListClientsOutput,
  type ListTasksInput,
  type ListTasksOutput,
  type PmTask,
} from '@poc/contracts';
import type { Client, Deliverable, Task, Workspace } from '../../../../src/model/schema';
import { BadRequest } from './store';

const nowIso = () => new Date().toISOString();

export function listClients(ws: Workspace): ListClientsOutput {
  return {
    clients: ws.clients.map((c) => ({
      id: c.id,
      name: c.name,
      archived: c.archived,
      nicknames: c.nicknames,
      emailDomains: c.emailDomains,
      contacts: c.contacts,
      fileFolder: c.fileFolder,
      projects: c.meetings.map((m) => ({ meetingId: m.id, title: m.title, date: m.date, deliverables: m.deliverables.map((d) => d.title) })),
    })),
  };
}

interface Located { client: Client; boardId: string; boardLabel: string; deliverable: Deliverable; task: Task }

function* allTasks(ws: Workspace): Generator<Located> {
  for (const client of ws.clients) {
    const boards = [{ id: ADHOC_BOARD_ID, label: 'Ad-hoc', deliverables: client.adhoc.deliverables }, ...client.meetings.map((m) => ({ id: m.id, label: m.title, deliverables: m.deliverables }))];
    for (const b of boards) for (const deliverable of b.deliverables) for (const task of deliverable.tasks) yield { client, boardId: b.id, boardLabel: b.label, deliverable, task };
  }
}

function flatten({ client, boardId, boardLabel, deliverable, task }: Located): PmTask {
  return {
    id: task.id,
    title: task.title,
    done: task.done,
    dueDate: task.dueDate,
    assigneeIds: task.assigneeIds,
    clientId: client.id,
    clientName: client.name,
    boardId,
    boardLabel,
    deliverableId: deliverable.id,
    deliverableTitle: deliverable.title,
    updatedAt: task.updatedAt,
  };
}

/** Archived clients' tasks are left out unless that client is asked for by id (as Planr's own views do). */
export function listTasks(ws: Workspace, q: ListTasksInput): ListTasksOutput {
  const dated = q.dueFrom !== undefined || q.dueTo !== undefined;
  const tasks: PmTask[] = [];
  for (const hit of allTasks(ws)) {
    const { client, task } = hit;
    if (q.clientId !== undefined ? client.id !== q.clientId : client.archived) continue;
    if (q.assigneeId !== undefined && !task.assigneeIds.includes(q.assigneeId)) continue;
    if (!q.includeDone && task.done) continue;
    if (dated) {
      if (task.dueDate === null) continue;
      if (q.dueFrom !== undefined && task.dueDate < q.dueFrom) continue;
      if (q.dueTo !== undefined && task.dueDate > q.dueTo) continue;
    }
    tasks.push(flatten(hit));
  }
  return { tasks };
}

function findTask(ws: Workspace, taskId: string): Located {
  for (const hit of allTasks(ws)) if (hit.task.id === taskId) return hit;
  throw new BadRequest(`No task with id "${taskId}".`);
}

/** Files the task under `deliverableId`, or the client's Ad-hoc → "General" (created if missing). */
export function createTask(ws: Workspace, input: CreateTaskInput): PmTask {
  const client = ws.clients.find((c) => c.id === input.clientId);
  if (!client) throw new BadRequest(`No client with id "${input.clientId}".`);
  const t = nowIso();
  let deliverable: Deliverable | undefined;
  if (input.deliverableId !== undefined) {
    deliverable = [...client.adhoc.deliverables, ...client.meetings.flatMap((m) => m.deliverables)].find((d) => d.id === input.deliverableId);
    if (!deliverable) throw new BadRequest(`Client "${client.name}" has no deliverable with id "${input.deliverableId}".`);
  } else {
    deliverable = client.adhoc.deliverables.find((d) => d.title === DEFAULT_DELIVERABLE_TITLE);
    if (!deliverable) {
      deliverable = { id: randomUUID(), createdAt: t, updatedAt: t, title: DEFAULT_DELIVERABLE_TITLE, tasks: [] };
      client.adhoc.deliverables.push(deliverable);
    }
  }
  const task: Task = {
    id: randomUUID(), createdAt: t, updatedAt: t,
    title: input.title.trim(),
    assigneeIds: input.assigneeIds ?? [],
    dueDate: input.dueDate ?? null,
    done: false,
    subtasks: [],
    keyFor: [],
  };
  deliverable.tasks.push(task);
  return flatten(findTask(ws, task.id));
}

/** Sets done: true. Completing a done task is not an error and changes nothing. */
export function completeTask(ws: Workspace, taskId: string): PmTask {
  const hit = findTask(ws, taskId);
  if (!hit.task.done) {
    hit.task.done = true;
    hit.task.updatedAt = nowIso();
  }
  return flatten(hit);
}

export function rescheduleTask(ws: Workspace, taskId: string, dueDate: string | null): PmTask {
  const hit = findTask(ws, taskId);
  hit.task.dueDate = dueDate;
  hit.task.updatedAt = nowIso();
  return flatten(hit);
}

import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import type { FlexDate } from '../model/flexDate';
import { ADHOC, emptyWorkspace, type BoardId, type Client, type Deliverable, type Task, type TeamMember, type Workspace } from '../model/schema';
import { MEMBER_COLORS } from '../model/derive';

/**
 * Every change to the data goes through one of these named actions.
 * That's the seam for the future: a server can replay/merge them, and an AI
 * assistant or API integration can call the same actions the UI does.
 */

const HISTORY_LIMIT = 100;

const newId = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const stamp = () => { const t = now(); return { id: newId(), createdAt: t, updatedAt: t }; };

type W = Draft<Workspace>;

// ---- locators (ids are globally unique, so actions only need the target id) ----

function findClient(ws: W, clientId: string) {
  const c = ws.clients.find((x) => x.id === clientId);
  if (!c) throw new Error(`client ${clientId} not found`);
  return c;
}

function findBoard(ws: W, clientId: string, boardId: BoardId) {
  const c = findClient(ws, clientId);
  if (boardId === ADHOC) return c.adhoc;
  const m = c.meetings.find((x) => x.id === boardId);
  if (!m) throw new Error(`meeting ${boardId} not found`);
  return m;
}

function* allDeliverables(ws: W) {
  for (const c of ws.clients) {
    for (const d of c.adhoc.deliverables) yield { client: c, list: c.adhoc.deliverables, d };
    for (const m of c.meetings) for (const d of m.deliverables) yield { client: c, list: m.deliverables, d };
  }
}

function findDeliverable(ws: W, id: string) {
  for (const x of allDeliverables(ws)) if (x.d.id === id) return x;
  throw new Error(`deliverable ${id} not found`);
}

function findTask(ws: W, id: string) {
  for (const x of allDeliverables(ws)) {
    const task = x.d.tasks.find((t) => t.id === id);
    if (task) return { ...x, task };
  }
  throw new Error(`task ${id} not found`);
}

function findSubtask(ws: W, id: string) {
  for (const x of allDeliverables(ws)) {
    for (const task of x.d.tasks) {
      const sub = task.subtasks.find((s) => s.id === id);
      if (sub) return { task, sub };
    }
  }
  throw new Error(`subtask ${id} not found`);
}

const touch = (r: { updatedAt: string }) => { r.updatedAt = now(); };

function move<T>(list: T[], from: number, to: number) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item!);
}

// ---- store ----

export interface Store {
  ws: Workspace;
  past: Workspace[];
  future: Workspace[];

  /** Replace everything (after loading from disk). Clears undo history. */
  load(ws: Workspace): void;
  undo(): void;
  redo(): void;

  // Team
  addMember(name: string): string;
  updateMember(id: string, patch: { name?: string; color?: string }): void;
  deleteMember(id: string): void;
  /** Combine two entries for the same person: `fromId`'s tasks and client teams move to `intoId`. */
  mergeMember(fromId: string, intoId: string): void;

  // Clients
  /** Add imported clients and any new team members in one step. */
  importClients(clients: Client[], newMembers: TeamMember[]): void;
  addClient(name: string): string;
  renameClient(id: string, name: string): void;
  setClientLogo(id: string, logo: string | null): void;
  toggleClientMember(clientId: string, memberId: string): void;
  setPlannedThrough(id: string, date: FlexDate | null): void;
  setArchived(id: string, archived: boolean): void;
  deleteClient(id: string): void;

  // Meetings
  addMeeting(clientId: string, date: FlexDate, title: string): string;
  updateMeeting(clientId: string, meetingId: string, patch: { title?: string; date?: FlexDate }): void;
  deleteMeeting(clientId: string, meetingId: string): void;

  // Deliverables (on a meeting or the ad-hoc board)
  addDeliverable(clientId: string, boardId: BoardId, title: string): string;
  renameDeliverable(id: string, title: string): void;
  deleteDeliverable(id: string): void;
  moveDeliverable(clientId: string, boardId: BoardId, from: number, to: number): void;

  // Tasks
  addTask(deliverableId: string, title: string): string;
  updateTask(id: string, patch: Partial<Pick<Task, 'title' | 'assigneeId' | 'dueDate'>>): void;
  toggleTask(id: string): void;
  deleteTask(id: string): void;
  moveTask(deliverableId: string, from: number, to: number): void;

  // Subtasks
  addSubtask(taskId: string, title: string): string;
  renameSubtask(id: string, title: string): void;
  toggleSubtask(id: string): void;
  deleteSubtask(id: string): void;
}

export const useStore = create<Store>()((set, get) => {
  /** Apply a change, recording the previous state for undo. */
  function mutate(fn: (ws: W) => void) {
    const prev = get().ws;
    const next = produce(prev, fn);
    if (next === prev) return;
    set({ ws: next, past: [...get().past.slice(-(HISTORY_LIMIT - 1)), prev], future: [] });
  }

  const emptyDeliverable = (title: string): Deliverable => ({ ...stamp(), title, tasks: [] });

  return {
    ws: emptyWorkspace(),
    past: [],
    future: [],

    load: (ws) => set({ ws, past: [], future: [] }),
    undo: () => {
      const { past, ws, future } = get();
      const prev = past[past.length - 1];
      if (prev) set({ ws: prev, past: past.slice(0, -1), future: [ws, ...future] });
    },
    redo: () => {
      const { past, ws, future } = get();
      const next = future[0];
      if (next) set({ ws: next, past: [...past, ws], future: future.slice(1) });
    },

    addMember: (name) => {
      const id = newId();
      mutate((ws) => {
        ws.teamMembers.push({ id, name: name.trim(), color: MEMBER_COLORS[ws.teamMembers.length % MEMBER_COLORS.length]! });
      });
      return id;
    },
    updateMember: (id, patch) => mutate((ws) => {
      const m = ws.teamMembers.find((x) => x.id === id);
      if (!m) return;
      if (patch.name !== undefined) m.name = patch.name.trim();
      if (patch.color !== undefined) m.color = patch.color;
    }),
    deleteMember: (id) => mutate((ws) => {
      ws.teamMembers = ws.teamMembers.filter((m) => m.id !== id);
      for (const c of ws.clients) c.teamMemberIds = c.teamMemberIds.filter((x) => x !== id);
      for (const { d } of allDeliverables(ws)) for (const t of d.tasks) if (t.assigneeId === id) { t.assigneeId = null; touch(t); }
    }),

    importClients: (clients, newMembers) => mutate((ws) => {
      ws.teamMembers.push(...newMembers);
      ws.clients.push(...clients);
    }),

    mergeMember: (fromId, intoId) => mutate((ws) => {
      if (fromId === intoId || !ws.teamMembers.some((m) => m.id === intoId)) return;
      ws.teamMembers = ws.teamMembers.filter((m) => m.id !== fromId);
      for (const c of ws.clients) {
        if (c.teamMemberIds.includes(fromId)) {
          c.teamMemberIds = [...new Set(c.teamMemberIds.map((x) => (x === fromId ? intoId : x)))];
        }
      }
      for (const { d } of allDeliverables(ws)) for (const t of d.tasks) if (t.assigneeId === fromId) { t.assigneeId = intoId; touch(t); }
    }),

    addClient: (name) => {
      const client: Client = {
        ...stamp(), name: name.trim(), logo: null, teamMemberIds: [], plannedThrough: null,
        archived: false, adhoc: { deliverables: [emptyDeliverable('General')] }, meetings: [],
      };
      mutate((ws) => { ws.clients.push(client); });
      return client.id;
    },
    renameClient: (id, name) => mutate((ws) => { const c = findClient(ws, id); c.name = name.trim(); touch(c); }),
    setClientLogo: (id, logo) => mutate((ws) => { const c = findClient(ws, id); c.logo = logo; touch(c); }),
    toggleClientMember: (clientId, memberId) => mutate((ws) => {
      const c = findClient(ws, clientId);
      c.teamMemberIds = c.teamMemberIds.includes(memberId)
        ? c.teamMemberIds.filter((x) => x !== memberId)
        : [...c.teamMemberIds, memberId];
      touch(c);
    }),
    setPlannedThrough: (id, date) => mutate((ws) => { const c = findClient(ws, id); c.plannedThrough = date; touch(c); }),
    setArchived: (id, archived) => mutate((ws) => { const c = findClient(ws, id); c.archived = archived; touch(c); }),
    deleteClient: (id) => mutate((ws) => { ws.clients = ws.clients.filter((c) => c.id !== id); }),

    addMeeting: (clientId, date, title) => {
      const id = newId();
      mutate((ws) => {
        const t = now();
        findClient(ws, clientId).meetings.push({ id, createdAt: t, updatedAt: t, title: title.trim(), date, deliverables: [] });
      });
      return id;
    },
    updateMeeting: (clientId, meetingId, patch) => mutate((ws) => {
      const m = findBoard(ws, clientId, meetingId) as Draft<Client['meetings'][number]>;
      if (patch.title !== undefined) m.title = patch.title.trim();
      if (patch.date !== undefined) m.date = patch.date;
      touch(m);
    }),
    deleteMeeting: (clientId, meetingId) => mutate((ws) => {
      const c = findClient(ws, clientId);
      c.meetings = c.meetings.filter((m) => m.id !== meetingId);
    }),

    addDeliverable: (clientId, boardId, title) => {
      const d = emptyDeliverable(title.trim());
      mutate((ws) => { findBoard(ws, clientId, boardId).deliverables.push(d); });
      return d.id;
    },
    renameDeliverable: (id, title) => mutate((ws) => { const { d } = findDeliverable(ws, id); d.title = title.trim(); touch(d); }),
    deleteDeliverable: (id) => mutate((ws) => {
      const { list, d } = findDeliverable(ws, id);
      list.splice(list.indexOf(d), 1);
    }),
    moveDeliverable: (clientId, boardId, from, to) => mutate((ws) => { move(findBoard(ws, clientId, boardId).deliverables, from, to); }),

    addTask: (deliverableId, title) => {
      const task: Task = { ...stamp(), title: title.trim(), assigneeId: null, dueDate: null, done: false, subtasks: [] };
      mutate((ws) => { findDeliverable(ws, deliverableId).d.tasks.push(task); });
      return task.id;
    },
    updateTask: (id, patch) => mutate((ws) => {
      const { task } = findTask(ws, id);
      if (patch.title !== undefined) task.title = patch.title.trim();
      if (patch.assigneeId !== undefined) task.assigneeId = patch.assigneeId;
      if (patch.dueDate !== undefined) task.dueDate = patch.dueDate;
      touch(task);
    }),
    toggleTask: (id) => mutate((ws) => { const { task } = findTask(ws, id); task.done = !task.done; touch(task); }),
    deleteTask: (id) => mutate((ws) => {
      const { d, task } = findTask(ws, id);
      d.tasks.splice(d.tasks.indexOf(task), 1);
    }),
    moveTask: (deliverableId, from, to) => mutate((ws) => { move(findDeliverable(ws, deliverableId).d.tasks, from, to); }),

    addSubtask: (taskId, title) => {
      const t = now();
      const sub = { id: newId(), createdAt: t, updatedAt: t, title: title.trim(), done: false };
      mutate((ws) => { const { task } = findTask(ws, taskId); task.subtasks.push(sub); touch(task); });
      return sub.id;
    },
    renameSubtask: (id, title) => mutate((ws) => { const { sub } = findSubtask(ws, id); sub.title = title.trim(); touch(sub); }),
    toggleSubtask: (id) => mutate((ws) => { const { sub } = findSubtask(ws, id); sub.done = !sub.done; touch(sub); }),
    deleteSubtask: (id) => mutate((ws) => {
      const { task, sub } = findSubtask(ws, id);
      task.subtasks.splice(task.subtasks.indexOf(sub), 1);
      touch(task);
    }),
  };
});

/** Convenience for non-React code. */
export const actions = () => useStore.getState();

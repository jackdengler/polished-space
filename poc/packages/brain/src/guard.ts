/**
 * "Nothing is sent or changed without approval", enforced at runtime.
 *
 * Every write method (create/complete/reschedule task, send mail, create
 * event) is wrapped so it throws unless it runs inside `runApproved()`, which
 * only the approve path calls, for one suggestion the user approved. Code
 * scheduled from inside an approval does not leak the permission: hooks are
 * dispatched with `outsideApproval()`.
 *
 * Modules never receive the guarded write objects at all (see modules/types.ts);
 * this guard is the second line of defence.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { CalendarConnector, ChatConnector, FilesConnector, MailConnector, PmConnector } from '@poc/contracts';

interface ApprovalScope {
  suggestionId: string;
}

const scope = new AsyncLocalStorage<ApprovalScope>();

export class WriteOutsideApprovalError extends Error {
  override name = 'WriteOutsideApprovalError';
  constructor(method: string) {
    super(`${method} was called outside an approved suggestion; refused.`);
  }
}

/** Run `fn` as the action of approved suggestion `suggestionId`. Only approve.ts calls this. */
export function runApproved<T>(suggestionId: string, fn: () => Promise<T>): Promise<T> {
  return scope.run({ suggestionId }, fn);
}

/** Run `fn` with no approval scope (for hooks and background work). */
export function outsideApproval<T>(fn: () => T): T {
  return scope.exit(fn);
}

export function currentApproval(): string | null {
  return scope.getStore()?.suggestionId ?? null;
}

function check(method: string): void {
  if (!scope.getStore()) throw new WriteOutsideApprovalError(method);
}

export type PmReader = Pick<PmConnector, 'listClients' | 'listTasks'>;
export type MailReader = Pick<MailConnector, 'listSince' | 'get'>;
export type CalendarReader = Pick<CalendarConnector, 'view'>;

export interface Connectors {
  pm: PmConnector;
  mail: MailConnector;
  calendar: CalendarConnector;
  chat: ChatConnector;
  files: FilesConnector;
}

/** Read-only views: the only connector handles modules and the intake loop get. */
export interface ReadConnectors {
  pm: PmReader;
  mail: MailReader;
  calendar: CalendarReader;
  chat: ChatConnector;
  files: FilesConnector;
}

export function guardConnectors(c: Connectors): Connectors {
  const pm: PmConnector = {
    listClients: () => c.pm.listClients(),
    listTasks: (q) => c.pm.listTasks(q),
    createTask: async (i) => {
      check('createTask');
      return c.pm.createTask(i);
    },
    completeTask: async (id) => {
      check('completeTask');
      return c.pm.completeTask(id);
    },
    rescheduleTask: async (id, d) => {
      check('rescheduleTask');
      return c.pm.rescheduleTask(id, d);
    },
  };
  const mail: MailConnector = {
    listSince: (cur) => c.mail.listSince(cur),
    get: (id) => c.mail.get(id),
    send: async (d) => {
      check('sendMail');
      return c.mail.send(d);
    },
  };
  const calendar: CalendarConnector = {
    view: (s, e) => c.calendar.view(s, e),
    createEvent: async (e) => {
      check('createEvent');
      return c.calendar.createEvent(e);
    },
  };
  return { pm, mail, calendar, chat: c.chat, files: c.files };
}

export function readOnly(c: Connectors): ReadConnectors {
  return {
    pm: { listClients: () => c.pm.listClients(), listTasks: (q) => c.pm.listTasks(q) },
    mail: { listSince: (cur) => c.mail.listSince(cur), get: (id) => c.mail.get(id) },
    calendar: { view: (s, e) => c.calendar.view(s, e) },
    chat: c.chat,
    files: c.files,
  };
}

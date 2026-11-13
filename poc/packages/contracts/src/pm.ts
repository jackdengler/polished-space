import { z } from 'zod';
import { IsoDate } from './common';

/**
 * The PM app MCP server: exactly five tools (plan section 2.3). These are the
 * input and output schemas for each, shared by pm-server (which registers
 * them) and the brain's MCP client (which validates results).
 *
 * Tool results: pm-server returns the output object as MCP `structuredContent`
 * and also as one JSON text content block, so any MCP client can read it.
 */

/** Same shape as Planr's FlexDate (src/model/flexDate.ts). */
export const FlexDate = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('exact'), date: IsoDate }),
  z.object({ kind: z.literal('range'), label: z.string(), start: IsoDate, end: IsoDate }),
]);
export type FlexDate = z.infer<typeof FlexDate>;

/** A client contact as stored in Planr's client list (`contacts`). */
export const ClientContact = z.object({ name: z.string(), email: z.email(), role: z.string().default('') });
export type ClientContact = z.infer<typeof ClientContact>;

/** Planr's `ADHOC` board id. */
export const ADHOC_BOARD_ID = 'adhoc';
/** Deliverable that `create_task` files tasks under by default (created if missing). */
export const DEFAULT_DELIVERABLE_TITLE = 'General';

// ---- list_clients --------------------------------------------------------

export const ListClientsInput = z.object({});
export type ListClientsInput = z.infer<typeof ListClientsInput>;

export const PmProject = z.object({
  meetingId: z.string(),
  title: z.string(),
  date: FlexDate,
  deliverables: z.array(z.string()),
});
export type PmProject = z.infer<typeof PmProject>;

export const PmClient = z.object({
  id: z.string(),
  name: z.string(),
  archived: z.boolean(),
  nicknames: z.array(z.string()),
  emailDomains: z.array(z.string()),
  contacts: z.array(ClientContact),
  fileFolder: z.string().nullable(),
  /** Planr meetings (with their deliverable titles). The ad-hoc area is not listed. */
  projects: z.array(PmProject),
});
export type PmClient = z.infer<typeof PmClient>;

export const ListClientsOutput = z.object({ clients: z.array(PmClient) });
export type ListClientsOutput = z.infer<typeof ListClientsOutput>;

// ---- list_tasks ----------------------------------------------------------

export const ListTasksInput = z.object({
  clientId: z.string().optional(),
  assigneeId: z.string().optional(),
  includeDone: z.boolean().default(false),
  /** Inclusive. When `dueFrom` or `dueTo` is given, undated tasks are left out. */
  dueFrom: IsoDate.optional(),
  /** Inclusive. */
  dueTo: IsoDate.optional(),
});
export type ListTasksInput = z.input<typeof ListTasksInput>;

/** A Planr task, flattened out of client → board → deliverable. */
export const PmTask = z.object({
  id: z.string(),
  title: z.string(),
  done: z.boolean(),
  dueDate: IsoDate.nullable(),
  assigneeIds: z.array(z.string()),
  clientId: z.string(),
  clientName: z.string(),
  /** A meeting id, or `adhoc`. */
  boardId: z.string(),
  /** The meeting title, or `Ad-hoc`. */
  boardLabel: z.string(),
  deliverableId: z.string(),
  deliverableTitle: z.string(),
  updatedAt: z.string(),
});
export type PmTask = z.infer<typeof PmTask>;

export const ListTasksOutput = z.object({ tasks: z.array(PmTask) });
export type ListTasksOutput = z.infer<typeof ListTasksOutput>;

// ---- create_task ---------------------------------------------------------

export const CreateTaskInput = z.object({
  clientId: z.string().min(1),
  title: z.string().trim().min(1),
  dueDate: IsoDate.nullable().optional(),
  /** Defaults to [] at the MCP level. The brain always passes [me] (plan question 5). */
  assigneeIds: z.array(z.string()).optional(),
  /** Defaults to the client's Ad-hoc → "General" deliverable, created if missing. */
  deliverableId: z.string().optional(),
});
export type CreateTaskInput = z.infer<typeof CreateTaskInput>;

export const TaskOutput = z.object({ task: PmTask });
export type TaskOutput = z.infer<typeof TaskOutput>;
export const CreateTaskOutput = TaskOutput;
export type CreateTaskOutput = TaskOutput;

// ---- complete_task -------------------------------------------------------

/** Sets done: true. Idempotent (completing a done task is not an error). */
export const CompleteTaskInput = z.object({ taskId: z.string().min(1) });
export type CompleteTaskInput = z.infer<typeof CompleteTaskInput>;
export const CompleteTaskOutput = TaskOutput;
export type CompleteTaskOutput = TaskOutput;

// ---- reschedule_task -----------------------------------------------------

export const RescheduleTaskInput = z.object({ taskId: z.string().min(1), dueDate: IsoDate.nullable() });
export type RescheduleTaskInput = z.infer<typeof RescheduleTaskInput>;
export const RescheduleTaskOutput = TaskOutput;
export type RescheduleTaskOutput = TaskOutput;

// ---- the tool table ------------------------------------------------------

/** Exactly these five. A test in pm-server asserts `tools/list` returns these names and no others. */
export const MCP_TOOL_NAMES = ['list_clients', 'list_tasks', 'create_task', 'complete_task', 'reschedule_task'] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

/** The tools that change Planr. Only the brain's approve path may call these. */
export const MCP_WRITE_TOOLS = ['create_task', 'complete_task', 'reschedule_task'] as const satisfies readonly McpToolName[];

export const MCP_TOOLS = {
  list_clients: {
    description: 'List clients with their nicknames, email domains, contacts, file folder and projects.',
    input: ListClientsInput,
    output: ListClientsOutput,
  },
  list_tasks: {
    description: 'List tasks, flattened, optionally filtered by client, assignee and due date range. Open tasks only unless includeDone is true.',
    input: ListTasksInput,
    output: ListTasksOutput,
  },
  create_task: {
    description: "Create a task for a client. Goes in the client's Ad-hoc area, deliverable \"General\", unless a deliverableId is given.",
    input: CreateTaskInput,
    output: CreateTaskOutput,
  },
  complete_task: {
    description: 'Mark a task done. Idempotent.',
    input: CompleteTaskInput,
    output: CompleteTaskOutput,
  },
  reschedule_task: {
    description: 'Change a task due date (YYYY-MM-DD), or clear it with null.',
    input: RescheduleTaskInput,
    output: RescheduleTaskOutput,
  },
} as const satisfies Record<McpToolName, { description: string; input: z.ZodObject; output: z.ZodObject }>;

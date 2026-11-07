import { z } from 'zod';
import type { FlexDate } from './flexDate';

export const SCHEMA_VERSION = 1;

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const FlexDateSchema: z.ZodType<FlexDate> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('exact'), date: IsoDate }),
  z.object({ kind: z.literal('range'), label: z.string(), start: IsoDate, end: IsoDate }),
]);

/** Every record carries an id and timestamps, so a future server can merge changes. */
const record = { id: z.string(), createdAt: z.string(), updatedAt: z.string() };

export const SubtaskSchema = z.object({
  ...record,
  title: z.string(),
  done: z.boolean(),
});

export const TaskSchema = z.object({
  ...record,
  title: z.string(),
  assigneeId: z.string().nullable(),
  dueDate: IsoDate.nullable(),
  done: z.boolean(),
  subtasks: z.array(SubtaskSchema),
  /** Team members who marked this as one of their key tasks (personal gold highlight). */
  keyFor: z.array(z.string()).default([]),
});

export const DeliverableSchema = z.object({
  ...record,
  title: z.string(),
  tasks: z.array(TaskSchema),
});

export const MeetingSchema = z.object({
  ...record,
  title: z.string(),
  date: FlexDateSchema,
  /** When work on this meeting should start; shows on the weekly calendar like a task. */
  kickoff: z.object({ date: IsoDate, done: z.boolean() }).nullable().default(null),
  deliverables: z.array(DeliverableSchema),
});

export const ClientSchema = z.object({
  ...record,
  name: z.string(),
  /** File name inside the workspace's logos/ folder. */
  logo: z.string().nullable(),
  teamMemberIds: z.array(z.string()),
  plannedThrough: FlexDateSchema.nullable(),
  archived: z.boolean(),
  /** Work not tied to a meeting. Same shape as a meeting, minus the date. */
  adhoc: z.object({ deliverables: z.array(DeliverableSchema) }),
  meetings: z.array(MeetingSchema),
});

export const ROLES = ['Principal', 'Sr Consultant', 'Consultant', 'Sr Associate', 'Associate', 'Unassigned'] as const;
export type Role = (typeof ROLES)[number];

export const TeamMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  /** Seniority, set in the Team list; decides the column a person appears in everywhere. */
  role: z.enum(ROLES).default('Unassigned'),
});

export const WorkspaceSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  teamMembers: z.array(TeamMemberSchema),
  clients: z.array(ClientSchema),
});

export type Subtask = z.infer<typeof SubtaskSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Deliverable = z.infer<typeof DeliverableSchema>;
export type Meeting = z.infer<typeof MeetingSchema>;
export type Client = z.infer<typeof ClientSchema>;
export type TeamMember = z.infer<typeof TeamMemberSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;

/** A "board" is either a meeting or a client's ad-hoc area. */
export const ADHOC = 'adhoc';
export type BoardId = string; // a meeting id, or ADHOC

export const emptyWorkspace = (): Workspace => ({ schemaVersion: SCHEMA_VERSION, teamMembers: [], clients: [] });

/** Validate data read from disk. Throws a readable error. */
export function parseWorkspace(data: unknown): Workspace {
  const result = WorkspaceSchema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.join('.') || '(root)';
    throw new Error(`workspace.json is not valid: ${where}: ${issue?.message ?? 'unknown problem'}`);
  }
  return result.data;
}

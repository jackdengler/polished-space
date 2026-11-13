/**
 * TaskMeta overlay (`data/brain/taskmeta.json`, keyed by Planr task id): what
 * Planr has no field for (source link, direction, type, on hold, Today order,
 * quick win, prepared work). These are the assistant's own notes, so they
 * change without an approval.
 */
import { TaskMeta } from '@poc/contracts';
import { JsonFile } from './jsonFile';

export type TaskMetaPatch = Partial<Omit<TaskMeta, 'taskId'>>;

export class TaskMetaStore {
  private items: Record<string, TaskMeta> = {};
  private file: JsonFile<Record<string, TaskMeta>>;
  private listeners: (() => void)[] = [];

  constructor(path: string) {
    this.file = new JsonFile(path);
  }

  async load(): Promise<void> {
    const raw = await this.file.load({});
    this.items = {};
    for (const [id, v] of Object.entries(raw ?? {})) {
      const p = TaskMeta.safeParse(v);
      if (p.success) this.items[id] = p.data;
    }
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  get(taskId: string): TaskMeta | null {
    const m = this.items[taskId];
    return m ? structuredClone(m) : null;
  }

  all(): Record<string, TaskMeta> {
    return structuredClone(this.items);
  }

  /**
   * Merge `patch` into the task's overlay, creating it if missing (a task
   * added by hand in Planr gets direction `i_owe`, type `other`, no source).
   */
  async upsert(taskId: string, patch: TaskMetaPatch): Promise<TaskMeta> {
    return (await this.upsertMany([[taskId, patch]]))[0]!;
  }

  async upsertMany(entries: [string, TaskMetaPatch][]): Promise<TaskMeta[]> {
    const out: TaskMeta[] = [];
    for (const [taskId, patch] of entries) {
      const base = this.items[taskId] ?? { taskId, source: null, direction: 'i_owe', taskType: 'other' };
      const next = TaskMeta.parse({ ...base, ...patch, taskId });
      this.items[taskId] = next;
      out.push(structuredClone(next));
    }
    await this.file.save(this.items);
    for (const l of this.listeners) l();
    return out;
  }
}

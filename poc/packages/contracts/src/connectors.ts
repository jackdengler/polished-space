import type { CalEvent, NewCalEvent } from './calendar';
import type { ChatMessage } from './chat';
import type { FileContent, FileInfo } from './files';
import type { MailDraft, MailMessage } from './mail';
import type {
  CompleteTaskOutput,
  CreateTaskInput,
  CreateTaskOutput,
  ListClientsOutput,
  ListTasksInput,
  ListTasksOutput,
  RescheduleTaskOutput,
} from './pm';
import type { SttEvent } from './voice';

/**
 * The interfaces the brain codes against (plan section 3.4). The POC
 * implementations are thin HTTP clients for the mocks, pm-server MCP and the
 * speech service. V1 swaps the class (real Graph, Zoom, file indexer), not the
 * brain. Test fakes for each live in `@poc/contracts/testing`.
 *
 * Cursor rule (mail and chat): the cursor is an opaque string. Pass `''` to
 * start from the beginning, or `SeedInfo.intakeCursor` to skip seeded
 * history. `listSince` returns items strictly after the cursor, oldest first,
 * and the cursor to pass next time (unchanged when there is nothing new).
 * The POC implementations use the last item's ISO timestamp as the cursor.
 */

export interface MailConnector {
  listSince(cursor: string): Promise<{ items: MailMessage[]; cursor: string }>;
  get(id: string): Promise<MailMessage>;
  /** Sends through Graph sendMail; the mock files it in Sent. Returns the sent message's id. */
  send(draft: MailDraft): Promise<{ id: string }>;
}

export interface CalendarConnector {
  /** Events overlapping [startIso, endIso), sorted by start. */
  view(startIso: string, endIso: string): Promise<CalEvent[]>;
  createEvent(e: NewCalEvent): Promise<CalEvent>;
}

export interface ChatConnector {
  listSince(cursor: string): Promise<{ items: ChatMessage[]; cursor: string }>;
}

export interface FilesConnector {
  /** Files under a client folder (recursive), sorted by path. Unknown folder: []. */
  list(folder: string): Promise<FileInfo[]>;
  /** Read one file by FileInfo.path. Rejects paths outside the files root. */
  read(path: string): Promise<FileContent>;
}

/**
 * MCP-backed (the five tools). Write methods may only be called from the
 * brain's approve path; a test enforces this with a spy.
 */
export interface PmConnector {
  listClients(): Promise<ListClientsOutput>;
  listTasks(q?: ListTasksInput): Promise<ListTasksOutput>;
  createTask(i: CreateTaskInput): Promise<CreateTaskOutput>;
  completeTask(taskId: string): Promise<CompleteTaskOutput>;
  rescheduleTask(taskId: string, dueDate: string | null): Promise<RescheduleTaskOutput>;
}

/** One streaming recognition session. */
export interface SttStream {
  /** Push PCM16 LE mono 16 kHz audio. */
  write(pcm: Uint8Array): void;
  /** speech_start, partial and final events, in order. Ends after close(). */
  events: AsyncIterable<SttEvent>;
  close(): void;
}

export interface SpeechToText {
  open(): SttStream;
}

export interface TextToSpeech {
  /** Sample rate of the PCM16 LE mono chunks that `speak` yields. */
  readonly sampleRate: number;
  /** Stream audio for `text`. Stops promptly (iteration ends, no more chunks) when `signal` aborts. */
  speak(text: string, signal: AbortSignal): AsyncIterable<Uint8Array>;
}

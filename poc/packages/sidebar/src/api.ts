import {
  CHAT_SSE_EVENTS,
  ConversationResponse,
  SourceMessage,
  DecisionResponse,
  FileView,
  InputResponse,
  PATHS,
  PreparedResponse,
  ProfileDoc,
  ProfileListResponse,
  SidebarState,
  TaskMeta,
  type ApproveBody,
  type Suggestion,
} from '@poc/contracts';
import type { z } from 'zod';
import { readSse } from './sse';

/**
 * Every call the sidebar makes to the brain. Only relative `/api/...` paths
 * from the contract's `PATHS.brain`, so the app works behind the gateway
 * (same origin) and against the fixture server alike.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Validate a brain response against its contract schema. On a mismatch we
 * warn (so drift shows up during integration) and use the data as sent,
 * rather than blanking the sidebar.
 */
export function checked<S extends z.ZodType>(schema: S, data: unknown, what: string): z.infer<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  console.warn(`[sidebar] ${what} does not match the contract`, r.error.issues.slice(0, 5));
  return data as z.infer<S>;
}

/** What the user reads when the assistant (brain) is not answering: plain English, never a proxy's error text. */
export const ASSISTANT_DOWN = 'The assistant isn’t answering right now, so nothing was changed. Try again in a moment.';

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    });
  } catch {
    throw new ApiError(ASSISTANT_DOWN, 0);
  }
  // The gateway answers for a brain that is down (code "upstream_down"); a bare 502/504 with no JSON body is the same.
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    const text = await res.clone().text();
    let parsed: { code?: string; error?: string } | null = null;
    try {
      parsed = JSON.parse(text) as { code?: string; error?: string };
    } catch {
      /* not JSON */
    }
    if (!parsed || parsed.code === 'upstream_down' || typeof parsed.error !== 'string') throw new ApiError(ASSISTANT_DOWN, res.status);
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok) {
    const msg = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return body;
}

const post = (path: string, body?: unknown) => request(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  async state(): Promise<SidebarState> {
    return checked(SidebarState, await request(PATHS.brain.state), 'GET /api/state');
  },

  async approve(id: string, edits?: ApproveBody['edits']): Promise<Suggestion> {
    const body: ApproveBody = edits && Object.keys(edits).length ? { edits } : {};
    return checked(DecisionResponse, await post(PATHS.brain.approve(id), body), 'approve').suggestion;
  },

  async deny(id: string): Promise<Suggestion> {
    return checked(DecisionResponse, await post(PATHS.brain.deny(id), {}), 'deny').suggestion;
  },

  async input(text: string): Promise<Suggestion[]> {
    return checked(InputResponse, await post(PATHS.brain.input, { text }), 'POST /api/input').suggestions;
  },

  async prepared(taskId: string): Promise<PreparedResponse> {
    return checked(PreparedResponse, await request(PATHS.brain.prepared(taskId)), 'GET prepared');
  },

  /**
   * Ask for (re)generation. The contract gives no response body for this
   * endpoint, so callers re-read `prepared` afterwards rather than relying on it.
   */
  async prepare(taskId: string): Promise<void> {
    await post(PATHS.brain.prepare(taskId), {});
  },

  /** The client file behind a file review (text, or text taken from a PDF). */
  async file(path: string): Promise<FileView> {
    return checked(FileView, await request(PATHS.brain.file(path)), 'GET file');
  },

  async hold(taskId: string, onHold: boolean): Promise<TaskMeta> {
    return checked(TaskMeta, await post(PATHS.brain.hold(taskId), { onHold }), 'hold');
  },

  async profiles(): Promise<ProfileListResponse['profiles']> {
    return checked(ProfileListResponse, await request(PATHS.brain.profiles), 'GET /api/profiles').profiles;
  },

  async profile(clientId: string): Promise<ProfileDoc> {
    return checked(ProfileDoc, await request(PATHS.brain.profile(clientId)), 'GET profile');
  },

  /** The original email or chat message behind a source link. */
  async source(connector: 'mail' | 'chat', id: string): Promise<SourceMessage> {
    return checked(SourceMessage, await request(PATHS.brain.source(connector, id)), 'GET source');
  },

  async conversation(): Promise<ConversationResponse['turns']> {
    return checked(ConversationResponse, await request(PATHS.brain.conversation), 'GET conversation').turns;
  },
};

export type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'suggestion'; suggestion: Suggestion }
  | { type: 'done'; text: string }
  | { type: 'error'; error: string };

/** `POST /api/chat`: streams the assistant's reply as SSE events. */
export async function streamChat(text: string, onEvent: (e: ChatEvent) => void, signal?: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch(PATHS.brain.chat, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify({ text }),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) return;
    throw new ApiError(ASSISTANT_DOWN, 0);
  }
  if ((res.status === 502 || res.status === 504) && !(res.headers.get('content-type') ?? '').includes('event-stream')) {
    const b = (await res.clone().json().catch(() => null)) as { code?: string } | null;
    if (!b || b.code === 'upstream_down') throw new ApiError(ASSISTANT_DOWN, res.status);
  }
  if (!res.ok || !res.body) {
    let msg = `Chat failed (${res.status})`;
    try {
      const b = (await res.json()) as { error?: string };
      if (b.error) msg = b.error;
    } catch {
      /* keep the generic message */
    }
    throw new ApiError(msg, res.status);
  }
  await readSse(
    res.body,
    (m) => {
      let data: unknown;
      try {
        data = JSON.parse(m.data);
      } catch {
        return;
      }
      switch (m.event) {
        case 'delta':
          onEvent({ type: 'delta', text: checked(CHAT_SSE_EVENTS.delta, data, 'chat delta').text });
          break;
        case 'suggestion':
          onEvent({ type: 'suggestion', suggestion: checked(CHAT_SSE_EVENTS.suggestion, data, 'chat suggestion').suggestion });
          break;
        case 'done':
          onEvent({ type: 'done', text: checked(CHAT_SSE_EVENTS.done, data, 'chat done').text });
          break;
        case 'error':
          onEvent({ type: 'error', error: checked(CHAT_SSE_EVENTS.error, data, 'chat error').error });
          break;
      }
    },
    signal,
  );
}

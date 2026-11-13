import { create } from 'zustand';
import type { ApproveBody, ConversationTurn, Nudge, SidebarState, SourceRef, Suggestion } from '@poc/contracts';
import { api, ApiError, streamChat } from './api';

export type Connection = 'connecting' | 'live' | 'lost';
export type Overlay = null | { kind: 'task'; taskId: string } | { kind: 'profiles' } | { kind: 'profile'; clientId: string };
export type VoiceStatus = 'off' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';
export type Theme = 'system' | 'light' | 'dark';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  via: 'text' | 'voice';
  /** Suggestions proposed during this turn (shown inline as cards). */
  suggestions: Suggestion[];
  status: 'streaming' | 'done' | 'error' | 'interrupted';
  error?: string;
  /** For voice turns: suggestion ids that existed when the turn started (new voice suggestions after it belong to this turn). */
  baseline?: string[];
}

export interface UiStore {
  state: SidebarState | null;
  connection: Connection;
  tab: 'list' | 'chat';
  overlay: Overlay;
  dismissedNudges: string[];
  expandedNudges: string[];
  chat: ChatMessage[];
  chatBusy: boolean;
  voice: { status: VoiceStatus; partial: string; error: string | null };
  /** Suggestion ids with a decision in flight. */
  inFlight: Record<string, 'approve' | 'deny'>;
  /** Last decision error per suggestion (request failures, 400s). */
  decisionErrors: Record<string, string>;
  /** Suggestions decided in this session, as the brain returned them (for chat cards after they leave state). */
  decided: Record<string, Suggestion>;
  /** Nudges that arrived by the `nudge` SSE event and are not yet in a state snapshot. */
  liveNudges: Nudge[];
  theme: Theme;
  /** The source message open in the source dialog (D4), and the element to give focus back to. */
  sourceOpen: { source: SourceRef; returnTo: HTMLElement | null } | null;
  /** True once the stored conversation has been loaded into `chat` (D10). */
  chatLoaded: boolean;

  setState(s: SidebarState): void;
  openSource(source: SourceRef | null, returnTo?: HTMLElement | null): void;
  loadHistory(turns: ConversationTurn[]): void;
  addNudge(n: Nudge): void;
  setConnection(c: Connection): void;
  setTab(t: 'list' | 'chat'): void;
  open(o: Overlay): void;
  dismissNudge(id: string): void;
  toggleNudge(id: string, open?: boolean): void;
  decide(id: string, decision: 'approve' | 'deny', edits?: ApproveBody['edits']): Promise<boolean>;
  sendChat(text: string): Promise<void>;
  setTheme(t: Theme): void;
  // voice-driven chat updates
  setVoice(v: Partial<UiStore['voice']>): void;
  voiceUserTurn(text: string): void;
  voiceDelta(text: string): void;
  voiceDone(text: string): void;
  voiceInterrupted(spokenText: string): void;
}

const DISMISSED_KEY = 'poc-sidebar-dismissed-nudges';
const THEME_KEY = 'poc-sidebar-theme';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage may be unavailable; dismissals then last for this session */
  }
}

let seq = 0;
const newId = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function applyTheme(t: Theme): void {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
}

function updateLastAssistant(chat: ChatMessage[], fn: (m: ChatMessage) => ChatMessage): ChatMessage[] {
  for (let i = chat.length - 1; i >= 0; i--) {
    const m = chat[i]!;
    if (m.role === 'assistant') {
      const next = chat.slice();
      next[i] = fn(m);
      return next;
    }
  }
  return chat;
}

export const useUi = create<UiStore>()((set, get) => ({
  state: null,
  connection: 'connecting',
  tab: 'list',
  overlay: null,
  dismissedNudges: readJson<string[]>(DISMISSED_KEY, []),
  expandedNudges: [],
  chat: [],
  chatBusy: false,
  voice: { status: 'off', partial: '', error: null },
  inFlight: {},
  decisionErrors: {},
  decided: {},
  liveNudges: [],
  theme: readJson<Theme>(THEME_KEY, 'system'),
  sourceOpen: null,
  chatLoaded: false,

  openSource(source, returnTo = null) {
    const prev = get().sourceOpen;
    set({ sourceOpen: source ? { source, returnTo } : null });
    if (!source) requestAnimationFrame(() => prev?.returnTo?.focus());
  },
  loadHistory(turns) {
    set((st) => {
      if (st.chatLoaded) return st;
      const old: ChatMessage[] = turns.flatMap((t) => [
        { id: `${t.id}-u`, role: 'user' as const, text: t.user, via: t.via, suggestions: [], status: 'done' as const },
        { id: `${t.id}-a`, role: 'assistant' as const, text: t.assistant, via: t.via, suggestions: (st.state?.suggestions ?? []).filter((x) => t.suggestionIds.includes(x.id)), status: t.interrupted ? ('interrupted' as const) : ('done' as const) },
      ]);
      // Keep anything said in this session before the history arrived, after it.
      return { chat: [...old, ...st.chat], chatLoaded: true };
    });
  },

  setState(s) {
    const known = new Set(s.nudges.map((n) => n.id));
    set((st) => {
      // Voice turns have no suggestion event on the socket; attach suggestions
      // from voice that appeared since the turn started to that turn's reply.
      let chat = st.chat;
      const voiceTurn = [...chat].reverse().find((m) => m.role === 'assistant' && m.via === 'voice');
      if (voiceTurn?.baseline) {
        const base = new Set(voiceTurn.baseline);
        const fresh = s.suggestions.filter((x) => x.source?.connector === 'voice' && !base.has(x.id) && !voiceTurn.suggestions.some((y) => y.id === x.id));
        if (fresh.length) chat = chat.map((m) => (m === voiceTurn ? { ...m, suggestions: [...m.suggestions, ...fresh] } : m));
      }
      return { state: s, liveNudges: st.liveNudges.filter((n) => !known.has(n.id)), chat };
    });
  },
  addNudge(n) {
    set((st) => (st.liveNudges.some((x) => x.id === n.id) || st.state?.nudges.some((x) => x.id === n.id) ? st : { liveNudges: [n, ...st.liveNudges] }));
  },
  setConnection(c) {
    set({ connection: c });
  },
  setTab(t) {
    set({ tab: t, overlay: null });
  },
  open(o) {
    set({ overlay: o });
  },
  dismissNudge(id) {
    const next = [...get().dismissedNudges.filter((x) => x !== id), id].slice(-200);
    writeJson(DISMISSED_KEY, next);
    set({ dismissedNudges: next });
  },
  toggleNudge(id, open) {
    set((st) => {
      const isOpen = st.expandedNudges.includes(id);
      const want = open ?? !isOpen;
      return { expandedNudges: want ? [...st.expandedNudges.filter((x) => x !== id), id] : st.expandedNudges.filter((x) => x !== id) };
    });
  },

  async decide(id, decision, edits) {
    if (get().inFlight[id]) return false;
    set((st) => {
      const errs = { ...st.decisionErrors };
      delete errs[id];
      return { inFlight: { ...st.inFlight, [id]: decision }, decisionErrors: errs };
    });
    try {
      const s = decision === 'approve' ? await api.approve(id, edits) : await api.deny(id);
      set((st) => {
        const state = st.state && {
          ...st.state,
          suggestions:
            s.status === 'pending' || s.status === 'failed' ? st.state.suggestions.map((x) => (x.id === id ? s : x)) : st.state.suggestions.filter((x) => x.id !== id),
        };
        return { state, decided: { ...st.decided, [id]: s } };
      });
      return s.status !== 'failed';
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Something went wrong.';
      set((st) => ({ decisionErrors: { ...st.decisionErrors, [id]: msg } }));
      return false;
    } finally {
      set((st) => {
        const f = { ...st.inFlight };
        delete f[id];
        return { inFlight: f };
      });
    }
  },

  async sendChat(text) {
    const t = text.trim();
    if (!t || get().chatBusy) return;
    const user: ChatMessage = { id: newId('u'), role: 'user', text: t, via: 'text', suggestions: [], status: 'done' };
    const reply: ChatMessage = { id: newId('a'), role: 'assistant', text: '', via: 'text', suggestions: [], status: 'streaming' };
    set((st) => ({ chat: [...st.chat, user, reply], chatBusy: true, tab: 'chat', overlay: null }));
    const patch = (fn: (m: ChatMessage) => ChatMessage) => set((st) => ({ chat: st.chat.map((m) => (m.id === reply.id ? fn(m) : m)) }));
    try {
      await streamChat(t, (e) => {
        if (e.type === 'delta') patch((m) => ({ ...m, text: m.text + e.text }));
        else if (e.type === 'suggestion') patch((m) => ({ ...m, suggestions: [...m.suggestions.filter((x) => x.id !== e.suggestion.id), e.suggestion] }));
        else if (e.type === 'done') patch((m) => ({ ...m, text: e.text || m.text, status: 'done' }));
        else patch((m) => ({ ...m, status: 'error', error: e.error }));
      });
      patch((m) => (m.status === 'streaming' ? { ...m, status: 'done' } : m));
    } catch (e) {
      patch((m) => ({ ...m, status: 'error', error: e instanceof Error ? e.message : 'Chat failed.' }));
    } finally {
      set({ chatBusy: false });
    }
  },

  setTheme(t) {
    writeJson(THEME_KEY, t);
    applyTheme(t);
    set({ theme: t });
  },

  setVoice(v) {
    set((st) => ({ voice: { ...st.voice, ...v } }));
  },
  voiceUserTurn(text) {
    set((st) => ({
      chat: [
        ...st.chat,
        { id: newId('u'), role: 'user', text, via: 'voice', suggestions: [], status: 'done' },
        { id: newId('a'), role: 'assistant', text: '', via: 'voice', suggestions: [], status: 'streaming', baseline: [...(st.state?.suggestions.map((x) => x.id) ?? []), ...Object.keys(st.decided)] },
      ],
      voice: { ...st.voice, partial: '', status: 'thinking' },
    }));
  },
  voiceDelta(text) {
    set((st) => ({ chat: updateLastAssistant(st.chat, (m) => (m.via === 'voice' && m.status === 'streaming' ? { ...m, text: m.text + text } : m)) }));
  },
  voiceDone(text) {
    set((st) => ({ chat: updateLastAssistant(st.chat, (m) => (m.via === 'voice' && m.status === 'streaming' ? { ...m, text: text || m.text, status: 'done' } : m)) }));
  },
  voiceInterrupted(spokenText) {
    set((st) => ({
      chat: updateLastAssistant(st.chat, (m) => (m.via === 'voice' && m.status === 'streaming' ? { ...m, text: spokenText, status: 'interrupted' } : m)),
    }));
  },
}));

/** Pending/failed suggestion by id from the current state, else the decided copy. */
export function findSuggestion(st: Pick<UiStore, 'state' | 'decided'>, id: string): Suggestion | undefined {
  return st.state?.suggestions.find((s) => s.id === id) ?? st.decided[id];
}

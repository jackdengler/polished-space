import { useEffect, useMemo } from 'react';
import { useUi, type Theme } from './store';
import { connectBrain, reconnectNow } from './events';
import { arrange } from './derive';
import { eventEnd, eventStart, time, usd } from './format';
import { Icon } from './components/Icon';
import { Nudges } from './components/Nudges';
import { TaskList } from './components/TaskList';
import { SuggestionCard } from './components/SuggestionCard';
import { PreparedView } from './components/PreparedView';
import { ChatView } from './components/ChatView';
import { Composer } from './components/Composer';
import { ProfileList, ProfileViewer } from './components/Profiles';

const THEME_NEXT: Record<Theme, Theme> = { system: 'light', light: 'dark', dark: 'system' };
const THEME_ICON = { system: 'monitor', light: 'sun', dark: 'moon' } as const;

function Header() {
  const state = useUi((s) => s.state);
  const connection = useUi((s) => s.connection);
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const tab = useUi((s) => s.tab);
  const setTab = useUi((s) => s.setTab);
  const overlay = useUi((s) => s.overlay);
  // Suggestions waiting for a decision, not counting prepared work (that lives on its task).
  const openCount = useUi((s) => {
    if (!s.state) return 0;
    const a = arrange(s.state, [], []);
    return a.inbox.length + a.loose.length + a.nudges.reduce((n, x) => n + x.suggestions.length, 0);
  });

  const next = useMemo(() => {
    if (!state) return null;
    const now = Date.parse(state.now);
    return state.calendarToday.find((e) => !e.isAllDay && e.showAs !== 'free' && Date.parse(eventEnd(e)) > now) ?? null;
  }, [state]);
  const dateLabel = state ? new Date(`${state.today}T12:00:00Z`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '';

  return (
    <header className="top">
      <div className="top-row">
        <span className="brand">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="2" y="2" width="20" height="20" rx="6" fill="var(--accent)" />
            <path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="var(--accent-text)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="brand-name">Planr Assistant</span>
        </span>
        <span className={`conn conn-${connection}`} role="status" title={connection === 'live' ? 'Connected' : connection === 'lost' ? 'Connection lost' : 'Connecting'}>
          <span className="conn-dot" aria-hidden="true" />
          <span className="sr-only">{connection === 'live' ? 'Connected' : connection === 'lost' ? 'Connection lost' : 'Connecting'}</span>
        </span>
        <button type="button" className="icon-btn" onClick={() => setTheme(THEME_NEXT[theme])} aria-label={`Theme: ${theme}. Switch to ${THEME_NEXT[theme]}`} title={`Theme: ${theme}`}>
          <Icon name={THEME_ICON[theme]} size={16} />
        </button>
      </div>
      {state ? (
        <p className="top-sub">
          <span>{dateLabel}</span>
          {next ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="next-meeting" title={next.subject}>
                <Icon name="calendar" size={12} /> {Date.parse(eventStart(next)) <= Date.parse(state.now) ? 'Now' : time(eventStart(next))} {next.subject}
              </span>
            </>
          ) : (
            <>
              <span aria-hidden="true">·</span>
              <span>No more meetings today</span>
            </>
          )}
        </p>
      ) : null}
      <div className="tabs" role="tablist" aria-label="View">
        <button type="button" role="tab" id="tab-list" aria-selected={tab === 'list' && !overlay} aria-controls="main" className="tab" onClick={() => setTab('list')}>
          My day
          {openCount ? <span className="tab-badge" aria-label={`${openCount} waiting for you`}>{openCount}</span> : null}
        </button>
        <button type="button" role="tab" id="tab-chat" aria-selected={tab === 'chat' && !overlay} aria-controls="main" className="tab" onClick={() => setTab('chat')}>
          Chat
        </button>
      </div>
    </header>
  );
}

function ConnectionBanner() {
  const connection = useUi((s) => s.connection);
  const hasState = useUi((s) => s.state !== null);
  if (connection !== 'lost') return null;
  return (
    <div className="banner" role="alert">
      <Icon name="offline" size={15} />
      <span className="grow">{hasState ? 'Connection lost. Showing the last list I had; approvals are paused.' : 'Can’t reach the assistant.'} Reconnecting…</span>
      <button type="button" className="btn btn-sm" onClick={() => void reconnectNow()}>
        Try now
      </button>
    </div>
  );
}

function ListView() {
  const state = useUi((s) => s.state);
  const dismissed = useUi((s) => s.dismissedNudges);
  const liveNudges = useUi((s) => s.liveNudges);
  const a = useMemo(() => (state ? arrange(state, dismissed, liveNudges) : null), [state, dismissed, liveNudges]);
  if (!state || !a) return null;
  const taskCount = state.sections.reduce((n, s) => n + s.items.length, 0);
  return (
    <>
      <Nudges items={a.nudges} />
      {a.loose.length ? (
        <section className="waiting" aria-label="Waiting for your OK">
          <h2 className="group-title">Waiting for your OK</h2>
          {a.loose.map((s) => (
            <SuggestionCard key={s.id} suggestion={s} showNudge />
          ))}
        </section>
      ) : null}
      {taskCount === 0 && a.nudges.length === 0 && a.loose.length === 0 && a.inbox.length === 0 ? (
        <div className="empty-state compact">
          <Icon name="check" size={24} />
          <p className="empty-title">You’re all clear</p>
          <p className="muted small">New emails and chats will show up here as suggestions.</p>
        </div>
      ) : null}
      <TaskList sections={state.sections} inboxSuggestions={a.inbox} />
    </>
  );
}

function Footer() {
  const usage = useUi((s) => s.state?.usageToday);
  const open = useUi((s) => s.open);
  return (
    <footer className="foot">
      <span className="cost" title={usage ? `${usage.calls} Claude calls today · ${usage.inputTokens.toLocaleString()} in / ${usage.outputTokens.toLocaleString()} out tokens` : undefined}>
        {usage ? (
          <>
            <strong>{usd(usage.estUsd)}</strong> today · {usage.calls} call{usage.calls === 1 ? '' : 's'}
          </>
        ) : (
          '—'
        )}
      </span>
      <button type="button" className="link small" onClick={() => open({ kind: 'profiles' })}>
        <Icon name="book" size={13} /> Client profiles
      </button>
    </footer>
  );
}

export function App() {
  const state = useUi((s) => s.state);
  const connection = useUi((s) => s.connection);
  const tab = useUi((s) => s.tab);
  const overlay = useUi((s) => s.overlay);
  const open = useUi((s) => s.open);

  useEffect(() => connectBrain(), []);

  // Escape closes a panel (when focus is not in a form that handles it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && useUi.getState().overlay && !e.defaultPrevented) {
        const t = e.target as HTMLElement | null;
        if (t && t.closest('form')) return;
        open(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  let body;
  if (!state) {
    body =
      connection === 'lost' ? null : (
        <div className="empty-state">
          <span className="spinner big" aria-hidden="true" />
          <p className="empty-title">Connecting to your assistant…</p>
        </div>
      );
  } else if (overlay?.kind === 'task') body = <PreparedView key={overlay.taskId} taskId={overlay.taskId} />;
  else if (overlay?.kind === 'profiles') body = <ProfileList />;
  else if (overlay?.kind === 'profile') body = <ProfileViewer clientId={overlay.clientId} />;
  else body = tab === 'chat' ? <ChatView /> : <ListView />;

  return (
    <div className="shell">
      <Header />
      <ConnectionBanner />
      <main id="main" className="main-scroll" role={overlay ? undefined : 'tabpanel'} aria-labelledby={overlay ? undefined : tab === 'chat' ? 'tab-chat' : 'tab-list'}>
        {body}
      </main>
      <Composer />
      <Footer />
    </div>
  );
}

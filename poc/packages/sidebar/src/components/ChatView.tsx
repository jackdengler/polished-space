import { useEffect, useRef } from 'react';
import { useUi, type ChatMessage } from '../store';
import { Icon } from './Icon';
import { SuggestionCard } from './SuggestionCard';

function Message({ m }: { m: ChatMessage }) {
  // Show the live copy of each suggestion (status changes), else the copy from the turn.
  const live = useUi((s) => s.state?.suggestions);
  const decided = useUi((s) => s.decided);
  return (
    <li className={`msg msg-${m.role}`} data-status={m.status}>
      <div className="msg-bubble">
        {m.via === 'voice' ? (
          <span className="msg-via" title="Spoken">
            <Icon name="mic" size={11} />
          </span>
        ) : null}
        {m.text ? <span className="msg-text">{m.text}</span> : m.status === 'streaming' ? <span className="typing" aria-label="Assistant is replying"><i /><i /><i /></span> : null}
        {m.status === 'streaming' && m.text ? <span className="caret" aria-hidden="true" /> : null}
        {m.status === 'interrupted' ? <span className="msg-note">(interrupted)</span> : null}
      </div>
      {m.status === 'error' ? (
        <p className="form-error" role="alert">
          <Icon name="alert" size={14} /> {m.error ?? 'Something went wrong.'}
        </p>
      ) : null}
      {m.suggestions.length ? (
        <div className="msg-cards">
          {m.suggestions.map((s) => (
            <SuggestionCard key={s.id} suggestion={live?.find((x) => x.id === s.id) ?? decided[s.id] ?? s} />
          ))}
        </div>
      ) : null}
    </li>
  );
}

export function ChatView() {
  const chat = useUi((s) => s.chat);
  const endRef = useRef<HTMLDivElement>(null);
  const last = chat[chat.length - 1];
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [chat.length, last?.text, last?.suggestions.length]);

  if (!chat.length) {
    return (
      <div className="empty-state">
        <Icon name="chat" size={28} />
        <p className="empty-title">Ask me anything about your day</p>
        <p className="muted small">Type or tap the mic. “What’s most urgent?” · “Add a task to chase Michael on Friday” · “Draft a reply to Renata”.</p>
      </div>
    );
  }
  return (
    <div className="chat">
      <ol className="msgs" aria-live="polite" aria-relevant="additions text">
        {chat.map((m) => (
          <Message key={m.id} m={m} />
        ))}
      </ol>
      <div ref={endRef} />
    </div>
  );
}

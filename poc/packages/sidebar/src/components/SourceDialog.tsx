import { useEffect, useRef, useState } from 'react';
import type { SourceMessage } from '@poc/contracts';
import { api, ApiError } from '../api';
import { useUi } from '../store';
import { SOURCE_ICON } from '../format';
import { Icon } from './Icon';
import { FileBlock } from './PreparedView';

let whenFmt: Intl.DateTimeFormat | null = null;
function when(iso: string): string {
  whenFmt ??= new Intl.DateTimeFormat([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return whenFmt.format(new Date(iso));
}

/**
 * The original message behind a source link (D4): sender, time, subject and
 * body of the email or chat message, or the client file itself. Read only.
 * A modal dialog over the sidebar: focus moves in, Escape or Close returns it.
 */
export function SourceDialog() {
  const open = useUi((s) => s.sourceOpen);
  const close = () => useUi.getState().openSource(null);
  const [msg, setMsg] = useState<SourceMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const source = open?.source ?? null;

  useEffect(() => {
    setMsg(null);
    setError(null);
    if (!source || (source.connector !== 'mail' && source.connector !== 'chat')) return;
    let live = true;
    api.source(source.connector, source.id).then(
      (m) => live && setMsg(m),
      (e: unknown) => live && setError(e instanceof ApiError ? e.message : 'Could not open the message.'),
    );
    return () => {
      live = false;
    };
  }, [source?.connector, source?.id]);

  useEffect(() => {
    if (source) headRef.current?.focus();
  }, [source]);

  if (!source) return null;
  const title = source.connector === 'files' ? 'The file' : source.connector === 'chat' ? 'The chat message' : 'The email';
  return (
    <div className="dialog-backdrop" onClick={close}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Keep Tab inside the dialog.
          if (e.key !== 'Tab') return;
          const f = [...e.currentTarget.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]')];
          if (!f.length) return;
          if (e.shiftKey && document.activeElement === f[0]) {
            e.preventDefault();
            f[f.length - 1]!.focus();
          } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
            e.preventDefault();
            f[0]!.focus();
          }
        }}
      >
        <div className="dialog-head">
          <Icon name={SOURCE_ICON[source.connector]} size={15} />
          <h2 id="source-title" className="dialog-title" tabIndex={-1} ref={headRef}>
            {title}
          </h2>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="dialog-body" data-source-view={source.connector}>
          {source.connector === 'files' ? (
            <FileBlock path={source.id} />
          ) : error ? (
            <p className="form-error" role="alert">
              <Icon name="alert" size={14} /> {error}
            </p>
          ) : !msg ? (
            <p className="muted">Opening…</p>
          ) : (
            <>
              <dl className="draft-head src-head">
                <dt>From</dt>
                <dd>
                  {msg.from.name} <span className="muted">&lt;{msg.from.address}&gt;</span>
                </dd>
                <dt>{msg.connector === 'chat' ? 'Where' : 'To'}</dt>
                <dd>{msg.to.join(', ') || '—'}</dd>
                <dt>When</dt>
                <dd>
                  <time dateTime={msg.at}>{when(msg.at)}</time>
                </dd>
                {msg.subject !== null ? (
                  <>
                    <dt>Subject</dt>
                    <dd>{msg.subject || '(no subject)'}</dd>
                  </>
                ) : null}
              </dl>
              <div className="src-body" tabIndex={0} data-source-body>
                {msg.body}
                {msg.truncated ? '\n…' : ''}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

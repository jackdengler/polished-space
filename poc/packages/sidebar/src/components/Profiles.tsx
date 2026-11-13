import { useEffect, useRef, useState } from 'react';
import type { ProfileDoc, ProfileSummary } from '@poc/contracts';
import { api, ApiError } from '../api';
import { useUi } from '../store';
import { Markdown } from '../markdown';
import { ago } from '../format';
import { Icon } from './Icon';

function PanelHead({ title, onBack, backLabel }: { title: string; onBack: () => void; backLabel: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), [title]);
  return (
    <div className="panel-head">
      <button type="button" className="icon-btn" onClick={onBack} aria-label={backLabel}>
        <Icon name="back" size={18} />
      </button>
      <h2 className="panel-title" tabIndex={-1} ref={ref}>
        {title}
      </h2>
    </div>
  );
}

export function ProfileList() {
  const open = useUi((s) => s.open);
  const now = useUi((s) => s.state?.now ?? new Date().toISOString());
  const [items, setItems] = useState<ProfileSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .profiles()
      .then(setItems)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load the profiles.'));
  }, []);
  return (
    <div className="panel">
      <PanelHead title="Client profiles" onBack={() => open(null)} backLabel="Back to the list" />
      <div className="panel-body">
        <p className="muted small">One living document per client. The assistant keeps them up to date; your team can open and correct the files.</p>
        {error ? (
          <p className="form-error" role="alert">
            <Icon name="alert" size={14} /> {error}
          </p>
        ) : null}
        {!items && !error ? <p className="muted">Loading…</p> : null}
        {items && !items.length ? <p className="muted">No profiles yet.</p> : null}
        {items?.length ? (
          <ul className="profile-list">
            {items.map((p) => (
              <li key={p.clientId}>
                <button type="button" className="profile-row" onClick={() => open({ kind: 'profile', clientId: p.clientId })}>
                  <Icon name="book" size={16} />
                  <span className="grow">
                    <span className="profile-name">{p.clientName}</span>
                    <span className="profile-sub">Updated {ago(p.updatedAt, now)}</span>
                  </span>
                  <Icon name="chevronRight" size={14} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export function ProfileViewer({ clientId }: { clientId: string }) {
  const open = useUi((s) => s.open);
  const now = useUi((s) => s.state?.now ?? new Date().toISOString());
  const [doc, setDoc] = useState<ProfileDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDoc(null);
    api
      .profile(clientId)
      .then(setDoc)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Could not load the profile.'));
  }, [clientId]);
  return (
    <div className="panel">
      <PanelHead title={doc?.clientName ?? 'Client profile'} onBack={() => open({ kind: 'profiles' })} backLabel="Back to client profiles" />
      <div className="panel-body">
        {error ? (
          <p className="form-error" role="alert">
            <Icon name="alert" size={14} /> {error}
          </p>
        ) : null}
        {!doc && !error ? <p className="muted">Loading…</p> : null}
        {doc ? (
          <>
            <p className="profile-file">
              <Icon name="file" size={13} /> <span className="mono">profiles/{doc.slug}.md</span> · updated {ago(doc.updatedAt, now)}
            </p>
            {/* The file's own "# Client" title repeats the panel title, so it is dropped. */}
            <Markdown source={doc.markdown.replace(/^# .*\n?/, '')} />
          </>
        ) : null}
      </div>
    </div>
  );
}

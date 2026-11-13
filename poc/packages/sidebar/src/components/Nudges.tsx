import { useState } from 'react';
import type { Nudge, Suggestion } from '@poc/contracts';
import { useUi } from '../store';
import { ago } from '../format';
import { Icon, type IconName } from './Icon';
import { SourceChip, SuggestionCard } from './SuggestionCard';

const NUDGE_ICON: Record<Nudge['kind'], IconName> = { new_item: 'sparkle', fit_now: 'clock', info: 'alert' };
const VISIBLE = 3;

function NudgeCard({ nudge, suggestions, total }: { nudge: Nudge; suggestions: Suggestion[]; total: number }) {
  const now = useUi((s) => s.state?.now ?? nudge.createdAt);
  const expanded = useUi((s) => s.expandedNudges.includes(nudge.id));
  const toggle = useUi((s) => s.toggleNudge);
  const dismiss = useUi((s) => s.dismissNudge);
  const open = useUi((s) => s.open);
  const sendChat = useUi((s) => s.sendChat);
  const chatBusy = useUi((s) => s.chatBusy);
  const taskExists = useUi((s) => (nudge.taskId ? s.state?.sections.some((sec) => sec.items.some((t) => t.taskId === nudge.taskId)) : false));
  const n = suggestions.length;
  const regionId = `nudge-${nudge.id}-suggestions`;

  let act: { label: string; run: () => void; controls?: string } | null = null;
  if (n > 0) act = { label: expanded ? 'Hide' : n === 1 ? 'Review suggestion' : `Review ${n} suggestions`, run: () => toggle(nudge.id), controls: regionId };
  else if (nudge.taskId && taskExists) act = { label: 'Open task', run: () => open({ kind: 'task', taskId: nudge.taskId! }) };

  return (
    <li className={`nudge nudge-${nudge.kind}`} data-nudge-id={nudge.id}>
      <div className="nudge-row">
        <span className="nudge-icon" aria-hidden="true">
          <Icon name={NUDGE_ICON[nudge.kind]} size={15} />
        </span>
        <div className="grow">
          <p className="nudge-text">{nudge.text}</p>
          <div className="nudge-meta">
            <span>{ago(nudge.createdAt, now)}</span>
            <SourceChip source={nudge.source} />
            {total > 0 && n === 0 ? (
              <span className="nudge-done">
                <Icon name="check" size={12} /> All handled
              </span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="nudge-actions">
        {act ? (
          <button type="button" className="btn btn-sm btn-accent-soft" onClick={act.run} aria-expanded={act.controls ? expanded : undefined} aria-controls={act.controls}>
            {act.label}
            {act.controls ? <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={13} /> : <Icon name="chevronRight" size={13} />}
          </button>
        ) : null}
        <button type="button" className="btn btn-sm btn-ghost" disabled={chatBusy} onClick={() => void sendChat(`Tell me more about this: ${nudge.text}`)}>
          <Icon name="chat" size={13} /> Ask about it
        </button>
        <button type="button" className="icon-btn nudge-dismiss" aria-label="Dismiss nudge" title="Dismiss" onClick={() => dismiss(nudge.id)}>
          <Icon name="x" size={14} />
        </button>
      </div>
      {n > 0 && expanded ? (
        <div className="nudge-suggestions" id={regionId}>
          {suggestions.map((s) => (
            <SuggestionCard key={s.id} suggestion={s} />
          ))}
        </div>
      ) : null}
    </li>
  );
}

export function Nudges({ items }: { items: { nudge: Nudge; suggestions: Suggestion[]; total: number }[] }) {
  const [showAll, setShowAll] = useState(false);
  if (!items.length) return null;
  const shown = showAll ? items : items.slice(0, VISIBLE);
  return (
    <section className="nudges" aria-label="Nudges">
      <ul className="nudge-list">
        {shown.map((x) => (
          <NudgeCard key={x.nudge.id} {...x} />
        ))}
      </ul>
      {items.length > VISIBLE ? (
        <button type="button" className="link small more-link" onClick={() => setShowAll((v) => !v)} aria-expanded={showAll}>
          {showAll ? 'Show fewer' : `Show ${items.length - VISIBLE} older`}
        </button>
      ) : null}
    </section>
  );
}

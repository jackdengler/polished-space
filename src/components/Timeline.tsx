import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { dayNumber, formatShort, fromDayNumber, MONTH_SHORT, parseIso, todayIso } from '../model/dates';
import {
  allTasks, boardProgress, isAfterPlannedThrough, isOverdue, isPastMeeting, memberById, sortedMeetings,
} from '../model/derive';
import { formatFlex, formatFlexShort, flexEnd, flexStart, parseFlexDate } from '../model/flexDate';
import { ADHOC, type Client, type Meeting } from '../model/schema';
import { buildScale } from '../model/timelineScale';
import { navigate } from '../router';
import { useStore } from '../store/store';
import { FlexDateField } from './FlexDateInput';
import { Icon } from './Icon';
import { Popover } from './Popover';

const TILE_W = 164;
const STEM = 14; // the tile's stem sits this far in from its left edge
const SCALE = { pxPerDay: 3.2, minGap: TILE_W + 14, padStart: STEM + 16, padEnd: 24 };

export function Timeline({ client, boardId }: { client: Client; boardId: string | null }) {
  const members = useStore((s) => s.ws.teamMembers);
  const scroller = useRef<HTMLDivElement>(null);
  const today = todayIso();
  const todayN = dayNumber(today);

  const meetings = useMemo(() => sortedMeetings(client), [client]);
  const dots = useMemo(() => allTasks(client.adhoc.deliverables).filter((t) => t.dueDate && !t.done), [client]);
  const adhocAll = allTasks(client.adhoc.deliverables);
  const adhocOpen = adhocAll.filter((t) => !t.done).length;
  const adhocOverdue = adhocAll.filter((t) => isOverdue(t, today)).length;

  const scale = useMemo(() => buildScale(
    meetings.map((m) => dayNumber(flexStart(m.date))),
    [
      todayN,
      ...meetings.map((m) => dayNumber(flexEnd(m.date))),
      ...dots.map((t) => dayNumber(t.dueDate!)),
      ...(client.plannedThrough ? [dayNumber(flexEnd(client.plannedThrough))] : []),
    ],
    SCALE,
  ), [meetings, dots, client.plannedThrough, todayN]);

  // Month ticks along the axis.
  const ticks = useMemo(() => {
    const out: { x: number; label: string }[] = [];
    const { year, month } = parseIso(fromDayNumber(scale.startDay));
    let y = year, m = month + 1;
    if (m > 12) { m = 1; y++; }
    let lastX = -Infinity;
    for (;;) {
      const day = dayNumber(`${y}-${String(m).padStart(2, '0')}-01`);
      if (day > scale.endDay) break;
      const x = scale.x(day);
      // Skip a month label that would sit on the "Today" label.
      if (x - lastX > 46 && Math.abs(x - scale.x(todayN)) > 44) {
        out.push({ x, label: m === 1 || out.length === 0 ? `${MONTH_SHORT[m - 1]} ${y}` : MONTH_SHORT[m - 1]! });
        lastX = x;
      }
      if (++m > 12) { m = 1; y++; }
    }
    return out;
  }, [scale, todayN]);

  // Open scrolled so "today" sits near the left third.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, scale.x(todayN) - el.clientWidth * 0.3);
    // Only when switching clients, not on every edit.
  }, [client.id]);

  const plannedX = client.plannedThrough ? scale.x(dayNumber(flexEnd(client.plannedThrough)) + 1) : null;
  const todayX = scale.x(todayN);

  return (
    <section className="timeline" aria-label="Meetings timeline">
      <button className={`tl-adhoc${boardId === ADHOC ? ' selected' : ''}`} onClick={() => navigate({ clientId: client.id, boardId: ADHOC })}>
        <span className="tl-adhoc-title"><Icon name="inbox" size={14} /> Ad-hoc</span>
        <span className="tl-adhoc-count">{adhocOpen} open</span>
        {adhocOverdue > 0 && <span className="tl-adhoc-overdue">{adhocOverdue} overdue</span>}
      </button>

      <div className="tl-scroll" ref={scroller}>
        <div className="tl-canvas" style={{ width: scale.width }}>
          {plannedX !== null && <div className="tl-beyond" style={{ left: plannedX }} title="After planned-through" />}
          <div className="tl-today" style={{ left: todayX }}><span>Today</span></div>

          {meetings.map((m, i) => {
            const x = scale.tileX(i);
            const p = boardProgress(m.deliverables);
            const past = isPastMeeting(m, today);
            const openPast = past && p.done < p.total;
            const beyond = isAfterPlannedThrough(m, client);
            const complete = p.total > 0 && p.done === p.total;
            return (
              <div key={m.id}>
                {m.date.kind === 'range' && (
                  <div className="tl-band" style={{ left: x, width: Math.max(8, scale.x(dayNumber(m.date.end) + 1) - x) }} />
                )}
                <div className={`tl-stem${m.date.kind === 'range' ? ' range' : ''}`} style={{ left: x }} />
                <button
                  className={`tl-tile${m.id === boardId ? ' selected' : ''}${beyond ? ' beyond' : ''}${past ? ' past' : ''}`}
                  style={{ left: x - STEM, width: TILE_W }}
                  title={`${formatFlex(m.date)}${m.title ? ` · ${m.title}` : ''}${openPast ? ' · past meeting with open tasks' : ''}${beyond ? ' · after planned-through' : ''}`}
                  onClick={() => navigate({ clientId: client.id, boardId: m.id })}>
                  <span className="tl-tile-date">
                    {formatFlexShort(m.date, today)}
                    {openPast && <span className="warn-dot" aria-label="Past meeting with open tasks" />}
                    {complete && <Icon name="check" size={12} className="done-mark" />}
                  </span>
                  <span className={`tl-tile-title${m.title ? '' : ' derived'}`}>{meetingLabel(m)}</span>
                  <span className="tl-tile-progress">
                    <span className="bar"><span style={{ width: `${p.total ? (100 * p.done) / p.total : 0}%` }} /></span>
                    <span className="count">{p.done}/{p.total}</span>
                  </span>
                </button>
              </div>
            );
          })}

          <div className="tl-axis" />
          {ticks.map((t) => <div key={t.x} className="tl-tick" style={{ left: t.x }}><span>{t.label}</span></div>)}
          {plannedX !== null && (
            <div className="tl-planned" style={{ left: plannedX }} title={`Planned through ${formatFlex(client.plannedThrough!)}`}>
              <Icon name="flag" size={12} /><span>Planned thru {formatFlexShort(client.plannedThrough!, today)}</span>
            </div>
          )}

          {dots.map((t) => {
            const who = memberById(members, t.assigneeId);
            return (
              <button key={t.id} className={`tl-dot${isOverdue(t, today) ? ' overdue' : ''}`} style={{ left: scale.x(dayNumber(t.dueDate!)) }}
                title={`Ad-hoc: ${t.title} · due ${formatShort(t.dueDate!, today)}${who ? ` · ${who.name}` : ''}`}
                aria-label={`Ad-hoc task ${t.title}, due ${formatShort(t.dueDate!, today)}`}
                onClick={() => navigate({ clientId: client.id, boardId: ADHOC, taskId: t.id })} />
            );
          })}

          {meetings.length === 0 && <div className="tl-empty">No meetings yet — add the first one.</div>}
        </div>
      </div>

      <AddMeetingButton client={client} />
    </section>
  );
}

/** The meeting's title, or else what it covers (its deliverables). */
function meetingLabel(m: Meeting): string {
  return m.title || m.deliverables.map((d) => d.title).join(', ') || 'Meeting';
}

function AddMeetingButton({ client }: { client: Client }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [title, setTitle] = useState('');
  const parsed = parseFlexDate(date);

  const submit = () => {
    if (!parsed) return;
    const id = useStore.getState().addMeeting(client.id, parsed, title);
    setOpen(false); setDate(''); setTitle('');
    navigate({ clientId: client.id, boardId: id });
  };

  return (
    <>
      <button ref={ref} className="tl-add" onClick={() => setOpen(true)} aria-label="Add meeting" title="Add meeting">
        <Icon name="plus" size={16} /><span>Meeting</span>
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={300} align="end">
        <form className="form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="form-title">New meeting</div>
          <label className="field-label">When</label>
          <FlexDateField value={date} onChange={setDate} autoFocus placeholder="When" onEnter={submit} />
          <label className="field-label">Title <span className="muted">(optional)</span></label>
          <input className="text-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Kickoff" aria-label="Meeting title" />
          <div className="form-actions">
            <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!parsed}>Add meeting</button>
          </div>
        </form>
      </Popover>
    </>
  );
}

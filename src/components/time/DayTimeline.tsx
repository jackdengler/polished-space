import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { addDays, formatDue, todayIso } from '../../model/dates';
import type { Client } from '../../model/schema';
import { useStore } from '../../store/store';
import { clientName, findDeliverable } from '../../time/lookup';
import { fallbackColor, logoColor } from '../../time/logoColor';
import { durationMs, formatTimeOfDay, formatTotal, localDay, minutesOf, type TimeEntry } from '../../time/model';
import { useTime } from '../../time/store';
import { useLogoUrl } from '../Avatar';
import { Icon } from '../Icon';
import { useNow } from './TimerPill';

const PX_PER_MIN = 1.4;
const DAY_PX = 1440 * PX_PER_MIN;
const y = (minute: number) => (1440 - minute) * PX_PER_MIN; // latest time at the top

/** Vertical day view of entries (and the running timer), newest at top, colored by client. */
export function DayTimeline() {
  const entries = useTime((s) => s.entries);
  const timer = useTime((s) => s.timer);
  const clients = useStore((s) => s.ws.clients);
  const [day, setDay] = useState(todayIso());
  const now = useNow(day === todayIso());
  const scroller = useRef<HTMLDivElement>(null);
  const scrollByDay = useRef(new Map<string, number>());

  const items = useMemo(() => {
    const list: (TimeEntry & { running?: boolean })[] = entries.filter((e) => e.dayKey === day);
    if (timer && localDay(timer.startedAtISO) === day) {
      list.push({ id: 'running', clientId: timer.clientId, deliverableId: timer.deliverableId, openAirTaskId: timer.openAirTaskId, note: timer.note, startISO: timer.startedAtISO, endISO: new Date(now).toISOString(), dayKey: day, running: true });
    }
    // Pack overlapping entries into lanes.
    const sorted = [...list].sort((a, b) => Date.parse(a.startISO) - Date.parse(b.startISO));
    const laneEnds: number[] = [];
    return sorted.map((e) => {
      const s = Date.parse(e.startISO), en = Date.parse(e.endISO);
      let lane = laneEnds.findIndex((end) => end <= s);
      if (lane < 0) { lane = laneEnds.length; laneEnds.push(en); } else laneEnds[lane] = en;
      return { e, lane };
    }).map((x, _, all) => ({ ...x, lanes: Math.max(1, ...all.filter((o) => overlaps(o.e, x.e)).map((o) => o.lane + 1)) }));
  }, [entries, timer, day, now]);

  // Keep scroll per day; on today, start with "now" near the top.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const saved = scrollByDay.current.get(day);
    el.scrollTop = saved ?? (day === todayIso() ? Math.max(0, y(minutesOf(new Date().toISOString())) - 40) : y(18 * 60));
  }, [day]);

  return (
    <aside className="day-timeline" aria-label="Day timeline">
      <div className="dt-head">
        <button className="icon-btn" aria-label="Previous day" onClick={() => setDay(addDays(day, -1))}><Icon name="chevronRight" size={14} className="flip" /></button>
        <b>{day === todayIso() ? 'Today' : formatDue(day)}</b>
        <button className="icon-btn" aria-label="Next day" onClick={() => setDay(addDays(day, 1))}><Icon name="chevronRight" size={14} /></button>
        <span className="muted small dt-total">{formatTotal(items.reduce((n, x) => n + durationMs(x.e), 0))}</span>
      </div>
      <div className="dt-scroll" ref={scroller} onScroll={(e) => scrollByDay.current.set(day, e.currentTarget.scrollTop)}>
        <div className="dt-canvas" style={{ height: DAY_PX }}>
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="dt-hour" style={{ top: y(h * 60) - 60 * PX_PER_MIN }}><span>{h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`}</span></div>
          ))}
          {day === todayIso() && <div className="dt-now" style={{ top: y(minutesOf(new Date(now).toISOString())) }} />}
          {items.map(({ e, lane, lanes }) => (
            <Block key={e.id} e={e} lane={lane} lanes={lanes} client={clients.find((c) => c.id === e.clientId)}
              label={findDeliverable(clients, e.deliverableId)?.deliverable.title ?? clientName(clients, e.clientId)} />
          ))}
        </div>
      </div>
    </aside>
  );
}

const overlaps = (a: TimeEntry, b: TimeEntry) => Date.parse(a.startISO) < Date.parse(b.endISO) && Date.parse(b.startISO) < Date.parse(a.endISO);

function Block({ e, lane, lanes, client, label }: { e: TimeEntry & { running?: boolean }; lane: number; lanes: number; client?: Client; label: string }) {
  const url = useLogoUrl(client?.logo ?? null);
  const [color, setColor] = useState(() => fallbackColor(client?.name ?? 'No client'));
  useEffect(() => { if (client) void logoColor(client.id + (client.logo ?? ''), url, client.name).then(setColor); }, [client, url]);
  const startMin = minutesOf(e.startISO);
  const mins = Math.max(1, durationMs(e) / 60000);
  const endMin = Math.min(1440, startMin + mins);
  const top = y(endMin), height = Math.max(14, (endMin - startMin) * PX_PER_MIN);
  return (
    <div className={`dt-block${e.running ? ' running' : ''}`} title={`${label} · ${formatTimeOfDay(e.startISO)} – ${e.running ? 'now' : formatTimeOfDay(e.endISO)} · ${formatTotal(durationMs(e))}${e.note ? `\n${e.note}` : ''}`}
      style={{ top, height, left: `calc(48px + (100% - 52px) * ${lane / lanes})`, width: `calc((100% - 52px) / ${lanes} - 3px)`, background: color.bg, color: color.fg }}>
      <span className="dt-label">{label}</span>
      {height > 28 && <span className="dt-time">{formatTimeOfDay(e.startISO)} · {formatTotal(durationMs(e))}</span>}
    </div>
  );
}

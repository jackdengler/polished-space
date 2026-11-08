import { useRef, useState } from 'react';
import { addDays, dayNumber, mondayOf, todayIso } from '../model/dates';
import type { Client } from '../model/schema';
import { clientDueStatus, clientSchedule, compareBySchedule } from '../model/derive';
import { formatFlexShort } from '../model/flexDate';
import { setPrefs, usePrefs, type Theme } from '../prefs';
import { navigate, type Route } from '../router';
import { useStore } from '../store/store';
import { closeWorkspace, usePersistence } from '../storage/persistence';
import { openTeamSettings } from '../ui';
import { ClientLogo } from './Avatar';
import { Icon } from './Icon';
import { BrandMark } from './BrandMark';
import { ImportClients, type ImportHandle } from './ImportClients';
import { AddInput } from './InlineEdit';
import { Popover } from './Popover';
import { useMe } from './WhoAmI';
import { OpenAirSettings } from './time/OpenAirSettings';
import { useTime } from '../time/store';

export function Sidebar({ route, onNavigate }: { route: Route; onNavigate?: () => void }) {
  const clients = useStore((s) => s.ws.clients);
  const [adding, setAdding] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const me = useMe();
  const myOpen = me ? countMyOpen(clients, me.id) : 0;
  const sort = usePrefs((s) => s.sidebarSort);
  const today = todayIso();
  const byName = (a: Client, b: Client) => a.name.localeCompare(b.name);
  const active = clients.filter((c) => !c.archived).sort(sort === 'meeting' ? (a, b) => compareBySchedule(a, b, today) : byName);
  const archived = clients.filter((c) => c.archived).sort(byName);
  const go = (r: Partial<Route>) => { navigate(r); onNavigate?.(); };

  const item = (c: Client) => (
    <div key={c.id} className={`nav-item${route.clientId === c.id ? ' active' : ''}`}>
      <a href={`#/c/${c.id}`} className="nav-link" onClick={(e) => { e.preventDefault(); go({ clientId: c.id }); }}>
        <span className="logo-tile"><ClientLogo client={c} size={18} /></span>
        <span className="nav-name">{c.name}</span>
        {!c.archived && <ScheduleLabel client={c} today={today} />}
        <DueDot client={c} today={today} />
      </a>
    </div>
  );

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="brand">
          <BrandMark />
          <span className="brand-name">Planr</span>
        </div>
        <WorkspaceMenu />
      </div>

      <nav className="client-list" aria-label="Navigation">
        <a href="#/week" className={`nav-item nav-link-row${route.weekPage ? ' active' : ''}`}
          onClick={(e) => { e.preventDefault(); go({ weekPage: true }); }}>
          <span className="logo-tile icon-tile"><Icon name="week" size={14} /></span>
          <span className="nav-name">This week</span>
          {myOpen > 0 && <span className="badge" title="Your open tasks due this week or overdue">{myOpen}</span>}
        </a>
        <a href="#/month" className={`nav-item nav-link-row${route.monthPage ? ' active' : ''}`}
          onClick={(e) => { e.preventDefault(); go({ monthPage: true }); }}>
          <span className="logo-tile icon-tile"><Icon name="calendar" size={14} /></span>
          <span className="nav-name">Month</span>
        </a>
        <a href="#/time" className={`nav-item nav-link-row${route.timePage ? ' active' : ''}`}
          onClick={(e) => { e.preventDefault(); go({ timePage: true }); }}>
          <span className="logo-tile icon-tile"><Icon name="clock" size={14} /></span>
          <span className="nav-name">Time</span>
          <RunningDot />
        </a>
        <a href="#/staffing" className={`nav-item nav-link-row${route.staffingPage ? ' active' : ''}`}
          onClick={(e) => { e.preventDefault(); go({ staffingPage: true }); }}>
          <span className="logo-tile icon-tile"><Icon name="users" size={14} /></span>
          <span className="nav-name">Staffing</span>
        </a>

        <div className="section-label">
          <span>Clients</span>
          <span className="section-actions">
            <button className="sort-btn" onClick={() => setPrefs({ sidebarSort: sort === 'name' ? 'meeting' : 'name' })}
              title="Change how clients are sorted" aria-label={`Sorted ${sort === 'name' ? 'A to Z' : 'by next meeting'}. Change`}>
              <Icon name="sort" size={12} />{sort === 'name' ? 'A–Z' : 'Next meeting'}
            </button>
            <button className="icon-btn tiny" aria-label="New client" title="New client" onClick={() => setAdding(true)}><Icon name="plus" size={14} /></button>
          </span>
        </div>
        {adding && (
          <AddInput className="sidebar-add" placeholder="Client name, then Enter"
            onAdd={(name) => { const id = useStore.getState().addClient(name); setAdding(false); go({ clientId: id }); }}
            onDone={() => setAdding(false)} />
        )}
        {active.map(item)}
        {active.length === 0 && !adding && (
          <div className="sidebar-empty"><button className="link" onClick={() => setAdding(true)}>Add your first client</button></div>
        )}
        {archived.length > 0 && (
          <>
            <button className="section-label archived-toggle" onClick={() => setShowArchived((s) => !s)} aria-expanded={showArchived}>
              <span><Icon name={showArchived ? 'chevronDown' : 'chevronRight'} size={12} /> Archived ({archived.length})</span>
            </button>
            {showArchived && <div className="archived">{archived.map(item)}</div>}
          </>
        )}
      </nav>
    </aside>
  );
}

/** Where the data lives + workspace actions (team, import, theme, switch). */
function WorkspaceMenu() {
  const adapter = usePersistence((s) => s.adapter);
  const theme = usePrefs((s) => s.theme);
  const ref = useRef<HTMLButtonElement>(null);
  const importRef = useRef<ImportHandle>(null);
  const [open, setOpen] = useState(false);
  const [oaOpen, setOaOpen] = useState(false);
  const run = (fn: () => void) => { setOpen(false); fn(); };
  return (
    <>
      <button ref={ref} className="workspace-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <Icon name={adapter?.kind === 'folder' ? 'folder' : 'browser'} size={15} />
        <span className="ws-name">{adapter?.name}</span>
        <Icon name="updown" size={14} />
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={232}>
        <div role="menu" className="menu">
          <button role="menuitem" className="menu-item" onClick={() => run(openTeamSettings)}><Icon name="users" size={14} /> Team</button>
          <button role="menuitem" className="menu-item" onClick={() => run(() => importRef.current?.open())}><Icon name="inbox" size={14} /> Import clients…</button>
          <button role="menuitem" className="menu-item" onClick={() => run(() => setOaOpen(true))}><Icon name="clock" size={14} /> OpenAir tasks…</button>
          <div className="menu-sep" />
          <div className="menu-label">Theme</div>
          <div className="seg" role="radiogroup" aria-label="Theme">
            {(['system', 'light', 'dark'] as Theme[]).map((t) => (
              <button key={t} role="radio" aria-checked={theme === t} className={`seg-btn${theme === t ? ' on' : ''}`} onClick={() => setPrefs({ theme: t })}>
                {t[0]!.toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <div className="menu-sep" />
          <button role="menuitem" className="menu-item" onClick={() => run(() => void closeWorkspace())}>
            <Icon name="folder" size={14} /> {adapter?.kind === 'memory' ? 'Back to start' : 'Switch folder'}
          </button>
        </div>
      </Popover>
      <ImportClients ref={importRef} />
      {oaOpen && <OpenAirSettings onClose={() => setOaOpen(false)} />}
    </>
  );
}

/** My open tasks (and kickoffs at my clients) due by the end of this week, including overdue. */
function countMyOpen(clients: Client[], meId: string): number {
  const end = dayNumber(addDays(mondayOf(todayIso()), 6));
  let n = 0;
  for (const c of clients) {
    if (c.archived) continue;
    for (const b of [c.adhoc, ...c.meetings]) for (const d of b.deliverables) for (const t of d.tasks)
      if (!t.done && t.assigneeIds.includes(meId) && t.dueDate && dayNumber(t.dueDate) <= end) n++;
    if (c.teamMemberIds.includes(meId)) for (const m of c.meetings) if (m.kickoff && !m.kickoff.done && dayNumber(m.kickoff.date) <= end) n++;
  }
  return n;
}

/** Red: overdue tasks. Yellow: tasks due this week. Green: tasks due next week. */
function DueDot({ client, today }: { client: Client; today: string }) {
  if (client.archived) return null;
  const due = clientDueStatus(client, today);
  if (!due) return null;
  const { overdue, thisWeek, nextWeek } = due.counts;
  const parts = [overdue && `${overdue} overdue`, thisWeek && `${thisWeek} due this week`, nextWeek && `${nextWeek} due next week`].filter(Boolean).join(' · ');
  return <span className={`nav-dot ${due.status}`} title={parts} aria-label={parts} />;
}

/** Next meeting date, or "Not scheduled" / "Ad-hoc only". */
function ScheduleLabel({ client, today }: { client: Client; today: string }) {
  const s = clientSchedule(client, today);
  if (s.kind === 'next') return <span className="nav-when" title="Next meeting">{formatFlexShort(s.meeting.date, today)}</span>;
  return <span className="nav-when muted" title={s.kind === 'notScheduled' ? 'No upcoming meetings' : 'No meetings, ad-hoc work only'}>{s.kind === 'notScheduled' ? 'Not scheduled' : 'Ad-hoc only'}</span>;
}

/** A pulsing dot on "Time" while a timer runs. */
function RunningDot() {
  const running = useTime((s) => !!s.timer);
  return running ? <span className="running-dot" title="A timer is running" aria-label="Timer running" /> : null;
}

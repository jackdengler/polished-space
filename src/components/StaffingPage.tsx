import { useMemo, useState } from 'react';
import { dayNumber, todayIso } from '../model/dates';
import { byRoleThenName, clientSchedule, compareBySchedule, isDeliverableComplete, meetingLabel, plannedStatus } from '../model/derive';
import { flexEnd, formatFlex, formatFlexShort } from '../model/flexDate';
import { ROLES, type Client, type Role, type TeamMember } from '../model/schema';
import { usePrefs } from '../prefs';
import { navigate } from '../router';
import { useStore } from '../store/store';
import { Avatar, ClientLogo } from './Avatar';
import { Icon } from './Icon';

type SortKey = 'client' | 'next' | 'planned';

/** One row per active client: who's staffed at each level, ad-hoc work, next meeting, planned through. */
export function StaffingPage() {
  const clients = useStore((s) => s.ws.clients);
  const members = useStore((s) => s.ws.teamMembers);
  const meId = usePrefs((s) => s.meId);
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'planned', asc: true });
  const today = todayIso();

  const rows = useMemo(() => {
    const byId = new Map(members.map((m) => [m.id, m]));
    return clients.filter((c) => !c.archived).map((c) => {
      const team = c.teamMemberIds.map((id) => byId.get(id)).filter((m): m is TeamMember => !!m).sort(byRoleThenName);
      const byRole = new Map<Role, TeamMember[]>(ROLES.map((r) => [r, team.filter((m) => m.role === r)]));
      const activeAdhoc = c.adhoc.deliverables.filter((d) => d.tasks.length > 0 && !isDeliverableComplete(d));
      return { c, byRole, activeAdhoc, schedule: clientSchedule(c, today) };
    });
  }, [clients, members, today]);

  const showUnassigned = rows.some((r) => r.byRole.get('Unassigned')!.length > 0);
  const roles = ROLES.filter((r) => r !== 'Unassigned' || showUnassigned);

  const sorted = useMemo(() => {
    const plannedDay = (c: Client) => (c.plannedThrough ? dayNumber(flexEnd(c.plannedThrough)) : null);
    const cmp = (a: Client, b: Client): number => {
      if (sort.key === 'client') return a.name.localeCompare(b.name);
      if (sort.key === 'next') return compareBySchedule(a, b, today);
      const pa = plannedDay(a), pb = plannedDay(b);
      if (pa === null || pb === null) return pa === pb ? a.name.localeCompare(b.name) : pa === null ? 1 : -1; // no date always last
      return pa - pb || a.name.localeCompare(b.name);
    };
    const out = [...rows].sort((x, y) => cmp(x.c, y.c));
    if (!sort.asc) {
      // Flip, but keep clients without a date at the bottom.
      const withDate = out.filter((r) => sort.key !== 'planned' || r.c.plannedThrough);
      return [...withDate.reverse(), ...out.filter((r) => sort.key === 'planned' && !r.c.plannedThrough)];
    }
    return out;
  }, [rows, sort, today]);

  const header = (key: SortKey, label: string) => (
    <th className="sortable" aria-sort={sort.key === key ? (sort.asc ? 'ascending' : 'descending') : 'none'}>
      <button onClick={() => setSort((s) => ({ key, asc: s.key === key ? !s.asc : true }))}>
        {label}{sort.key === key && <Icon name="chevronDown" size={12} className={sort.asc ? '' : 'flip-y'} />}
      </button>
    </th>
  );

  return (
    <div className="staffing-page">
      <header className="week-head"><h1 className="week-title">Staffing</h1><span className="muted small">{rows.length} active clients · roles come from the People list</span></header>
      <div className="staffing-scroll">
        <table className="staffing-table">
          <thead>
            <tr>
              {header('client', 'Client')}
              {roles.map((r) => <th key={r}>{r}</th>)}
              <th>Active ad-hoc</th>
              {header('next', 'Next meeting')}
              {header('planned', 'Planned through')}
            </tr>
          </thead>
          <tbody>
            {sorted.map(({ c, byRole, activeAdhoc, schedule }) => {
              const plan = plannedStatus(c, today);
              return (
                <tr key={c.id} onClick={() => navigate({ clientId: c.id })} tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate({ clientId: c.id }); }}>
                  <td><span className="st-client"><span className="logo-tile"><ClientLogo client={c} size={18} /></span>{c.name}</span></td>
                  {roles.map((r) => (
                    <td key={r}>
                      <span className="st-people">
                        {byRole.get(r)!.map((m) => (
                          <span key={m.id} className={`st-person${m.id === meId ? ' me' : ''}`} title={m.id === meId ? `${m.name} (you)` : m.name}>
                            <Avatar member={m} size={18} />{m.name.split(' ')[0]}
                          </span>
                        ))}
                      </span>
                    </td>
                  ))}
                  <td title={activeAdhoc.length ? activeAdhoc.map((d) => d.title).join('\n') : 'No open ad-hoc work'}>
                    {activeAdhoc.length ? <span className="st-yes"><Icon name="check" size={13} /> {activeAdhoc.length}</span> : <span className="st-no">—</span>}
                  </td>
                  <td>
                    {schedule.kind === 'next'
                      ? <span className="st-next" title={`${formatFlex(schedule.meeting.date)} · ${meetingLabel(schedule.meeting, today)}`}><b>{formatFlexShort(schedule.meeting.date, today)}</b> <span className="muted">{meetingLabel(schedule.meeting, today)}</span></span>
                      : <span className="nav-when muted">{schedule.kind === 'notScheduled' ? 'Not scheduled' : 'Ad-hoc only'}</span>}
                  </td>
                  <td>
                    {c.plannedThrough ? <span title={formatFlex(c.plannedThrough)}>{formatFlexShort(c.plannedThrough, today)}</span> : <span className="muted">—</span>}
                    {plan && <span className={`plan-flag ${plan.kind}`}>{plan.kind === 'passed' ? 'Passed' : `${plan.days}d`}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

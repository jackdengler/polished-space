import { useState } from 'react';
import { addDays, MONTH_SHORT, parseIso, todayIso, weekdayShort } from '../../model/dates';
import { useStore } from '../../store/store';
import { clientName, openAirName } from '../../time/lookup';
import { timesheet, weekStartSat, type Rounding } from '../../time/model';
import { useTime } from '../../time/store';
import { Icon } from '../Icon';
import { Modal } from '../Modal';

const ROUNDINGS: Rounding[] = ['none', '0.1', '0.25'];
const fmt = (h: number) => (h ? h.toFixed(2).replace(/\.?0+$/, '') : '');

/** Sat–Fri grid of hours by client × OpenAir task, rounded per cell (as you'd enter it in OpenAir). */
export function TimesheetModal({ onClose }: { onClose: () => void }) {
  const entries = useTime((s) => s.entries);
  const clients = useStore((s) => s.ws.clients);
  const oa = useStore((s) => s.ws.settings.openAirTasks);
  const [start, setStart] = useState(() => weekStartSat(todayIso()));
  const [rounding, setRounding] = useState<Rounding>('none');
  const sheet = timesheet(entries, start, rounding);
  const end = addDays(start, 6);
  const label = (d: string) => { const p = parseIso(d); return `${MONTH_SHORT[p.month - 1]} ${p.day}`; };
  return (
    <Modal title="Weekly timesheet" onClose={onClose} width={960}>
      <div className="ts-head">
        <button className="icon-btn" aria-label="Previous week" onClick={() => setStart(addDays(start, -7))}><Icon name="chevronRight" size={15} className="flip" /></button>
        <b>{label(start)} – {label(end)}, {parseIso(end).year}</b>
        <button className="icon-btn" aria-label="Next week" onClick={() => setStart(addDays(start, 7))}><Icon name="chevronRight" size={15} /></button>
        <button className="btn btn-sm ts-round" onClick={() => setRounding(ROUNDINGS[(ROUNDINGS.indexOf(rounding) + 1) % ROUNDINGS.length]!)}
          title="Round each day's hours before adding them up">
          Rounding: {rounding === 'none' ? 'None' : `${rounding}h`}
        </button>
      </div>
      <div className="ts-scroll">
        <table className="ts-table">
          <thead>
            <tr><th>Client</th><th>OpenAir task</th>{sheet.days.map((d) => <th key={d} className="num">{weekdayShort(d)}<br /><span className="muted">{label(d)}</span></th>)}<th className="num">Total</th></tr>
          </thead>
          <tbody>
            {sheet.rows.map((r) => (
              <tr key={r.key}>
                <td>{clientName(clients, r.clientId)}</td>
                <td className="muted">{openAirName(oa, r.openAirTaskId) || '—'}</td>
                {r.hours.map((h, i) => <td key={i} className="num" title={r.notes[i]!.join('\n') || undefined}>{fmt(h)}{r.notes[i]!.length > 0 && <span className="ts-note-dot" />}</td>)}
                <td className="num"><b>{fmt(r.total)}</b></td>
              </tr>
            ))}
            {sheet.rows.length === 0 && <tr><td colSpan={10} className="muted">No time this week.</td></tr>}
          </tbody>
          <tfoot>
            <tr><td colSpan={2}><b>Total</b></td>{sheet.dayTotals.map((h, i) => <td key={i} className="num"><b>{fmt(h)}</b></td>)}<td className="num"><b>{fmt(sheet.total)}</b></td></tr>
          </tfoot>
        </table>
      </div>
      <p className="muted small">Weeks run Saturday to Friday, like OpenAir. Hover a cell to see its notes.</p>
    </Modal>
  );
}

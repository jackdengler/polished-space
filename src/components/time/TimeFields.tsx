import { useStore } from '../../store/store';
import { OPENAIR_GROUPS } from '../../model/schema';
import { deliverableOptions } from '../../time/lookup';

/** Client / Deliverable / OpenAir selects shared by the edit dialog and "Add time". */
export function TargetSelects({ clientId, deliverableId, openAirTaskId, onChange }: {
  clientId: string | null; deliverableId: string | null; openAirTaskId: string | null;
  onChange: (patch: { clientId?: string | null; deliverableId?: string | null; openAirTaskId?: string | null }) => void;
}) {
  const clients = useStore((s) => s.ws.clients);
  const oa = useStore((s) => s.ws.settings.openAirTasks);
  const client = clients.find((c) => c.id === clientId);
  const delivs = client ? deliverableOptions(client) : [];
  return (
    <>
      <label className="field-label" htmlFor="te-client">Client</label>
      <select id="te-client" className="text-input" value={clientId ?? ''} onChange={(e) => onChange({ clientId: e.target.value || null, deliverableId: null })}>
        <option value="">No client</option>
        {[...clients].filter((c) => !c.archived || c.id === clientId).sort((a, b) => a.name.localeCompare(b.name)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <label className="field-label" htmlFor="te-deliv">Deliverable</label>
      <select id="te-deliv" className="text-input" value={deliverableId ?? ''} disabled={!client} onChange={(e) => onChange({ deliverableId: e.target.value || null })}>
        <option value="">None</option>
        {delivs.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        {deliverableId && !delivs.some((d) => d.id === deliverableId) && <option value={deliverableId}>(current deliverable)</option>}
      </select>
      <label className="field-label" htmlFor="te-oa">OpenAir task</label>
      <OpenAirSelect id="te-oa" value={openAirTaskId} onChange={(id) => onChange({ openAirTaskId: id })} />
      {oa.length === 0 && <span className="muted small">No OpenAir tasks yet. Add them under Settings → OpenAir tasks.</span>}
    </>
  );
}

export function OpenAirSelect({ id, value, onChange, className = 'text-input' }: { id: string; value: string | null; onChange: (id: string | null) => void; className?: string }) {
  const oa = useStore((s) => s.ws.settings.openAirTasks);
  return (
    <select id={id} className={className} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} aria-label="OpenAir task">
      <option value="">{oa.length ? 'OpenAir task…' : 'No OpenAir tasks'}</option>
      {OPENAIR_GROUPS.map((g) => {
        const list = oa.filter((t) => t.group === g);
        return list.length ? <optgroup key={g} label={g}>{list.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup> : null;
      })}
    </select>
  );
}

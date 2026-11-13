import { useState } from 'react';
import { OPENAIR_GROUPS, type OpenAirTask } from '../../model/schema';
import { useStore } from '../../store/store';
import { Icon } from '../Icon';
import { InlineEdit } from '../InlineEdit';
import { Modal } from '../Modal';

const newId = () => `oa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

/** Edit the shared OpenAir task list (Client / Internal / Firm); paste many at once. */
export function OpenAirSettings({ onClose }: { onClose: () => void }) {
  const tasks = useStore((s) => s.ws.settings.openAirTasks);
  const set = (next: OpenAirTask[]) => useStore.getState().setOpenAirTasks(next);
  const [group, setGroup] = useState<OpenAirTask['group']>('Client');
  const [paste, setPaste] = useState('');
  const list = tasks.filter((t) => t.group === group);
  const addLines = () => {
    const names = paste.split('\n').map((l) => l.trim()).filter(Boolean).filter((n) => !list.some((t) => t.name.toLowerCase() === n.toLowerCase()));
    if (names.length) set([...tasks, ...names.map((name) => ({ id: newId(), name, group }))]);
    setPaste('');
  };
  return (
    <Modal title="OpenAir tasks" onClose={onClose} width={480}>
      <p className="modal-text">The tasks you pick when tracking time. Shared with everyone in this workspace.</p>
      <div className="seg" role="tablist">
        {OPENAIR_GROUPS.map((g) => (
          <button key={g} role="tab" aria-selected={g === group} className={`seg-btn${g === group ? ' on' : ''}`} onClick={() => setGroup(g)}>
            {g} ({tasks.filter((t) => t.group === g).length})
          </button>
        ))}
      </div>
      <div className="team-list oa-list">
        {list.map((t) => (
          <div key={t.id} className="team-row">
            <InlineEdit className="grow" value={t.name} label="OpenAir task" onCommit={(name) => set(tasks.map((x) => (x.id === t.id ? { ...x, name } : x)))} />
            <button className="icon-btn" aria-label={`Remove ${t.name}`} onClick={() => set(tasks.filter((x) => x.id !== t.id))}><Icon name="trash" size={14} /></button>
          </div>
        ))}
        {list.length === 0 && <div className="muted small pad">No {group} tasks yet.</div>}
      </div>
      <label className="field-label" htmlFor="oa-paste">Add {group} tasks (one per line, or paste a list)</label>
      <textarea id="oa-paste" className="text-input oa-paste" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Analysis\nMeetings'} />
      <div className="modal-actions">
        <button className="btn" disabled={!paste.trim()} onClick={addLines}>Add</button>
        <button className="btn btn-primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

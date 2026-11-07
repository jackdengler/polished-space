import { setPrefs, usePrefs } from '../prefs';
import { useStore } from '../store/store';
import { openTeamSettings, useUi } from '../ui';
import { PeopleList } from './MemberPicker';
import { Modal } from './Modal';

/** The current team member on this device ("me"), or null if not chosen / no longer on the team. */
export function useMe() {
  const meId = usePrefs((s) => s.meId);
  return useStore((s) => s.ws.teamMembers.find((m) => m.id === meId) ?? null);
}

export function WhoAmIModal() {
  const open = useUi((s) => s.whoOpen);
  const members = useStore((s) => s.ws.teamMembers);
  if (!open) return null;
  const close = () => useUi.setState({ whoOpen: false });
  return (
    <Modal title="Which team member are you?" onClose={close} width={380}>
      <p className="modal-text">Used for “My work” on the calendar and for your key tasks. Remembered on this device only.</p>
      {members.length
        ? <PeopleList members={members} onPick={(m) => { setPrefs({ meId: m.id }); close(); }} placeholder="Find yourself…" />
        : <button className="btn" onClick={() => { close(); openTeamSettings(); }}>Add team members first</button>}
    </Modal>
  );
}

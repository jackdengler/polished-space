import { create } from 'zustand';

/** UI-only state (not saved). */
export const useUi = create<{ teamOpen: boolean; whoOpen: boolean }>(() => ({ teamOpen: false, whoOpen: false }));
export const openTeamSettings = () => useUi.setState({ teamOpen: true });
/** Ask "which team member are you?" (needed for My work and key tasks). */
export const askWhoAmI = () => useUi.setState({ whoOpen: true });

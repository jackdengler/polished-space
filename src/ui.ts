import { create } from 'zustand';

/** UI-only state (not saved). */
export const useUi = create<{ teamOpen: boolean }>(() => ({ teamOpen: false }));
export const openTeamSettings = () => useUi.setState({ teamOpen: true });

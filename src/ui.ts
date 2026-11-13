import { create } from 'zustand';

/** UI-only state (not saved). */
export const useUi = create<{ teamOpen: boolean; whoOpen: boolean; toast: string | null }>(() => ({ teamOpen: false, whoOpen: false, toast: null }));
let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** A short confirmation at the bottom of the screen ("Copied 4 tasks"). */
export function showToast(text: string) {
  clearTimeout(toastTimer);
  useUi.setState({ toast: text });
  toastTimer = setTimeout(() => useUi.setState({ toast: null }), 2200);
}
export const openTeamSettings = () => useUi.setState({ teamOpen: true });
/** Ask "which team member are you?" (needed for My work and key tasks). */
export const askWhoAmI = () => useUi.setState({ whoOpen: true });

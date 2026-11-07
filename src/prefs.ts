import { create } from 'zustand';

/**
 * Per-device preferences, kept in localStorage (not in the shared workspace),
 * so each person sharing a workspace later can be "me" on their own machine.
 */
export type Theme = 'system' | 'light' | 'dark';
export type SidebarSort = 'name' | 'meeting';
interface Prefs {
  meId: string | null; showWeekend: boolean; hideDone: boolean; theme: Theme;
  sidebarSort: SidebarSort; hideDoneTasks: boolean; lastBackupAt: string | null;
}

const KEY = 'compensian-pm-prefs';

function load(): Prefs {
  const base: Prefs = { meId: null, showWeekend: false, hideDone: false, theme: 'system', sidebarSort: 'name', hideDoneTasks: false, lastBackupAt: null };
  try { return { ...base, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return base; }
}

export const usePrefs = create<Prefs>(load);

usePrefs.subscribe((p) => {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* per-device convenience only */ }
});

export const setPrefs = (p: Partial<Prefs>) => usePrefs.setState(p);

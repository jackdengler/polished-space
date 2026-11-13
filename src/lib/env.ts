/** True when the app runs inside another page (e.g. a hosted preview), where folders and downloads are blocked. */
export const embedded = (() => { try { return window.self !== window.top; } catch { return true; } })();

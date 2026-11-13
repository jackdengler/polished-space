// Same drawing style as Planr's own icons (24px grid, 1.9 stroke, round caps).
const PATHS = {
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  back: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  chat: 'M5 5h14a1 1 0 011 1v9a1 1 0 01-1 1H10l-4 3.5V16H5a1 1 0 01-1-1V6a1 1 0 011-1z',
  calendar: 'M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z',
  file: 'M7 3h7l5 5v12a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1zM14 3v5h5M9 13h6M9 17h6',
  pen: 'M12 20h8M4 20h3L17.5 9.5l-3-3L4 17v3z',
  mic: 'M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3zM6 11a6 6 0 0012 0M12 17v3',
  micOff: 'M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3zM6 11a6 6 0 0012 0M12 17v3M4 4l16 16',
  next: 'M5 12h13M13 6l6 6-6 6',
  bolt: 'M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z',
  pause: 'M9 6v12M15 6v12',
  play: 'M8 5.5v13l10.5-6.5z',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 16a4 4 0 100-8 4 4 0 000 8z',
  moon: 'M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z',
  monitor: 'M4 5h16v11H4zM9 20h6M12 16v4',
  send: 'M5 12h14M13 6l6 6-6 6',
  refresh: 'M20 11a8 8 0 00-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0014.5 4.5L20 16M20 20v-4h-4',
  book: 'M5 4h10a3 3 0 013 3v13H8a3 3 0 01-3-3V4zM5 17a3 3 0 013-3h10',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L2.5 17.5A2 2 0 004.2 20.5h15.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16z',
  offline: 'M3 3l18 18M8.5 16.5a5 5 0 017 0M5 12.5a10 10 0 015.5-2.9M19 12.5a10 10 0 00-2.6-1.9M2 8.8a15 15 0 014.7-2.8M22 8.8A15 15 0 0010.6 5.1M12 20h.01',
  plus: 'M12 5v14M5 12h14',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5l3 2',
  arrowIn: 'M12 4v12M7 11l5 5 5-5M5 20h14',
  arrowOut: 'M12 20V8M7 13l5-5 5 5M5 4h14',
  stop: 'M7 7h10v10H7z',
  inbox: 'M4 13l2.5-7h11L20 13M4 13v5h16v-5M4 13h4.5l1 2h5l1-2H20',
} as const;

export type IconName = keyof typeof PATHS;

const FILLED = new Set<IconName>(['play', 'stop', 'bolt']);

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} fill={FILLED.has(name) ? 'currentColor' : 'none'} />
    </svg>
  );
}

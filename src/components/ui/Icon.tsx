import type { SVGProps } from 'react';

/** Stroke icon set (24×24 grid, 1.75 stroke). Drawn for NORO; no external icon font. */
const PATHS = {
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  arrowLeft: 'M19 12H5M11 18l-6-6 6-6',
  arrowUpRight: 'M7 17 17 7M8 7h9v9',
  upload: 'M12 15V4M7 9l5-5 5 5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  download: 'M12 4v11M7 10l5 5 5-5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  play: 'M7 5v14l11-7z',
  refresh: 'M20 11a8 8 0 0 0-14.9-3.9L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.9 3.9l1.1-1.4M20 20v-4.5h-4.5',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  checkCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12.5l2.7 2.7L16 10',
  x: 'M6 6l12 12M18 6 6 18',
  alert: 'M12 4 2.8 19.5h18.4L12 4zM12 10v4.5M12 17.2v.3',
  alertCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5v5.5M12 16.2v.3',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.8v.3',
  file: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5',
  fileText: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5zM14 3v5h5M9 13h6M9 17h6M9 9h2',
  table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
  filter: 'M4 5h16l-6 7.5V19l-4 1.5v-8L4 5z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-2 1.2L14.8 21h-4l-.3-2.4a7 7 0 0 1-2-1.2l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-2.3L4.6 10l2-3.4 1.9.7a7 7 0 0 1 2-1.2l.3-2.1h4l.3 2.1a7 7 0 0 1 2 1.2l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 2.3z',
  sliders: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  chevronLeft: 'M15 6l-6 6 6 6',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  message: 'M4 5h16v11H9l-5 4V5z',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18 14a6.5 6.5 0 0 1 3.5 6',
  chart: 'M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6M20 16V6',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5',
  box: 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM4 7.5l8 4.5 8-4.5M12 12v9',
  zap: 'M13 3 5 13.5h6L10 21l8-10.5h-6L13 3z',
  shield: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z',
  shieldCheck: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3zM9 12l2 2 4-4',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  send: 'M21 3 10 14M21 3l-7 18-4-7-7-4 18-7z',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  layers: 'M12 3 2 8l10 5 10-5-10-5zM2 13l10 5 10-5M2 17.5 12 22l10-4.5',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  database: 'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  merge: 'M6 3v6a6 6 0 0 0 6 6h6M6 21v-6M15 12l3 3-3 3',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  sort: 'M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4',
  menu: 'M4 7h16M4 12h16M4 17h16',
  lock: 'M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
  wand: 'M15 4V2M15 10V8M11 6H9M21 6h-2M18.5 3.5 17 5M13 9l-9 9 2 2 9-9-2-2z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  plug: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v4',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  inbox: 'M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6H3v-6l2-8z',
  tag: 'M3 12V4h8l10 10-8 8L3 12zM7.5 8.5h.01',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  user: 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  bot: 'M5 8h14v11H5zM12 8V4M9 13h.01M15 13h.01M2 13v3M22 13v3',
  book: 'M4 4h6a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H4V4zM20 4h-6a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h7V4z',
  scan: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M7 12h10',
  flow: 'M5 6a2 2 0 1 0 0-.01M19 18a2 2 0 1 0 0-.01M7 6h5a3 3 0 0 1 3 3v6a3 3 0 0 0 3 3',
  pause: 'M8 5v14M16 5v14',
  dot: 'M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  sparkles: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z',
  percent: 'M19 5 5 19M7 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  type: 'M4 7V5h16v2M9 19h6M12 5v14',
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
  title?: string;
}

export function Icon({ name, size = 18, title, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
      {...rest}
    >
      {title ? <title>{title}</title> : null}
      <path d={PATHS[name]} />
    </svg>
  );
}

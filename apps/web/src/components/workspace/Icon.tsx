import type { CSSProperties } from "react";
export function Icon({ name, size = 20, style }: { name: string; size?: number; style?: CSSProperties }) {
  const paths: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    cube: <><path d="m12 3 9 5v9l-9 5-9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v9M7 5.8l9 5"/></>,
    plus: <path d="M12 5v14M5 12h14"/>, search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>, chevron: <path d="m9 5 7 7-7 7"/>, down: <path d="m6 9 6 6 6-6"/>,
    link: <><path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 3 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 1)"/></>,
    activity: <path d="M2 12h5l3-8 4 16 3-8h5"/>, settings: <><path d="m9 3-1 3-3 1-2 3 2 2v3l2 3h3l2 3 3-2 3-1 1-3 2-2-2-3-1-3h-3l-2-3Z"/><circle cx="12" cy="12" r="3"/></>,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/></>,
    check: <path d="m5 12 4 4L19 6"/>, close: <path d="m6 6 12 12M6 18 18 6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    globe: <><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></>,
    layers: <><path d="m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5"/></>,
    help: <><circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 1 1 4 3v2m-1 3h.01"/></>,
    expand: <path d="M4 9V4h5m6 0h5v5m0 6v5h-5M9 20H4v-5"/>,
    reset: <><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/></>,
    download: <path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    folder: <path d="M3 7V5h7l2 3h9v12H3Z"/>, info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/></>,
    copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/></>,
    list: <><path d="M9 5h12M9 12h12M9 19h12M3 5h.01M3 12h.01M3 19h.01"/></>,
    drone: <><path d="m8 8 8 8m-8 0 8-8"/><circle cx="6" cy="6" r="3.5"/><circle cx="18" cy="6" r="3.5"/><circle cx="6" cy="18" r="3.5"/><circle cx="18" cy="18" r="3.5"/><rect x="9" y="9" width="6" height="6" rx="2"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name] || paths.cube}</svg>;
}

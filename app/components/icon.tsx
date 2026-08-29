import type { SVGProps } from "react";

export type IconName =
  | "truck" | "mail" | "lock" | "eye" | "eyeOff" | "user" | "users"
  | "phone" | "store" | "scan" | "camera" | "moon" | "sun" | "menu"
  | "close" | "home" | "layers" | "return" | "hand" | "spreadsheet" | "plus" | "search"
  | "bell" | "trash" | "settings" | "logout" | "switch" | "chevronLeft"
  | "chevronDown" | "package" | "edit" | "check" | "clock" | "alert"
  | "mapPin" | "file" | "download" | "upload" | "filter" | "star"
  | "shield" | "sliders" | "help" | "receipt" | "calendar" | "copy"
  | "wallet" | "refresh" | "clipboard" | "external" | "fingerprint"
  | "monitor" | "info" | "gift" | "sparkles" | "arrowLeft" | "printer"
  | "more" | "bike" | "chart" | "creditCard" | "globe" | "link" | "qrCode"
  | "circle" | "weight" | "box" | "bag" | "key" | "send" | "message";

const paths: Record<IconName, React.ReactNode> = {
  truck: <><path d="M10 17h4V5H2v12h3"/><path d="M14 9h4l4 4v4h-2"/><circle cx="7.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 7 9-7"/></>,
  lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></>,
  eye: <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="3"/></>,
  eyeOff: <><path d="m3 3 18 18M10.5 10.6a2.2 2.2 0 0 0 3 3m3.3 3.2A11 11 0 0 1 12 18c-6.5 0-10-6-10-6a17 17 0 0 1 5.1-5m3.1-.8A12 12 0 0 1 12 6c6.5 0 10 6 10 6a18 18 0 0 1-2.7 3.3"/></>,
  user: <><circle cx="12" cy="8" r="4"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m16 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.74"/><circle cx="10" cy="7" r="4"/></>,
  phone: <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.7 19.7 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.7 19.7 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.5 3a2 2 0 0 1-.6 1.8L7.1 10.4a16 16 0 0 0 6 6l1.9-1.9a2 2 0 0 1 1.8-.6l3 .5a2 2 0 0 1 1.7 2Z"/>,
  store: <><path d="M3 10 5 4h14l2 6m-2 0v10H5V10m-2 0a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M9 20v-6h6v6"/></>,
  scan: <><path d="M4 8V5a1 1 0 0 1 1-1h3m8 0h3a1 1 0 0 1 1 1v3M4 16v3a1 1 0 0 0 1 1h3m8 0h3a1 1 0 0 0 1-1v-3M4 12h16"/></>,
  camera: <><rect x="3" y="6" width="18" height="14" rx="2"/><path d="m8 6 1.5-3h5L16 6"/><circle cx="12" cy="13" r="3"/></>,
  moon: <path d="M20.8 14.2A8.2 8.2 0 0 1 9.8 3.2 9 9 0 1 0 20.8 14.2Z"/>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2m10-10h-2M4 12H2m17.1 7.1-1.4-1.4M6.3 6.3 4.9 4.9m14.2 0-1.4 1.4M6.3 17.7l-1.4 1.4"/></>,
  menu: <path d="M3 6h18M3 12h18M3 18h18"/>,
  close: <path d="m18 6-12 12M6 6l12 12"/>,
  home: <><path d="m3 10 9-7 9 7v10H3z"/><path d="M9 20v-7h6v7"/></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5m-18 5 9 5 9-5"/></>,
  return: <><rect x="4" y="4" width="16" height="16" rx="4"/><path d="m10 9-3 3 3 3"/><path d="M7 12h6a3 3 0 0 1 3 3v1"/></>,
  hand: <><path d="M11 11V5a2 2 0 0 1 4 0v6m0-2a2 2 0 0 1 4 0v5m-8-3a2 2 0 0 0-4 0v3l-1.5-1.5a2 2 0 0 0-2.8 2.8L9 22h8a6 6 0 0 0 6-6v-3a2 2 0 0 0-4 0"/></>,
  spreadsheet: <><path d="M5 3h10l4 4v14H5z"/><path d="M15 3v5h5M8 12h8m-8 4h8m-4-7v10"/></>,
  plus: <path d="M12 5v14m-7-7h14"/>,
  search: <><circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0"/></>,
  trash: <><path d="M3 6h18m-2 0-1 14H6L5 6m4 0V4h6v2m-5 4v6m4-6v6"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .4.7a2 2 0 0 1-2.8 2.8l-.7-.4a8 8 0 0 1-1.3.6l-.2.8a2 2 0 0 1-3.8 0l-.2-.8a8 8 0 0 1-1.3-.6l-.7.4A2 2 0 0 1 6 15.7l.4-.7a8 8 0 0 1-.6-1.3l-.8-.2a2 2 0 0 1 0-3.8l.8-.2a8 8 0 0 1 .6-1.3L6 7.5a2 2 0 0 1 2.8-2.8l.7.4a8 8 0 0 1 1.3-.6l.2-.8a2 2 0 0 1 3.8 0l.2.8a8 8 0 0 1 1.3.6l.7-.4A2 2 0 0 1 19.8 7.5l-.4.7a8 8 0 0 1 .6 1.3l.8.2a2 2 0 0 1 0 3.8l-.8.2a8 8 0 0 1-.6 1.3Z"/></>,
  logout: <><path d="M10 17v3H4V4h6v3m5 10 5-5-5-5m5 5H9"/></>,
  switch: <><path d="m17 2 4 4-4 4M3 6h18m-14 16-4-4 4-4m14 4H3"/></>,
  chevronLeft: <path d="m15 18-6-6 6-6"/>,
  chevronDown: <path d="m6 9 6 6 6-6"/>,
  package: <><path d="m12 3 9 5v8l-9 5-9-5V8l9-5Zm0 18v-9m9-4-9 4-9-4m4.5-2.5 9 5"/></>,
  edit: <><path d="m16 4 4 4L9 19H5v-4L16 4Z"/><path d="m14 6 4 4"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  alert: <><path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v4m0 4h.01"/></>,
  mapPin: <><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
  file: <><path d="M6 3h8l5 5v13H6z"/><path d="M14 3v6h6M9 13h7m-7 4h7"/></>,
  download: <><path d="M12 3v12m-4-4 4 4 4-4"/><path d="M4 16v5h16v-5"/></>,
  upload: <><path d="M12 16V4m-4 4 4-4 4 4"/><path d="M4 16v5h16v-5"/></>,
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"/>,
  star: <path d="m12 3 2.7 5.5 6 .9-4.4 4.2 1 6-5.3-2.8-5.3 2.8 1-6-4.4-4.2 6-.9L12 3Z"/>,
  shield: <><path d="m12 3 8 3v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-3Z"/><path d="m9 12 2 2 4-4"/></>,
  sliders: <><path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></>,
  help: <><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.7-2.5 2-2.5 4m0 4h.01"/></>,
  receipt: <><path d="M5 3h14v18l-3-2-4 2-4-2-3 2z"/><path d="M9 8h6m-6 4h6m-6 4h3"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4m8-4v4M3 10h18"/></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></>,
  wallet: <><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18m-5 5h2"/></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9a8 8 0 0 1 13-3L20 7M4 17l1.5 1a8 8 0 0 0 13-3"/></>,
  clipboard: <><rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3h6v2m-6 8 2 2 4-4"/></>,
  external: <><path d="M13 4h7v7m0-7-9 9"/><path d="M20 14v6H4V4h6"/></>,
  fingerprint: <><path d="M12 3a8 8 0 0 1 8 8m-16 0a8 8 0 0 1 13.6-5.7M7 14a5 5 0 0 1 10 0c0 3-1 6-3 8m-4-2c1-2 2-5 2-8m-7 5c0-2 .3-4 1-5m14 4c-.3 2-1 4-2 5"/></>,
  monitor: <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/></>,
  gift: <><rect x="3" y="9" width="18" height="12" rx="1"/><path d="M12 9v12M3 13h18m-9-4H8a2.5 2.5 0 1 1 2-4c1 1 2 4 2 4Zm0 0h4a2.5 2.5 0 1 0-2-4c-1 1-2 4-2 4Z"/></>,
  sparkles: <><path d="m12 2 2 7 7 2-7 2-2 7-2-7-7-2 7-2 2-7Zm7 13 1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z"/></>,
  arrowLeft: <path d="m12 19-7-7 7-7m-7 7h14"/>,
  printer: <><path d="M7 8V3h10v5m0 9h3v-7H4v7h3"/><rect x="7" y="14" width="10" height="7"/><path d="M17 11h.01"/></>,
  more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  bike: <><circle cx="5" cy="17" r="3"/><circle cx="19" cy="17" r="3"/><path d="m12 17-3-7h7l3 7M9 10H6m6 7h7m-7 0 4-7m-7 0-4 7"/></>,
  chart: <><path d="M3 3v18h18M8 16V9m5 7V5m5 11v-4"/></>,
  creditCard: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18m-14 5h3"/></>,
  globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18m-9-9c-2 2.5-3 5.5-3 9s1 6.5 3 9m0-18c2 2.5 3 5.5 3 9s-1 6.5-3 9"/></>,
  link: <><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2m3 6a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2"/></>,
  qrCode: <><rect x="3" y="3" width="6" height="6" rx="1"/><rect x="15" y="3" width="6" height="6" rx="1"/><rect x="3" y="15" width="6" height="6" rx="1"/><path d="M15 15h2v2h-2zm4 0h2v4h-2zm-4 4h4v2h-4z"/></>,
  circle: <circle cx="12" cy="12" r="8"/>,
  weight: <><path d="m6 8-3 12h18L18 8z"/><circle cx="12" cy="6" r="3"/></>,
  box: <><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M3 11h18M8 7V4h8v3m-5 8h2"/></>,
  bag: <><path d="M5 8h14l1 13H4L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></>,
  key: <><circle cx="8" cy="12" r="5"/><path d="M13 12h9m-4 0v3m3-3v2"/></>,
  send: <><path d="m22 2-7 20-4-9-9-4 20-7Zm0 0L11 13"/></>,
  message: <><path d="M21 11a8 8 0 0 1-8 8H8l-5 3v-6a8 8 0 1 1 18-5Z"/><path d="M8 11h.01M12 11h.01M16 11h.01"/></>,
};

type IconProps = SVGProps<SVGSVGElement> & { name: IconName; size?: number };

export function Icon({ name, size = 20, className, ...props }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true" {...props}>
      {paths[name]}
    </svg>
  );
}

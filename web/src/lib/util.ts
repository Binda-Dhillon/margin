import { customAlphabet } from "nanoid";

const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz";
const id10 = customAlphabet(alphabet, 10);

export const newId = (prefix: string) => `${prefix}${id10()}`;

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_COLORS = ["#8e5bb5", "#2f7fa3", "#c06a3c", "#4f8f6b", "#b0577c", "#6b78c9", "#a3862b", "#3f8f8f"];

export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

const pad = (n: number) => String(n).padStart(2, "0");

export function clock(time: number | string | Date): string {
  const d = new Date(time);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function isoDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseIsoDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "Fri 6 Nov" */
export function shortDate(time: number | string | Date): string {
  const d = typeof time === "string" && /^\d{4}-\d{2}-\d{2}$/.test(time) ? parseIsoDate(time) : new Date(time);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "6 Nov" */
export function dayMonth(time: number | string | Date): string {
  const d = typeof time === "string" && /^\d{4}-\d{2}-\d{2}$/.test(time) ? parseIsoDate(time) : new Date(time);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "Wednesday 4 November" */
export function longDate(time: number | string | Date): string {
  const d = typeof time === "string" && /^\d{4}-\d{2}-\d{2}$/.test(time) ? parseIsoDate(time) : new Date(time);
  return `${DAYS_LONG[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}`;
}

export function daysUntil(date: string, from: Date = new Date()): number {
  const a = parseIsoDate(date).getTime();
  const b = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  return Math.round((a - b) / 86_400_000);
}

/** "just now", "2 min ago", "yesterday", "3 days ago", "6 Nov" */
export function ago(time: number | string | Date, now: number = Date.now()): string {
  const t = new Date(time).getTime();
  if (!t) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  const today = new Date(now);
  const then = new Date(t);
  const dayDiff = Math.round(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() -
      new Date(then.getFullYear(), then.getMonth(), then.getDate()).getTime()) /
      86_400_000,
  );
  if (dayDiff === 0) return `${h} h ago`;
  if (dayDiff === 1) return "yesterday";
  if (dayDiff < 7) return `${dayDiff} days ago`;
  return dayMonth(t);
}

/** "12:41" today, otherwise "Tue 3 Nov, 12:41" */
export function stamp(time: number | string | Date): string {
  const d = new Date(time);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? clock(d) : `${shortDate(d)}, ${clock(d)}`;
}

export function greeting(d: Date = new Date()): string {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function partOfDay(d: Date = new Date()): string {
  const h = d.getHours();
  return h < 12 ? "this morning" : h < 18 ? "this afternoon" : "tonight";
}

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

/** True while typing somewhere that single-key shortcuts should not hijack. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.closest) return false;
  if (el.closest("input, textarea, select, [contenteditable='true'], .excalidraw, [role='dialog'], [role='menu']")) return true;
  return false;
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? "⌘" : "Ctrl";

/** WCAG relative luminance contrast of a colour against white. */
export function contrastOnWhite(hex: string): number {
  const m = hex.replace("#", "");
  const n = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return 1.05 / (L + 0.05);
}

export function inQuietHours(from: string, to: string, d: Date = new Date()): boolean {
  const mins = d.getHours() * 60 + d.getMinutes();
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  const a = fh * 60 + fm;
  const b = th * 60 + tm;
  return a <= b ? mins >= a && mins < b : mins >= a || mins < b;
}

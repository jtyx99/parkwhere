// All times shown and entered in the app are Singapore time (UTC+8, no DST),
// regardless of the browser's own time zone.
export const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;
export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

const pad = (n: number) => String(n).padStart(2, '0');

/** A Date whose UTC fields read as Singapore wall-clock time. */
export const sgtShift = (d: Date | number) => new Date(+d + SGT_OFFSET_MS);

/** "YYYY-MM-DDTHH:mm" in Singapore time, for datetime-local inputs. */
export function toSgtInput(d: Date | number): string {
  return sgtShift(d).toISOString().slice(0, 16);
}

/** "YYYY-MM-DDTHH:mm:ss" in Singapore time, as the data.gov.sg API expects. */
export function toSgtApi(d: Date | number): string {
  return sgtShift(d).toISOString().slice(0, 19);
}

/** Parse a Singapore wall-clock string (no offset) into a Date. */
export function parseSgt(s: string): Date | null {
  if (!s) return null;
  const d = new Date(`${s.length === 16 ? `${s}:00` : s}+08:00`);
  return Number.isNaN(+d) ? null : d;
}

export function sgtDateKey(d: Date | number): string {
  return sgtShift(d).toISOString().slice(0, 10);
}

export function formatClock(d: Date | number): string {
  const s = sgtShift(d);
  const h = s.getUTCHours();
  return `${h % 12 || 12}:${pad(s.getUTCMinutes())} ${h < 12 ? 'am' : 'pm'}`;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDayClock(d: Date | number): string {
  const s = sgtShift(d);
  return `${DAYS[s.getUTCDay()]} ${s.getUTCDate()} ${MONTHS[s.getUTCMonth()]}, ${formatClock(d)}`;
}

export function formatDate(d: Date | number): string {
  const s = sgtShift(d);
  return `${s.getUTCDate()} ${MONTHS[s.getUTCMonth()]} ${s.getUTCFullYear()}`;
}

export const weekdayName = (d: Date | number) =>
  ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
    sgtShift(d).getUTCDay()
  ];

export function formatDuration(minutes: number): string {
  const m = Math.round(minutes);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const r = m % 60;
  return [d && `${d} d`, h && `${h} h`, (r || (!d && !h)) && `${r} min`].filter(Boolean).join(' ');
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m / 5) * 5 || Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/** Rough walking time: straight-line distance padded 30%, at 80 m/min. */
export const walkMinutes = (m: number) => Math.max(1, Math.round((m * 1.3) / 80));

export const formatMoney = (n: number) => `$${n.toFixed(2)}`;

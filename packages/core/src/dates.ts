const pad = (n: number) => String(n).padStart(2, "0");

export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * `@15/9/27`, `@15/9/2027`, `@15/9` (current year), optional ` 10:30`.
 * Day first. Returns ISO `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`, or null.
 */
export function parseDateShorthand(input: string, now = new Date()): string | null {
  const m = input.trim().match(/^@(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = m[3] === undefined ? now.getFullYear() : Number(m[3]);
  if (m[3] !== undefined && m[3].length === 2) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  let iso = `${year}-${pad(month)}-${pad(day)}`;
  if (m[4] !== undefined) {
    const h = Number(m[4]);
    const mi = Number(m[5]);
    if (h > 23 || mi > 59) return null;
    iso += `T${pad(h)}:${pad(mi)}`;
  }
  return iso;
}

/** ISO date back to `15/9/27` (plus ` 10:30` if a time is present). */
export function formatDateShorthand(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
  if (!m) return iso;
  const yy = m[1].slice(2);
  let out = `${Number(m[3])}/${Number(m[2])}/${yy}`;
  if (m[4]) out += ` ${m[4]}:${m[5]}`;
  return out;
}

export function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(s);
}

export function parsePriorityShorthand(input: string): 1 | 2 | 3 | null {
  const m = input.trim().match(/^!([123])$/);
  return m ? (Number(m[1]) as 1 | 2 | 3) : null;
}

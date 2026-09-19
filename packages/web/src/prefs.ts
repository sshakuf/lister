// Display preferences persisted in localStorage and applied as CSS variables on <html>.
export const FONT_MIN = 11;
export const FONT_MAX = 28;
export const FONT_DEFAULT = 15;
const KEY = "lister.fontSize";

export function loadFontSize(): number {
  const v = Number(localStorage.getItem(KEY));
  return Number.isFinite(v) && v >= FONT_MIN && v <= FONT_MAX ? v : FONT_DEFAULT;
}

export function applyFontSize(px: number): number {
  const clamped = Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(px)));
  document.documentElement.style.setProperty("--font-size", `${clamped}px`);
  localStorage.setItem(KEY, String(clamped));
  return clamped;
}

/** Call once at startup. */
export function initPrefs(): void {
  applyFontSize(loadFontSize());
}

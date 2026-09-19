import { useState } from "react";
import { applyFontSize, loadFontSize, FONT_DEFAULT, FONT_MAX, FONT_MIN } from "../prefs";

/** − / + stepper for the base font size; applies immediately and persists on this device. */
export function FontSizeControl() {
  const [size, setSize] = useState(loadFontSize);
  const step = (delta: number) => setSize((s) => applyFontSize(s + delta));
  const set = (px: number) => setSize(applyFontSize(px));
  return (
    <div>
      <div className="font-control" role="group" aria-label="Font size">
        <button onClick={() => step(-1)} disabled={size <= FONT_MIN} aria-label="Smaller text" title="Smaller">
          −
        </button>
        <span className="val">{size}px</span>
        <button onClick={() => step(1)} disabled={size >= FONT_MAX} aria-label="Larger text" title="Larger">
          +
        </button>
        <button className="ghost" onClick={() => set(FONT_DEFAULT)} disabled={size === FONT_DEFAULT}>
          Reset
        </button>
      </div>
      <div className="font-preview">Bullets, pills and menus scale with this. Saved on this device only.</div>
    </div>
  );
}

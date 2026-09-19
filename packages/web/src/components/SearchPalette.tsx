import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { Hit } from "../types";
import { useUi } from "../ui";
import { revealBullet } from "../navigate";

export function SearchPalette() {
  const open = useUi((s) => s.searchOpen);
  const setOpen = useUi((s) => s.setSearchOpen);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setHits([]);
      setSel(0);
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      if (!q.trim()) return setHits([]);
      api.search(q).then((r) => {
        setHits(r.hits);
        setSel(0);
      }).catch(() => setHits([]));
    }, 120);
    return () => clearTimeout(t);
  }, [q, open]);

  const groups = useMemo(() => {
    const m = new Map<string, Hit[]>();
    for (const h of hits) {
      const k = `${h.fileName}|${h.filePath}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(h);
    }
    return [...m.entries()];
  }, [hits]);

  if (!open) return null;

  const go = async (h: Hit) => {
    setOpen(false);
    await revealBullet(h.id).catch(() => undefined);
  };

  return (
    <div className="modal-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="modal palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          className="palette-input"
          placeholder="Search all outlines…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, hits.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            }
            if (e.key === "Enter" && hits[sel]) go(hits[sel]);
          }}
        />
        <div className="palette-results">
          {q.trim() && hits.length === 0 && <div className="empty">No matches</div>}
          {groups.map(([k, list]) => (
            <div key={k} className="group">
              <div className="group-title">{list[0].fileName}</div>
              {list.map((h) => {
                const idx = hits.indexOf(h);
                return (
                  <div key={h.id} className={`hit ${idx === sel ? "selected" : ""} ${h.done !== undefined ? "done" : ""}`} onMouseEnter={() => setSel(idx)} onClick={() => go(h)}>
                    {h.path.length > 0 && <span className="hit-path">{h.path.join(" › ")} › </span>}
                    <span className="hit-text">{h.text || "(untitled)"}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="palette-hint">↑↓ to move · Enter to open · Esc to close</div>
      </div>
    </div>
  );
}

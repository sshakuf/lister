import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";

interface Props {
  title: string;
  initial?: string;
  confirmLabel?: string;
  onPick: (folder: string) => Promise<void>;
  onClose: () => void;
}

/** Modal directory picker with typeahead completion from the server and a recent list. */
export function FolderPicker({ title, initial = "~/", confirmLabel = "Use this folder", onPick, onClose }: Props) {
  const [value, setValue] = useState(initial);
  const [dirs, setDirs] = useState<string[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [sel, setSel] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.recent().then((r) => setRecent(r.recent)).catch(() => undefined);
    setTimeout(() => {
      input.current?.focus();
      input.current?.setSelectionRange(value.length, value.length);
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      api.dirs(value).then((r) => {
        setDirs(r.dirs);
        setSel(-1);
      }).catch(() => setDirs([]));
    }, 120);
    return () => clearTimeout(t);
  }, [value]);

  const confirm = async (folder: string) => {
    setBusy(true);
    setError(null);
    try {
      await onPick(folder.replace(/\/+$/, "") || "/");
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? `${e.status === 409 ? "Conflict: " : ""}${e.message}` : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal picker" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <input
          ref={input}
          className="picker-input"
          value={value}
          spellCheck={false}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, dirs.length - 1));
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, -1));
            }
            if (e.key === "Tab" || e.key === "ArrowRight") {
              const pick = sel >= 0 ? dirs[sel] : dirs.length === 1 ? dirs[0] : null;
              if (pick && e.currentTarget.selectionStart === value.length) {
                e.preventDefault();
                setValue(pick + "/");
              }
            }
            if (e.key === "Enter") {
              e.preventDefault();
              if (sel >= 0) setValue(dirs[sel] + "/");
              else if (!busy) confirm(value);
            }
          }}
        />
        {error && <div className="error-inline">{error}</div>}
        <div className="picker-lists">
          <div className="picker-col">
            <div className="col-title">Matches</div>
            {dirs.length === 0 && <div className="empty">No subdirectories</div>}
            {dirs.map((d, i) => (
              <div key={d} className={`opt ${i === sel ? "selected" : ""}`} onMouseEnter={() => setSel(i)} onClick={() => setValue(d + "/")} onDoubleClick={() => confirm(d)}>
                {d}
              </div>
            ))}
          </div>
          <div className="picker-col">
            <div className="col-title">Recent</div>
            {recent.length === 0 && <div className="empty">None yet</div>}
            {recent.map((d) => (
              <div key={d} className="opt" onClick={() => setValue(d)} onDoubleClick={() => confirm(d)}>
                {d}
              </div>
            ))}
          </div>
        </div>
        <div className="picker-actions">
          <span className="hint">Enter confirms · ↑↓ then Enter descends · Tab completes</span>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy} onClick={() => confirm(value)}>
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

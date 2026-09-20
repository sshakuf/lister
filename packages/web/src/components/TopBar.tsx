import { useHive } from "../hive/client";
import { useStore } from "../store";
import { useUi } from "../ui";

export function TopBar() {
  const hive = useHive();
  const route = useStore((s) => s.route);
  const wsOpen = useStore((s) => s.wsOpen);
  const error = useStore((s) => s.error);
  const setError = useStore((s) => s.setError);
  const undoN = useStore((s) => s.undoStack.length);
  const redoN = useStore((s) => s.redoStack.length);
  const setSearchOpen = useUi((s) => s.setSearchOpen);
  return (
    <>
      <header className="topbar">
        <a className={`brand ${route === "outline" ? "active" : ""}`} href="#/">
          Lister
        </a>
        <nav>
          <a className={route === "outline" ? "active" : ""} href="#/">
            Outline
          </a>
          <a className={route === "admin" ? "active" : ""} href="#/admin">
            Admin
          </a>
        </nav>
        <div className="spacer" />
        <button className="ghost" onClick={() => setSearchOpen(true)} title="Search (⌘K)">
          Search <kbd>⌘K</kbd>
        </button>
        <button className="ghost desktop-only" disabled={!undoN} onClick={() => useStore.getState().undo()} title="Undo (⌘Z)">
          ↶
        </button>
        <button className="ghost desktop-only" disabled={!redoN} onClick={() => useStore.getState().redo()} title="Redo (⇧⌘Z)">
          ↷
        </button>
        {hive.enabled && <a href="#/admin" className="hive-indicator" title="Browser save, hub receipt and owner disk status">{hive.saving || hive.drafts ? 'Saving…' : hive.state?.outbox.length ? `Saved here · ${hive.state.outbox.length} pending` : !hive.online ? 'Saved here · offline' : hive.status?.pending ? `Saved here · ${hive.status.pending} awaiting hub` : hive.status?.connected ? 'Saved · hub received' : 'Saved here · hub offline'}</a>}
        <span className={`ws ${wsOpen ? "on" : "off"}`} title={wsOpen ? "Live updates connected" : "Live updates disconnected"} />
      </header>
      {error && (
        <div className="error-bar" onClick={() => setError(null)}>
          {error} <span className="dismiss">✕</span>
        </div>
      )}
    </>
  );
}

import { useEffect } from "react";
import { useStore } from "./store";
import { useUi } from "./ui";
import { connectWs } from "./ws";
import { TopBar } from "./components/TopBar";
import { Outline } from "./components/Outline";
import { Admin } from "./components/Admin";
import { SearchPalette } from "./components/SearchPalette";
import { FolderPicker } from "./components/FolderPicker";
import { revealBullet } from "./navigate";

const isMac = navigator.platform.toLowerCase().includes("mac");

export function App() {
  const route = useStore((s) => s.route);
  const picker = useUi((s) => s.picker);
  const closePicker = useUi((s) => s.closePicker);
  const ready = useStore((s) => s.zoom !== null);

  useEffect(() => {
    useStore.getState().init().catch((e) => useStore.getState().setError(`Cannot reach the Lister server: ${e.message}`));
    const dispose = connectWs(
      (m) => {
        const s = useStore.getState();
        if (s.files[m.path]) s.refetch(m.path);
        useUi.getState().tick();
      },
      (open) => useStore.getState().setWsOpen(open),
    );
    const onHash = () => {
      const h = location.hash;
      useStore.getState().setRoute(h.startsWith("#/admin") ? "admin" : "outline");
      const m = h.match(/^#\/b\/([0-9a-z]{8})$/);
      if (m) {
        revealBullet(m[1]).catch(() => undefined);
        history.replaceState(null, "", "#/");
      }
    };
    onHash();
    window.addEventListener("hashchange", onHash);
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useUi.getState().setSearchOpen(true);
      } else if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) useStore.getState().redo();
        else useStore.getState().undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      dispose();
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="app">
      <TopBar />
      <main>{route === "admin" ? <Admin /> : ready ? <Outline /> : <div className="outline loading">Connecting…</div>}</main>
      <SearchPalette />
      {picker && <FolderPicker title={picker.title} onPick={picker.onPick} onClose={closePicker} />}
    </div>
  );
}

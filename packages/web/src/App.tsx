import { StartupContent, startupErrorMessage } from './components/StartupContent';
import { hive, useHive } from "./hive/client";
import { HiveLogin } from "./components/HivePanel";
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
  const hiveView = useHive();
  const error = useStore((s) => s.error);
  const route = useStore((s) => s.route);
  const picker = useUi((s) => s.picker);
  const closePicker = useUi((s) => s.closePicker);
  const ready = useStore((s) => s.zoom !== null);

  useEffect(() => {
    const stopHive = hive.start();
    let priorState = hive.view.state;
    const update = () => {
      const state = hive.view.state;
      if (!state || state === priorState) return;
      priorState = state;
      const files = Object.fromEntries(Object.values(state.snapshot.files).map(file => [`hive:${file.id}`, {...file, path:`hive:${file.id}`} ]));
      useStore.setState({files, rootPath: state.snapshot.rootFileId ? `hive:${state.snapshot.rootFileId}` : null});
    };
    const unsubscribe = hive.subscribe(update);
    useStore.getState().init().catch((e) => useStore.getState().setError(startupErrorMessage(e)));
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
      stopHive();
      unsubscribe();
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className={`app${hiveView.authRequired && !ready && route !== "admin" ? " app-signin" : ""}`}>
      <TopBar />
      <main>
        {hiveView.authRequired && route !== "admin" && <HiveLogin />}
        {route === "admin" ? <Admin /> : <StartupContent ready={ready} authRequired={hiveView.authRequired} error={error} onRetry={() => { void useStore.getState().init().then(() => useStore.getState().setError(null)).catch(e => useStore.getState().setError(startupErrorMessage(e))); }}><Outline /></StartupContent>}
      </main>
      <SearchPalette />
      {picker && <FolderPicker title={picker.title} onPick={picker.onPick} onClose={closePicker} />}
    </div>
  );
}

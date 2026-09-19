import { create } from "zustand";
import type { OutlineFile } from "./types";
import { api } from "./api";

export interface Zoom {
  filePath: string;
  bulletId: string | null;
}

export interface Crumb {
  filePath: string;
  bulletId: string | null;
  text: string;
}

export interface Focus {
  id: string;
  caret: number;
}

export interface UndoOp {
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

interface State {
  files: Record<string, OutlineFile>;
  rootPath: string | null;
  zoom: Zoom | null;
  crumbs: Crumb[];
  collapsed: Record<string, boolean>;
  expandedFolders: Record<string, boolean>;
  focus: Focus | null;
  undoStack: UndoOp[];
  redoStack: UndoOp[];
  wsOpen: boolean;
  error: string | null;
  route: "outline" | "admin";

  init(): Promise<void>;
  loadFile(path: string): Promise<OutlineFile>;
  refetch(path: string): Promise<void>;
  setFile(file: OutlineFile): void;
  setZoom(zoom: Zoom, crumbs: Crumb[]): void;
  toggleCollapsed(id: string): void;
  setCollapsed(id: string, v: boolean): void;
  setFolderExpanded(id: string, v: boolean): void;
  setFocus(f: Focus | null): void;
  pushUndo(op: UndoOp): void;
  undo(): Promise<void>;
  redo(): Promise<void>;
  setError(msg: string | null): void;
  setWsOpen(v: boolean): void;
  setRoute(r: "outline" | "admin"): void;
}

const ZOOM_KEY = "lister.zoom";

export const useStore = create<State>((set, get) => ({
  files: {},
  rootPath: null,
  zoom: null,
  crumbs: [],
  collapsed: {},
  expandedFolders: {},
  focus: null,
  undoStack: [],
  redoStack: [],
  wsOpen: false,
  error: null,
  route: location.hash.startsWith("#/admin") ? "admin" : "outline",

  async init() {
    const root = await api.root();
    set((s) => ({ files: { ...s.files, [root.path]: root }, rootPath: root.path }));
    let zoom: Zoom = { filePath: root.path, bulletId: null };
    let crumbs: Crumb[] = [{ filePath: root.path, bulletId: null, text: root.name }];
    try {
      const saved = JSON.parse(localStorage.getItem(ZOOM_KEY) ?? "null") as { zoom: Zoom; crumbs: Crumb[] } | null;
      if (saved?.zoom?.filePath) {
        await get().loadFile(saved.zoom.filePath);
        zoom = saved.zoom;
        crumbs = saved.crumbs?.length ? saved.crumbs : crumbs;
      }
    } catch {
      /* ignore bad saved state */
    }
    set({ zoom, crumbs });
  },

  async loadFile(path) {
    const existing = get().files[path];
    if (existing) return existing;
    const f = await api.file(path);
    set((s) => ({ files: { ...s.files, [f.path]: f } }));
    return f;
  },

  async refetch(path) {
    try {
      const f = await api.file(path);
      set((s) => ({ files: { ...s.files, [f.path]: f } }));
    } catch (e) {
      // file may have been renamed/trashed: drop it
      set((s) => {
        const files = { ...s.files };
        delete files[path];
        return { files };
      });
    }
  },

  setFile(file) {
    set((s) => ({ files: { ...s.files, [file.path]: file } }));
  },

  setZoom(zoom, crumbs) {
    set({ zoom, crumbs });
    localStorage.setItem(ZOOM_KEY, JSON.stringify({ zoom, crumbs }));
  },

  toggleCollapsed(id) {
    set((s) => ({ collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } }));
  },
  setCollapsed(id, v) {
    set((s) => ({ collapsed: { ...s.collapsed, [id]: v } }));
  },
  setFolderExpanded(id, v) {
    set((s) => ({ expandedFolders: { ...s.expandedFolders, [id]: v } }));
  },
  setFocus(f) {
    set({ focus: f });
  },

  pushUndo(op) {
    set((s) => ({ undoStack: [...s.undoStack.slice(-99), op], redoStack: [] }));
  },
  async undo() {
    const s = get();
    const op = s.undoStack[s.undoStack.length - 1];
    if (!op) return;
    set({ undoStack: s.undoStack.slice(0, -1), redoStack: [...s.redoStack, op] });
    try {
      await op.undo();
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },
  async redo() {
    const s = get();
    const op = s.redoStack[s.redoStack.length - 1];
    if (!op) return;
    set({ redoStack: s.redoStack.slice(0, -1), undoStack: [...s.undoStack, op] });
    try {
      await op.redo();
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  setError(msg) {
    set({ error: msg });
  },
  setWsOpen(v) {
    set({ wsOpen: v });
  },
  setRoute(r) {
    set({ route: r });
  },
}));

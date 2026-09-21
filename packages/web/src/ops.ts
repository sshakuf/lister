// Mutations: optimistic local update → API call → refetch affected files → undo entry.
import { api } from "./api";
import { hive } from "./hive/client";
import { permanentId } from "./hive/replica";
import { useStore } from "./store";
import type { Bullet, BulletPatch } from "./types";
import { isFolderBullet } from "./types";
import { findBullet, insertBullet, moveBullet, removeBullet, updateBullet } from "./tree";
import { folderFilePath } from "./format";
import { checkboxChanges } from "./checkbox-conversion";

const S = () => useStore.getState();

function fail(e: unknown) {
  S().setError((e as Error).message ?? String(e));
}

function localUpdate(filePath: string, fn: (bullets: Bullet[]) => Bullet[]) {
  const f = S().files[filePath];
  if (!f) return;
  S().setFile({ ...f, bullets: fn(f.bullets) });
}

/** Bullet text carrying metadata annotations, as the server accepts for creation. */
function rawLine(b: Bullet): string {
  const parts = [b.text];
  if (b.date) parts.push(`[date:${b.date}]`);
  if (b.priority) parts.push(`[priority:${b.priority}]`);
  if (b.done !== undefined) parts.push(b.done ? `[done:${b.done}]` : "[done]");
  return parts.join(" ");
}

export async function addBullet(filePath: string, parentId: string | null, index: number, text: string, opts: { focus?: boolean; undo?: boolean } = {}): Promise<Bullet | null> {
  const tempId = hive.active ? permanentId() : `tmp-${Math.random().toString(36).slice(2, 10)}`;
  const temp: Bullet = { id: tempId, text, children: [] };
  localUpdate(filePath, (bs) => insertBullet(bs, parentId, index, temp));
  try {
    const b = hive.active ? await hive.add(filePath, parentId, index, text, tempId) : await api.addBullet(filePath, parentId, index, text);
    localUpdate(filePath, (bs) => insertBullet(removeBullet(bs, tempId).bullets, parentId, index, b));
    if (opts.focus !== false) S().setFocus({ id: b.id, caret: 0 });
    if (opts.undo !== false) {
      S().pushUndo({
        label: "add",
        undo: async () => {
          await api.deleteBullet(b.id);
          await S().refetch(filePath);
        },
        redo: async () => {
          if (hive.active) await hive.restore(filePath, parentId, index, b);
          else await api.addBullet(filePath, parentId, index, rawLine(b));
          await S().refetch(filePath);
        },
      });
    }
    await S().refetch(filePath);
    return b;
  } catch (e) {
    fail(e);
    await S().refetch(filePath);
    return null;
  }
}

export async function patchBullet(filePath: string, id: string, patch: BulletPatch, opts: { undo?: boolean } = {}): Promise<void> {
  const f = S().files[filePath];
  const before = f ? findBullet(f.bullets, id)?.bullet : undefined;
  localUpdate(filePath, (bs) => updateBullet(bs, id, patch as Partial<Bullet>));
  try {
    await api.patchBullet(id, patch);
    if (opts.undo !== false && before) {
      const inverse: BulletPatch = {};
      for (const k of Object.keys(patch) as (keyof BulletPatch)[]) (inverse as any)[k] = (before as any)[k] ?? null;
      S().pushUndo({
        label: "edit",
        undo: async () => {
          await api.patchBullet(id, inverse);
          await refetchFor(id, filePath);
        },
        redo: async () => {
          await api.patchBullet(id, patch);
          await refetchFor(id, filePath);
        },
      });
    }
    // renaming a Folder Bullet renames its file: drop the stale child file entry
    if (!hive.active && before && isFolderBullet(before) && patch.text !== undefined && patch.text !== before.text) {
      const old = folderFilePath(before);
      const files = { ...S().files };
      if (files[old]) {
        delete files[old];
        useStore.setState({ files });
      }
    }
    await S().refetch(filePath);
  } catch (e) {
    fail(e);
    await S().refetch(filePath);
  }
}

async function refetchFor(id: string, fallback: string) {
  try {
    const loc = await api.getBullet(id);
    await S().refetch(loc.filePath);
    if (loc.filePath !== fallback) await S().refetch(fallback);
  } catch {
    await S().refetch(fallback);
  }
}

export interface Position {
  filePath: string;
  parentId: string | null;
  index: number;
}

export async function moveTo(id: string, from: Position, to: Position, opts: { undo?: boolean } = {}): Promise<void> {
  if (from.filePath === to.filePath) localUpdate(from.filePath, (bs) => moveBullet(bs, id, to.parentId, to.index));
  try {
    await api.moveBullet(id, to.filePath, to.parentId, to.index);
    if (opts.undo !== false) {
      // when moving within the same parent, the index to move back to is the original index
      S().pushUndo({
        label: "move",
        undo: async () => {
          await api.moveBullet(id, from.filePath, from.parentId, from.index);
          await S().refetch(from.filePath);
          if (to.filePath !== from.filePath) await S().refetch(to.filePath);
        },
        redo: async () => {
          await api.moveBullet(id, to.filePath, to.parentId, to.index);
          await S().refetch(from.filePath);
          if (to.filePath !== from.filePath) await S().refetch(to.filePath);
        },
      });
    }
  } catch (e) {
    fail(e);
  }
  await S().refetch(from.filePath);
  if (to.filePath !== from.filePath) await S().refetch(to.filePath);
}

async function recreate(b: Bullet, filePath: string, parentId: string | null, index: number): Promise<void> {
  const created = await api.addBullet(filePath, parentId, index, rawLine(b));
  for (let i = 0; i < b.children.length; i++) await recreate(b.children[i], filePath, created.id, i);
}

export async function deleteBullet(filePath: string, id: string, opts: { undo?: boolean } = {}): Promise<void> {
  const f = S().files[filePath];
  const loc = f ? findBullet(f.bullets, id) : null;
  localUpdate(filePath, (bs) => removeBullet(bs, id).bullets);
  try {
    await api.deleteBullet(id);
    if (opts.undo !== false && loc) {
      const snapshot = loc.bullet;
      const parentId = loc.parent?.id ?? null;
      const index = loc.index;
      S().pushUndo({
        label: "delete",
        undo: async () => {
          if (hive.active) {
            await hive.restore(filePath, parentId, index, snapshot);
          } else if (isFolderBullet(snapshot)) {
            // detached only: re-adopt the file under the same parent
            await api.adminAdopt(folderFilePath(snapshot), parentId ?? undefined);
          } else {
            await recreate(snapshot, filePath, parentId, index);
          }
          await S().refetch(filePath);
        },
        redo: async () => {
          // ids changed on recreate; find by text at the same position
          const cur = S().files[filePath];
          const list = cur ? (parentId ? findBullet(cur.bullets, parentId)?.bullet.children : cur.bullets) : undefined;
          const target = hive.active ? list?.find((x) => x.id === snapshot.id) : list?.[index] ?? list?.find((x) => x.text === snapshot.text);
          if (target) await api.deleteBullet(target.id);
          await S().refetch(filePath);
        },
      });
    }
  } catch (e) {
    fail(e);
  }
  await S().refetch(filePath);
}

export async function toggleDone(filePath: string, b: Bullet, today: string): Promise<void> {
  await patchBullet(filePath, b.id, { done: b.done === undefined ? today : null });
}

export async function convertToFolder(filePath: string, id: string, folder: string): Promise<Bullet> {
  const b = await api.toFolder(id, folder);
  await S().refetch(filePath);
  S().setFolderExpanded(id, true);
  await S().loadFile(folderFilePath(b)).catch(() => undefined);
  return b;
}

export async function inlineFolder(filePath: string, b: Bullet): Promise<void> {
  const child = folderFilePath(b);
  try {
    await api.inline(b.id);
    const files = { ...S().files };
    delete files[child];
    useStore.setState({ files });
    await S().refetch(filePath);
  } catch (e) {
    fail(e);
  }
}

/** Convert the selected bullet and its direct children as one undoable action. */
export async function convertToCheckbox(filePath: string, id: string): Promise<void> {
  const completed: ReturnType<typeof checkboxChanges> = [];
  const refresh = async () => {
    for (const change of completed) await refetchFor(change.id, filePath);
  };
  try {
    const file = S().files[filePath];
    const bullet = file && findBullet(file.bullets, id)?.bullet;
    if (!bullet) throw new Error("This bullet is no longer available.");
    // Load before making changes: a collapsed folder's children may not be cached.
    const children = isFolderBullet(bullet)
      ? (await S().loadFile(folderFilePath(bullet))).bullets
      : bullet.children;
    for (const change of checkboxChanges(bullet, children)) {
      await api.patchBullet(change.id, { text: change.text });
      completed.push(change);
    }
  } catch (e) {
    fail(e);
  } finally {
    // Even a partially completed request remains undoable if a later write fails.
    if (completed.length) {
      S().pushUndo({
        label: "convert to checkbox",
        undo: async () => {
          try { for (const c of completed) await api.patchBullet(c.id, { text: c.before }); }
          finally { await refresh(); }
        },
        redo: async () => {
          try { for (const c of completed) await api.patchBullet(c.id, { text: c.text }); }
          finally { await refresh(); }
        },
      });
      try { await refresh(); } catch (e) { fail(e); }
    }
  }
}

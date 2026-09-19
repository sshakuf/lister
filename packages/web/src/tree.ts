import type { Bullet, OutlineFile } from "./types";
import { isFolderBullet, type BulletId } from "./types";
import { folderFilePath } from "./format";

export interface Located {
  bullet: Bullet;
  parent: Bullet | null;
  index: number;
}

export function findBullet(bullets: Bullet[], id: BulletId): Located | null {
  const rec = (list: Bullet[], parent: Bullet | null): Located | null => {
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.id === id) return { bullet: b, parent, index: i };
      const r = rec(b.children, b);
      if (r) return r;
    }
    return null;
  };
  return rec(bullets, null);
}

export function pathTo(bullets: Bullet[], id: BulletId): Bullet[] {
  const rec = (list: Bullet[], trail: Bullet[]): Bullet[] | null => {
    for (const b of list) {
      const next = [...trail, b];
      if (b.id === id) return next;
      const r = rec(b.children, next);
      if (r) return r;
    }
    return null;
  };
  return rec(bullets, []) ?? [];
}

function mapList(bullets: Bullet[], parentId: BulletId | null, fn: (list: Bullet[]) => Bullet[]): Bullet[] {
  if (parentId === null) return fn(bullets);
  const rec = (list: Bullet[]): Bullet[] =>
    list.map((b) => (b.id === parentId ? { ...b, children: fn(b.children) } : { ...b, children: rec(b.children) }));
  return rec(bullets);
}

export function insertBullet(bullets: Bullet[], parentId: BulletId | null, index: number, bullet: Bullet): Bullet[] {
  return mapList(bullets, parentId, (list) => {
    const i = Math.max(0, Math.min(index, list.length));
    return [...list.slice(0, i), bullet, ...list.slice(i)];
  });
}

export function removeBullet(bullets: Bullet[], id: BulletId): { bullets: Bullet[]; removed: Bullet | null } {
  let removed: Bullet | null = null;
  const rec = (list: Bullet[]): Bullet[] => {
    const out: Bullet[] = [];
    for (const b of list) {
      if (b.id === id) {
        removed = b;
        continue;
      }
      out.push({ ...b, children: rec(b.children) });
    }
    return out;
  };
  return { bullets: rec(bullets), removed };
}

export function updateBullet(bullets: Bullet[], id: BulletId, patch: Partial<Bullet>): Bullet[] {
  const rec = (list: Bullet[]): Bullet[] =>
    list.map((b) => {
      if (b.id === id) {
        const next: Bullet = { ...b };
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined || v === null) delete (next as any)[k];
          else (next as any)[k] = v;
        }
        return next;
      }
      return { ...b, children: rec(b.children) };
    });
  return rec(bullets);
}

export function moveBullet(bullets: Bullet[], id: BulletId, parentId: BulletId | null, index: number): Bullet[] {
  const loc = findBullet(bullets, id);
  if (!loc) return bullets;
  if (parentId !== null && (parentId === id || findBullet(loc.bullet.children, parentId))) return bullets;
  const { bullets: without } = removeBullet(bullets, id);
  return insertBullet(without, parentId, index, loc.bullet);
}

/** A visible row in the flattened outline. */
export interface Row {
  bullet: Bullet;
  depth: number;
  /** file the bullet line lives in */
  filePath: string;
  /** parent bullet id within that file, null at file top level */
  parentId: BulletId | null;
  index: number;
  siblings: Bullet[];
  hasChildren: boolean;
  expanded: boolean;
  /** for Folder Bullets: path of the child Outline File */
  childFile?: string;
  childFileLoaded?: boolean;
}

export interface FlattenOpts {
  files: Record<string, OutlineFile>;
  collapsed: Record<string, boolean>;
  expandedFolders: Record<string, boolean>;
}

/** Flatten the visible tree starting at (filePath, bulletId|null). Folder Bullet children come from their own file. */
export function flattenVisible(filePath: string, bulletId: BulletId | null, opts: FlattenOpts): Row[] {
  const out: Row[] = [];
  const file = opts.files[filePath];
  if (!file) return out;
  let startList: Bullet[];
  let startParent: BulletId | null;
  if (bulletId === null) {
    startList = file.bullets;
    startParent = null;
  } else {
    const loc = findBullet(file.bullets, bulletId);
    if (!loc) return out;
    if (isFolderBullet(loc.bullet)) {
      const cf = opts.files[folderFilePath(loc.bullet)];
      if (!cf) return out;
      return flattenVisible(cf.path, null, opts);
    }
    startList = loc.bullet.children;
    startParent = bulletId;
  }
  const rec = (list: Bullet[], depth: number, fp: string, parentId: BulletId | null) => {
    list.forEach((b, i) => {
      const folder = isFolderBullet(b);
      const childFile = folder ? folderFilePath(b) : undefined;
      const childLoaded = childFile ? !!opts.files[childFile] : undefined;
      const hasChildren = folder ? true : b.children.length > 0;
      const expanded = folder ? !!opts.expandedFolders[b.id] : !opts.collapsed[b.id];
      out.push({ bullet: b, depth, filePath: fp, parentId, index: i, siblings: list, hasChildren, expanded, childFile, childFileLoaded: childLoaded });
      if (!expanded) return;
      if (folder) {
        const cf = childFile && opts.files[childFile];
        if (cf) rec(cf.bullets, depth + 1, cf.path, null);
      } else {
        rec(b.children, depth + 1, fp, b.id);
      }
    });
  };
  rec(startList, 0, filePath, startParent);
  return out;
}

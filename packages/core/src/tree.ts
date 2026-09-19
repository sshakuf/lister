import type { Bullet, BulletId } from "./model.js";

export class CycleError extends Error {
  constructor() {
    super("cannot move a Bullet into its own descendant");
    this.name = "CycleError";
  }
}

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

export function walk(bullets: Bullet[], fn: (b: Bullet, parent: Bullet | null, depth: number) => void): void {
  const rec = (list: Bullet[], parent: Bullet | null, depth: number) => {
    for (const b of list) {
      fn(b, parent, depth);
      rec(b.children, b, depth + 1);
    }
  };
  rec(bullets, null, 0);
}

/** Ancestors from root down to and including the Bullet. */
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

function mapList(bullets: Bullet[], targetParent: BulletId | null, fn: (list: Bullet[]) => Bullet[]): Bullet[] {
  if (targetParent === null) return fn(bullets);
  const rec = (list: Bullet[]): Bullet[] =>
    list.map((b) => (b.id === targetParent ? { ...b, children: fn(b.children) } : { ...b, children: rec(b.children) }));
  return rec(bullets);
}

export function insertBullet(bullets: Bullet[], parentId: BulletId | null, index: number, bullet: Bullet): Bullet[] {
  if (parentId !== null && !findBullet(bullets, parentId)) throw new Error(`parent ${parentId} not found`);
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
      out.push(removed ? b : { ...b, children: rec(b.children) });
    }
    return out;
  };
  const next = rec(bullets);
  return { bullets: next, removed };
}

export type BulletPatch = Partial<Pick<Bullet, "text" | "note" | "folder" | "date" | "priority" | "done">>;

export function updateBullet(bullets: Bullet[], id: BulletId, patch: BulletPatch): Bullet[] {
  const rec = (list: Bullet[]): Bullet[] =>
    list.map((b) => {
      if (b.id === id) {
        const next: Bullet = { ...b, children: b.children };
        for (const [k, v] of Object.entries(patch) as [keyof BulletPatch, unknown][]) {
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
  if (!loc) throw new Error(`bullet ${id} not found`);
  if (parentId !== null) {
    if (parentId === id || findBullet(loc.bullet.children, parentId)) throw new CycleError();
  }
  const { bullets: without } = removeBullet(bullets, id);
  return insertBullet(without, parentId, index, loc.bullet);
}

export function flatten(bullets: Bullet[]): Bullet[] {
  const out: Bullet[] = [];
  walk(bullets, (b) => out.push(b));
  return out;
}

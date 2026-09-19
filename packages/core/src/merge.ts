import type { Bullet, BulletId, OutlineFile } from "./model.js";
import { findBullet, insertBullet } from "./tree.js";

interface Flat {
  bullet: Bullet;
  parentId: BulletId | null;
  index: number;
}

function flattenMap(bullets: Bullet[]): Map<BulletId, Flat> {
  const m = new Map<BulletId, Flat>();
  const rec = (list: Bullet[], parentId: BulletId | null) => {
    list.forEach((b, i) => {
      m.set(b.id, { bullet: b, parentId, index: i });
      rec(b.children, b.id);
    });
  };
  rec(bullets, null);
  return m;
}

function sameContent(a: Bullet, b: Bullet): boolean {
  return (
    a.text === b.text &&
    (a.note ?? "") === (b.note ?? "") &&
    (a.folder ?? "") === (b.folder ?? "") &&
    (a.date ?? "") === (b.date ?? "") &&
    (a.priority ?? 0) === (b.priority ?? 0) &&
    (a.done ?? "\u0000") === (b.done ?? "\u0000")
  );
}

function withContent(target: Bullet, src: Bullet): Bullet {
  const { children: _c, ...rest } = src;
  return { ...rest, children: target.children };
}

/**
 * Three-way merge by Bullet id.
 * - Structure and header come from `theirs` (the newer external write).
 * - Bullets changed only in `mine` keep mine's content.
 * - Bullets new in `mine` are inserted under the same parent (or at root end if the parent is gone).
 * - Bullets deleted in `mine` and unchanged in `theirs` are removed.
 * - Same-Bullet conflicts take `theirs`.
 */
export function mergeOutlines(base: OutlineFile, mine: OutlineFile, theirs: OutlineFile): OutlineFile {
  const B = flattenMap(base.bullets);
  const M = flattenMap(mine.bullets);
  const T = flattenMap(theirs.bullets);

  let result = structuredClone(theirs.bullets) as Bullet[];

  // 1. apply mine-only content changes onto theirs' structure
  const applyMine = (list: Bullet[]): Bullet[] =>
    list.map((tb) => {
      const mb = M.get(tb.id);
      const bb = B.get(tb.id);
      let next = tb;
      if (mb && bb) {
        const mineChanged = !sameContent(mb.bullet, bb.bullet);
        const theirsChanged = !sameContent(tb, bb.bullet);
        if (mineChanged && !theirsChanged) next = withContent(tb, mb.bullet);
      }
      return { ...next, children: applyMine(next.children) };
    });
  result = applyMine(result);

  // 2. remove bullets deleted in mine if theirs left them unchanged
  const deletedInMine = [...B.keys()].filter((id) => !M.has(id) && T.has(id));
  for (const id of deletedInMine) {
    const bb = B.get(id)!;
    const tb = T.get(id)!;
    if (sameContent(bb.bullet, tb.bullet) && bb.parentId === tb.parentId) {
      result = removeKeepingChildren(result, id);
    }
  }

  // 3. add bullets new in mine (not in base, not in theirs), parents first
  const newInMine = [...M.values()].filter((f) => !B.has(f.bullet.id) && !T.has(f.bullet.id));
  newInMine.sort((a, b) => depthOf(M, a.bullet.id) - depthOf(M, b.bullet.id) || a.index - b.index);
  for (const f of newInMine) {
    const copy: Bullet = { ...f.bullet, children: [] };
    const parentExists = f.parentId === null || findBullet(result, f.parentId);
    if (parentExists) result = insertBullet(result, f.parentId, f.index, copy);
    else result = insertBullet(result, null, Number.MAX_SAFE_INTEGER, copy);
  }

  return { ...theirs, bullets: result };
}

function depthOf(m: Map<BulletId, Flat>, id: BulletId): number {
  let d = 0;
  let cur = m.get(id);
  while (cur && cur.parentId !== null) {
    d++;
    cur = m.get(cur.parentId);
  }
  return d;
}

/** Remove a bullet; its children (which theirs still has) are hoisted into its place. */
function removeKeepingChildren(list: Bullet[], id: BulletId): Bullet[] {
  const out: Bullet[] = [];
  for (const b of list) {
    if (b.id === id) {
      out.push(...b.children);
      continue;
    }
    out.push({ ...b, children: removeKeepingChildren(b.children, id) });
  }
  return out;
}

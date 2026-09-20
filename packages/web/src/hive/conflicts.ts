import type { HiveSnapshot } from '@lister/core/hive';
import type { Bullet } from '../types';
import { findBullet, insertBullet, removeBullet } from '../tree';

function locate(snapshot: Pick<HiveSnapshot, 'files'>, id: string) {
  for (const file of Object.values(snapshot.files)) {
    const found = findBullet(file.bullets, id);
    if (found) return {file, ...found};
  }
  return null;
}

/** Recover only the selected candidate; a historical snapshot never replaces the hive. */
export function resolveConflict(snapshot: HiveSnapshot, conflictId: string, choice: 'current' | 'proposed'): HiveSnapshot {
  const conflict = snapshot.conflicts.find(c => c.id === conflictId);
  if (!conflict) throw new Error('This conflict has already been resolved');
  const next = structuredClone(snapshot);
  if (choice === 'current') return next;
  if (conflict.field === 'ownerId') throw new Error('File ownership changes require the owning device');
  if (conflict.field === 'rootFileId') {
    const id = conflict.proposed as string | null;
    if (id && !next.files[id]) throw new Error('The proposed root file is missing');
    next.rootFileId = id;
    return next;
  }
  const current = locate(next, conflict.bulletId);
  if (['name', 'parentId'].includes(conflict.field) && next.files[conflict.bulletId]) {
    const file = next.files[conflict.bulletId];
    if (conflict.proposed == null) delete (file as any)[conflict.field];
    else (file as any)[conflict.field] = structuredClone(conflict.proposed);
    return next;
  }
  if (!conflict.context) {
    if (!current || !['text','note','folder','outline','date','priority','done'].includes(conflict.field)) throw new Error('This candidate needs structural recovery; export it for inspection');
    if (conflict.proposed == null) delete (current.bullet as any)[conflict.field];
    else (current.bullet as any)[conflict.field] = structuredClone(conflict.proposed);
    if (conflict.field === 'text' && current.bullet.outline && next.files[current.bullet.outline]) next.files[current.bullet.outline].name = current.bullet.text;
    return next;
  }
  const proposed = conflict.context.proposed;
  if (conflict.field === 'file') {
    const file = proposed.files[conflict.bulletId];
    if (!file) throw new Error('Deleting a conflicted file needs review; export the candidates and remove its contents explicitly');
    if (next.files[file.id]) throw new Error('This file already exists. Keep the current file or recover individual bullets from the export');
    const copy = structuredClone(file);
    const check = (bullets: Bullet[]) => {for (const b of bullets) {if (locate(next,b.id)) throw new Error('A recovered bullet already exists elsewhere');check(b.children);}};
    check(copy.bullets);
    next.files[file.id] = copy;
    return next;
  }
  // Order conflicts store group identities, not bullet identities.
  if (conflict.bulletId.startsWith('file:') || conflict.bulletId.startsWith('bullet:')) {
    const [kind,id] = conflict.bulletId.split(':');
    const list = kind === 'file' ? next.files[id]?.bullets : locate(next,id)?.bullet.children;
    if (!list || !Array.isArray(conflict.proposed)) throw new Error('The destination for this order is missing');
    const wanted = conflict.proposed as string[];
    const ordered = wanted.map(id => list.find(b => b.id === id)).filter((b): b is Bullet => !!b);
    ordered.push(...list.filter(b => !wanted.includes(b.id)));
    list.splice(0,list.length,...ordered);
    return next;
  }
  const candidate = locate(proposed, conflict.bulletId);
  if (!candidate) {
    if (current) current.file.bullets = removeBullet(current.file.bullets,current.bullet.id).bullets;
    return next;
  }
  const destination = next.files[candidate.file.id];
  if (!destination) throw new Error('Recover the missing destination file first');
  const parentId = candidate.parent?.id ?? null;
  if (parentId && !findBullet(destination.bullets,parentId)) throw new Error('Recover the missing parent first');
  if (current && parentId && (parentId === current.bullet.id || findBullet(current.bullet.children,parentId))) throw new Error('This move would create a cycle');
  // A placement choice preserves all current content. Deleted candidates restore
  // their saved subtree, but never overwrite IDs now living elsewhere.
  const bullet = structuredClone(current?.bullet ?? candidate.bullet);
  if (!current) {
    const check = (children: Bullet[]) => {for (const b of children) {if (locate(next,b.id)) throw new Error('A recovered child already exists elsewhere');check(b.children);}};
    check(bullet.children);
  } else if (conflict.field === 'creation') {
    for (const key of ['text','note','date','priority','done','outline'] as const) {
      if (candidate.bullet[key] === undefined) delete bullet[key];
      else (bullet as any)[key] = candidate.bullet[key];
    }
  }
  if (current) current.file.bullets = removeBullet(current.file.bullets,bullet.id).bullets;
  destination.bullets = insertBullet(destination.bullets,parentId,candidate.index,bullet);
  return next;
}

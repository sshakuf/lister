import type { Bullet } from './model.js';

/** Shared data contains file identities, never a nonowner's path mapping. */
export interface SharedFile {
  id: string;
  name: string;
  ownerId: string;
  parentId?: string;
  bullets: Bullet[];
}
export interface HiveSnapshot {
  rootFileId: string | null;
  files: Record<string, SharedFile>;
  conflicts: HiveConflict[];
}
export interface HiveConflict {
  id: string;
  bulletId: string;
  field: string;
  base: unknown;
  current: unknown;
  proposed: unknown;
  operationId: string;
  replicaId?: string;
  fileId?: string;
  /** Complete structural candidates, without recursively nesting conflict history. */
  context?: {
    base: Omit<HiveSnapshot, 'conflicts'>;
    current: Omit<HiveSnapshot, 'conflicts'>;
    proposed: Omit<HiveSnapshot, 'conflicts'>;
  };
}
export interface HiveOperation {
  id: string;
  replicaId: string;
  base: HiveSnapshot;
  next: HiveSnapshot;
  resolves?: string[];
}
export function emptyHive(): HiveSnapshot {
  return { rootFileId: null, files: {}, conflicts: [] };
}

interface Placement { fileId: string; parentId: string | null }
interface Node { value: Omit<Bullet, 'children'>; place: Placement; tree: Bullet }
interface Flat { nodes: Map<string, Node>; groups: Map<string, string[]> }
const fields = ['text', 'note', 'folder', 'outline', 'date', 'priority', 'done'] as const;
const key = (p: Placement) => p.parentId === null ? `file:${p.fileId}` : `bullet:${p.parentId}`;
const samePlace = (a: Placement, b: Placement) => key(a) === key(b);
const clone = <T>(value: T): T => structuredClone(value);
/** Property insertion order and absent optional fields are not semantic edits. */
function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => equal(v, b[i]));
  }
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every(k => equal(left[k], right[k]));
}
function flatten(snapshot: HiveSnapshot): Flat {
  const nodes = new Map<string, Node>(), groups = new Map<string, string[]>();
  for (const [fileId, file] of Object.entries(snapshot.files)) {
    if (file.id !== fileId) throw new Error(`File identity mismatch: ${fileId}`);
    const walk = (bullets: Bullet[], parentId: string | null) => {
      groups.set(key({fileId,parentId}), bullets.map(b => b.id));
      for (const tree of bullets) {
        if (nodes.has(tree.id)) throw new Error(`Duplicate bullet identity: ${tree.id}`);
        const {children, ...value} = tree;
        nodes.set(tree.id, {value: clone(value), place: {fileId,parentId}, tree});
        walk(children, tree.id);
      }
    };
    walk(file.bullets, null);
  }
  return {nodes,groups};
}

/** Longest stable subsequence, using permanent IDs rather than stale indices. */
function stableIds(base: string[], next: string[]): Set<string> {
  const indexes = new Map(base.map((id,i) => [id,i]));
  const sequence = next.filter(id => indexes.has(id));
  const tails: number[] = [], previous: number[] = [];
  for (let i = 0; i < sequence.length; i++) {
    const position = indexes.get(sequence[i])!;
    let lo = 0, hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (indexes.get(sequence[tails[mid]])! < position) lo = mid + 1;
      else hi = mid;
    }
    previous[i] = lo ? tails[lo-1] : -1;
    tails[lo] = i;
  }
  const stable = new Set<string>();
  for (let i = tails.length ? tails[tails.length-1] : -1; i >= 0; i = previous[i]) stable.add(sequence[i]);
  return stable;
}
function movedIds(base: Flat, next: Flat): Set<string> {
  const moved = new Set<string>();
  for (const [group, ids] of next.groups) {
    const stable = stableIds(base.groups.get(group) ?? [], ids);
    for (const id of ids) if (!stable.has(id)) moved.add(id);
  }
  return moved;
}
function anchor(flat: Flat, base: Flat, id: string): string | null {
  const n = flat.nodes.get(id)!;
  const ids = flat.groups.get(key(n.place)) ?? [];
  for (let i = ids.indexOf(id)-1; i >= 0; i--) if (base.nodes.has(ids[i])) return ids[i];
  return null;
}
function content(snapshot: HiveSnapshot): Omit<HiveSnapshot,'conflicts'> {
  return {rootFileId:snapshot.rootFileId,files:clone(snapshot.files)};
}

/**
 * Pure semantic three-way merge. Receipt/deduplication and causal admission belong
 * to the durable replica. Conflicts retain the accepted value and all proposals.
 */
export function applyHiveOperation(current: HiveSnapshot, operation: HiveOperation): HiveSnapshot {
  const {base,next} = operation;
  const before = flatten(base), accepted = flatten(current), proposed = flatten(next);
  const result = clone(current);
  const merged = flatten(result);
  const proposedMoves = movedIds(before,proposed), currentMoves = movedIds(before,accepted);
  // Snapshots cannot uniquely name the moved sibling in every permutation.
  // Concurrent unequal reorders of the same surviving siblings require review.
  const ambiguousOrder = new Set<string>();
  for (const [group, ids] of before.groups) {
    const left = accepted.groups.get(group) ?? [], right = proposed.groups.get(group) ?? [];
    const common = new Set(ids.filter(id => left.includes(id) && right.includes(id)));
    const original = ids.filter(id => common.has(id)), a = left.filter(id => common.has(id)), n = right.filter(id => common.has(id));
    if (!equal(original,a) && !equal(original,n) && !equal(a,n)) ambiguousOrder.add(group);
  }
  const acceptedMoves = new Set<string>();
  const rejectedParents = new Set<string>();
  // A rejected identity stays ambiguous across later queued edits, even when
  // its text changes. Dependent placements wait for an explicit resolution.
  for (const prior of current.conflicts) {
    if (prior.field !== 'creation') continue;
    const resolving = operation.resolves?.includes(prior.id) && base.conflicts.some(c => equal(c,prior));
    if (!resolving) rejectedParents.add(prior.bulletId);
  }

  const newConflicts = new Set<string>();
  const conflict = (id: string, field: string, a: unknown, c: unknown, n: unknown, structural = false) => {
    const conflictId = `${operation.id}:${encodeURIComponent(id)}:${field}`;
    newConflicts.add(`${id}:${field}`);
    if (result.conflicts.some(c => c.id === conflictId)) return;
    const record: HiveConflict = {id:conflictId,bulletId:id,field,base:clone(a ?? null),current:clone(c ?? null),proposed:clone(n ?? null),operationId:operation.id,replicaId:operation.replicaId};
    const node = proposed.nodes.get(id) ?? accepted.nodes.get(id) ?? before.nodes.get(id);
    if (node) record.fileId = node.place.fileId;
    if (structural) record.context = {base:content(base),current:content(current),proposed:content(next)};
    result.conflicts.push(record);
  };
  const mergeField = (id: string, field: string, a: unknown, c: unknown, n: unknown): unknown => {
    if (equal(a,n) || equal(c,n)) return c;
    if (equal(a,c)) return clone(n);
    conflict(id,field,a,c,n);
    return c;
  };

  // File registration and metadata are independent of bullet placement.
  const blockedFiles = new Set<string>();
  for (const fileId of new Set([...Object.keys(base.files),...Object.keys(next.files)])) {
    const a = base.files[fileId], c = current.files[fileId], n = next.files[fileId];
    if (!a && n) {
      if (!c) result.files[fileId] = {...clone(n),bullets:[]};
      else if (!equal({...c,bullets:[]},{...n,bullets:[]})) { conflict(fileId,'file',a,c,n,true); blockedFiles.add(fileId); }
    } else if (a && !n) {
      if (!c) continue;
      if (equal(a,c)) delete result.files[fileId];
      else { conflict(fileId,'file',a,c,n,true); blockedFiles.add(fileId); }
    } else if (a && n && !c) {
      if (!equal(a,n)) conflict(fileId,'file',a,c,n,true);
      blockedFiles.add(fileId);
    } else if (a && n && c) {
      for (const field of ['name','parentId','ownerId'] as const) {
        // Ownership transfer requires a separate protocol and is not supported.
        if (field === 'ownerId' && a.ownerId !== n.ownerId) { conflict(fileId,'ownerId',a.ownerId,c.ownerId,n.ownerId); continue; }
        const value = mergeField(fileId,field,a[field],c[field],n[field]);
        if (value === undefined) delete result.files[fileId][field];
        else (result.files[fileId] as unknown as Record<string, unknown>)[field] = value;
      }
    }
  }
  result.rootFileId = mergeField('$hive','rootFileId',base.rootFileId,current.rootFileId,next.rootFileId) as string | null;

  // A deleted subtree is removed only when the accepted subtree is unchanged.
  // Conflicting parent deletion protects its complete current descendants.
  const protectedNodes = new Set<string>();
  const protect = (tree: Bullet) => { protectedNodes.add(tree.id); tree.children.forEach(protect); };
  for (const [id,a] of before.nodes) {
    if (proposed.nodes.has(id)) continue;
    const c = accepted.nodes.get(id);
    if (!c) continue;
    if (blockedFiles.has(a.place.fileId) || !equal(a.tree,c.tree) || !samePlace(a.place,c.place) || currentMoves.has(id)) {
      conflict(id,'deletion',a.tree,c.tree,null,true);
      protect(c.tree);
    }
  }
  for (const [id,a] of before.nodes) {
    if (!proposed.nodes.has(id) && !protectedNodes.has(id) && !blockedFiles.has(a.place.fileId)) merged.nodes.delete(id);
  }

  for (const [id,n] of proposed.nodes) {
    const a = before.nodes.get(id), c = accepted.nodes.get(id);
    if (blockedFiles.has(n.place.fileId)) continue;
    if (!a) {
      if (!c) { merged.nodes.set(id,clone(n)); acceptedMoves.add(id); }
      else if (!equal(n.value,c.value) || !samePlace(n.place,c.place)) {
        conflict(id,'creation',null,c.tree,n.tree,true);
        rejectedParents.add(id);
      }
      continue;
    }
    if (!c) {
      if (!equal(a.tree,n.tree) || proposedMoves.has(id)) conflict(id,'deletion',a.tree,null,n.tree,true);
      continue;
    }
    const target = merged.nodes.get(id)!;
    for (const field of fields) {
      const value = mergeField(id,field,a.value[field],c.value[field],n.value[field]);
      if (value === undefined) delete target.value[field];
      else (target.value as unknown as Record<string,unknown>)[field] = value;
    }
    if (!proposedMoves.has(id)) continue;
    if (samePlace(a.place,n.place) && ambiguousOrder.has(key(n.place))) {
      conflict(id,'placement',a.place,c.place,n.place,true);
      continue;
    }
    if (currentMoves.has(id) && (!samePlace(c.place,n.place) || anchor(accepted,before,id) !== anchor(proposed,before,id))) {
      conflict(id,'placement',a.place,c.place,n.place,true);
    } else {
      target.place = clone(n.place);
      acceptedMoves.add(id);
    }
  }

  // Validate the whole forest after combining changes. Reject only dependent
  // placements, retaining unrelated field edits and other valid moves.
  const invalid = (id: string): boolean => {
    const seen = new Set<string>();
    let node = merged.nodes.get(id);
    while (node) {
      if (seen.has(node.value.id)) return true;
      seen.add(node.value.id);
      if (node.place.parentId === null) return !result.files[node.place.fileId];
      if (rejectedParents.has(node.place.parentId) && acceptedMoves.has(id)) return true;
      node = merged.nodes.get(node.place.parentId);
      if (!node) return true;
    }
    return false;
  };
  for (const id of [...acceptedMoves].sort()) {
    if (!invalid(id)) continue;
    const a = before.nodes.get(id), c = accepted.nodes.get(id), n = proposed.nodes.get(id)!;
    conflict(id,'placement',a?.tree,c?.tree,n.tree,true);
    if (c) merged.nodes.get(id)!.place = clone(c.place);
    else merged.nodes.delete(id);
    acceptedMoves.delete(id);
  }
  // Descendants of a rejected new parent are rejected with the complete context.
  for (const [id,n] of merged.nodes) {
    if (!invalid(id)) continue;
    conflict(id,'placement',before.nodes.get(id)?.tree,accepted.nodes.get(id)?.tree,proposed.nodes.get(id)?.tree,true);
    merged.nodes.delete(id);
  }

  // Folder references add edges between files to the shared outline tree.
  // A locally valid bullet move can still place a file inside itself indirectly.
  const referenceCycles = (): string[] => {
    const edges: {id:string;from:string;to:string}[] = [];
    for (const [id,node] of merged.nodes) {
      const target = node.value.outline ?? (node.value.folder && result.files[id] ? id : undefined);
      if (!target || !result.files[target]) continue;
      let root = node;
      while (root.place.parentId !== null) root = merged.nodes.get(root.place.parentId)!;
      edges.push({id,from:root.place.fileId,to:target});
    }
    const outgoing = new Map<string,string[]>();
    for (const edge of edges) outgoing.set(edge.from,[...(outgoing.get(edge.from) ?? []),edge.to]);
    const reaches = (from:string,to:string,seen=new Set<string>()):boolean => {
      if (from === to) return true;
      if (seen.has(from)) return false;
      seen.add(from);
      return (outgoing.get(from) ?? []).some(next => reaches(next,to,seen));
    };
    return edges.filter(edge => reaches(edge.to,edge.from)).map(edge => edge.id);
  };
  for (;;) {
    const cycles = referenceCycles();
    if (!cycles.length) break;
    let reverted = false;
    for (const refId of cycles) {
      let id: string | null = refId;
      while (id !== null) {
        const node: Node | undefined = merged.nodes.get(id);
        if (!node) break;
        const old = accepted.nodes.get(id);
        const changedReference = id === refId && old && !equal(old.value.outline,node.value.outline);
        if (acceptedMoves.has(id) || changedReference) {
          conflict(id,'placement',before.nodes.get(id)?.tree,old?.tree,proposed.nodes.get(id)?.tree,true);
          if (!old) merged.nodes.delete(id);
          else {
            node.place = clone(old.place);
            if (id === refId) {
              if (old.value.outline === undefined) delete node.value.outline;
              else node.value.outline = old.value.outline;
            }
          }
          acceptedMoves.delete(id);
          reverted = true;
          break;
        }
        id = node.place.parentId;
      }
      if (reverted) break;
    }
    if (!reverted) throw new Error('Accepted hive contains a cyclic outline reference');
    // A rejected newly inserted reference may itself have new descendants.
    for (const [id] of merged.nodes) if (invalid(id)) {
      conflict(id,'placement',before.nodes.get(id)?.tree,accepted.nodes.get(id)?.tree,proposed.nodes.get(id)?.tree,true);
      merged.nodes.delete(id);
      acceptedMoves.delete(id);
    }
  }

  const groups = new Map<string,string[]>();
  for (const [id,n] of merged.nodes) {
    const group = key(n.place);
    if (!groups.has(group)) groups.set(group,[]);
    groups.get(group)!.push(id);
  }
  const ordered = new Map<string,string[]>();
  for (const [group,ids] of groups) {
    const members = new Set(ids);
    const currentIds = (accepted.groups.get(group) ?? []).filter(id => members.has(id) && !acceptedMoves.has(id));
    const nextIds = (proposed.groups.get(group) ?? []).filter(id => members.has(id) && (acceptedMoves.has(id) || !currentMoves.has(id)));
    const edges = new Map(ids.map(id => [id,new Set<string>()]));
    const degrees = new Map(ids.map(id => [id,0]));
    const addEdges = (sequence: string[]) => {
      for (let i = 1; i < sequence.length; i++) {
        const from = sequence[i-1], to = sequence[i];
        if (!edges.get(from)!.has(to)) { edges.get(from)!.add(to); degrees.set(to,degrees.get(to)!+1); }
      }
    };
    addEdges(currentIds);
    // Incoming order contributes constraints only if this group really changed.
    if (nextIds.some(id => acceptedMoves.has(id))) addEdges(nextIds);
    const order: string[] = [];
    const ready = ids.filter(id => degrees.get(id) === 0).sort();
    while (ready.length) {
      const id = ready.shift()!; order.push(id);
      for (const to of edges.get(id)!) {
        degrees.set(to,degrees.get(to)!-1);
        if (degrees.get(to) === 0) { ready.push(to); ready.sort(); }
      }
    }
    if (order.length !== ids.length) {
      conflict(group,'placement',before.groups.get(group),accepted.groups.get(group),proposed.groups.get(group),true);
      // Accepted order wins; new content remains accessible and its desired order
      // remains in the structural conflict's complete proposal.
      const existing = (accepted.groups.get(group) ?? []).filter(id => members.has(id));
      order.splice(0,order.length,...existing,...ids.filter(id => !existing.includes(id)).sort());
    }
    ordered.set(group,order);
  }
  const build = (group: string): Bullet[] => (ordered.get(group) ?? []).map(id => ({...merged.nodes.get(id)!.value,children:build(`bullet:${id}`)}));
  for (const [id,file] of Object.entries(result.files)) file.bullets = build(`file:${id}`);
  if (result.rootFileId && !result.files[result.rootFileId]) {
    conflict('$hive','rootFileId',base.rootFileId,current.rootFileId,next.rootFileId,true);
    result.rootFileId = current.rootFileId && result.files[current.rootFileId] ? current.rootFileId : null;
  }

  // Resolving requires the exact observed conflict, with no fresh conflict on
  // that target. A resolution's field changes pass through the normal merge.
  for (const id of operation.resolves ?? []) {
    const observed = base.conflicts.find(c => c.id === id);
    const pending = result.conflicts.find(c => c.id === id);
    if (!observed || !pending || !equal(observed,pending)) continue;
    if ([...newConflicts].some(k => k.startsWith(`${pending.bulletId}:`))) continue;
    const oldNode = before.nodes.get(pending.bulletId), nowNode = accepted.nodes.get(pending.bulletId);
    const field = pending.field as typeof fields[number];
    const unchanged = fields.includes(field)
      ? equal(oldNode?.value[field],nowNode?.value[field])
      : equal(content(base),content(current));
    if (!unchanged) continue;
    result.conflicts = result.conflicts.filter(c => c.id !== id);
  }
  return result;
}

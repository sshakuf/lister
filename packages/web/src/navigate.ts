import { api } from "./api";
import { useStore, type Crumb } from "./store";
import type { Row } from "./tree";
import { pathTo } from "./tree";
import { folderFilePath } from "./format";
import { isFolderBullet } from "./types";

const S = () => useStore.getState();

/** Zoom into a visible row. Crumbs are extended with the row's visible ancestors. */
export async function zoomIntoRow(rows: Row[], rowIndex: number): Promise<void> {
  const row = rows[rowIndex];
  const ancestors: Row[] = [];
  let depth = row.depth;
  for (let i = rowIndex - 1; i >= 0 && depth > 0; i--) {
    if (rows[i].depth === depth - 1) {
      ancestors.unshift(rows[i]);
      depth--;
    }
  }
  const crumbs: Crumb[] = [...S().crumbs];
  for (const a of ancestors) crumbs.push(crumbFor(a));
  const target = crumbFor(row);
  crumbs.push(target);
  if (row.childFile) await S().loadFile(row.childFile).catch(() => undefined);
  S().setZoom({ filePath: target.filePath, bulletId: target.bulletId }, crumbs);
}

function crumbFor(r: Row): Crumb {
  if (r.childFile) return { filePath: r.childFile, bulletId: null, text: r.bullet.text };
  return { filePath: r.filePath, bulletId: r.bullet.id, text: r.bullet.text };
}

export function zoomToCrumb(index: number): void {
  const crumbs = S().crumbs.slice(0, index + 1);
  const c = crumbs[crumbs.length - 1];
  S().setZoom({ filePath: c.filePath, bulletId: c.bulletId }, crumbs);
}

/** Crumbs from the root down to (and including) the given file, following [parent:] headers. */
export async function crumbsForFile(filePath: string, depthGuard = 0): Promise<Crumb[]> {
  const rootPath = S().rootPath!;
  const rootName = S().files[rootPath]?.name ?? "Home";
  const rootCrumb: Crumb = { filePath: rootPath, bulletId: null, text: rootName };
  if (filePath === rootPath) return [rootCrumb];
  if (depthGuard > 20) return [rootCrumb];
  const file = await S().loadFile(filePath);
  const self: Crumb = { filePath, bulletId: null, text: file.name };
  if (!file.parentId) return [rootCrumb, self];
  try {
    const loc = await api.getBullet(file.parentId);
    if (isFolderBullet(loc.bullet) && loc.bullet.id === file.parentId && folderFilePath(loc.bullet) !== filePath) {
      // parent is the Folder Bullet of the containing file
      const parentFile = folderFilePath(loc.bullet);
      return [...(await crumbsForFile(parentFile, depthGuard + 1)), self];
    }
    // parent is an ordinary bullet inside loc.filePath
    const base = await crumbsForFile(loc.filePath, depthGuard + 1);
    const pf = await S().loadFile(loc.filePath);
    const chain = pathTo(pf.bullets, file.parentId).map((b) => ({ filePath: loc.filePath, bulletId: b.id, text: b.text }));
    return [...base, ...chain, self];
  } catch {
    return [rootCrumb, self];
  }
}

/** Navigate so that bullet `id` is visible, then focus it. */
export async function revealBullet(id: string): Promise<void> {
  const loc = await api.getBullet(id);
  const file = await S().loadFile(loc.filePath);
  useStore.getState().refetch(loc.filePath).catch(() => undefined);
  const fileCrumbs = await crumbsForFile(loc.filePath);
  const chain = pathTo(file.bullets, id);
  const ancestors = chain.slice(0, -1);
  // zoom to the nearest ancestor so the bullet is shallow, expand ancestors
  const zoomTo = ancestors.length ? ancestors[ancestors.length - 1] : null;
  const crumbs: Crumb[] = [...fileCrumbs, ...ancestors.map((b) => ({ filePath: loc.filePath, bulletId: b.id, text: b.text }))];
  for (const a of ancestors) S().setCollapsed(a.id, false);
  S().setZoom({ filePath: loc.filePath, bulletId: zoomTo ? zoomTo.id : null }, crumbs);
  S().setFocus({ id, caret: 0 });
}

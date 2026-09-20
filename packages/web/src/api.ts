import type { AdminReport, Bullet, BulletPatch, Hit, LocatedBullet, OutlineFile } from "./types";

import { hive } from "./hive/client";
import { request as req } from "./hive/http";
export { ApiError } from "./hive/http";

const q = (obj: Record<string, string | undefined>) =>
  Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
    .join("&");

export const api = {
  health: () => req<{ ok: boolean }>("GET", "/api/health"),
  root: async () => (await hive.initialize()) ? hive.root() : req<OutlineFile>("GET", "/api/root"),
  file: (path: string) => hive.active ? hive.file(path) : req<OutlineFile>("GET", `/api/files?${q({ path })}`),
  getBullet: (id: string) => hive.active ? hive.bullet(id) : req<LocatedBullet>("GET", `/api/bullets/${id}`),
  addBullet: (filePath: string, parentId: string | null, index: number, text: string) =>
    hive.active ? hive.add(filePath, parentId, index, text) : req<Bullet>("POST", "/api/bullets", { filePath, parentId, index, text }),
  patchBullet: (id: string, patch: BulletPatch) => hive.active ? hive.patch(id, patch) : req<Bullet>("PATCH", `/api/bullets/${id}`, patch),
  moveBullet: (id: string, filePath: string, parentId: string | null, index: number) =>
    hive.active ? hive.move(id, filePath, parentId, index) : req<{ ok: true }>("POST", `/api/bullets/${id}/move`, { filePath, parentId, index }),
  deleteBullet: (id: string) => hive.active ? hive.remove(id) : req<{ ok: true; detached: boolean }>("DELETE", `/api/bullets/${id}`),
  toFolder: (id: string, folder: string) => hive.active ? hive.ownerAction<Bullet>(`/api/bullets/${id}/to-folder`, { folder }) : req<Bullet>("POST", `/api/bullets/${id}/to-folder`, { folder }),
  inline: (id: string) => hive.active ? hive.ownerAction<Bullet>(`/api/bullets/${id}/inline`) : req<Bullet>("POST", `/api/bullets/${id}/inline`),
  search: (query: string) => hive.active ? hive.search(query) : req<{ hits: Hit[] }>("GET", `/api/search?${q({ q: query })}`),
  dirs: (path: string) => req<{ dirs: string[] }>("GET", `/api/fs/dirs?${q({ path })}`),
  recent: () => req<{ recent: string[] }>("GET", "/api/fs/recent"),
  adminFolders: () => req<AdminReport>("GET", "/api/admin/folders"),
  adminMove: (id: string, folder: string) => hive.active ? hive.ownerAction<Bullet>("/api/admin/move", { id, folder }) : req<Bullet>("POST", "/api/admin/move", { id, folder }),
  adminRelink: (id: string, filePath: string) => hive.active ? hive.ownerAction<Bullet>("/api/admin/relink", { id, filePath }) : req<Bullet>("POST", "/api/admin/relink", { id, filePath }),
  adminAdopt: (filePath: string, parentId?: string) => req<Bullet>("POST", "/api/admin/adopt", { filePath, parentId }),
  adminTrash: (filePath: string) => req<{ trashed: string; detached?: string }>("POST", "/api/admin/trash", { filePath }),
  importOpml: (xml: string, parentId?: string) =>
    hive.active ? hive.importOpml(xml, parentId) : req<{ imported: number; filePath: string }>("POST", `/api/import/opml${parentId ? `?${q({ parentId })}` : ""}`, xml, "text/xml"),
};

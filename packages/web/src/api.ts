import type { AdminReport, Bullet, BulletPatch, Hit, LocatedBullet, OutlineFile } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

async function req<T>(method: string, url: string, body?: unknown, contentType = "application/json"): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "content-type": contentType } : undefined,
    body: body === undefined ? undefined : contentType === "application/json" ? JSON.stringify(body) : (body as string),
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? res.statusText);
  return data as T;
}

const q = (obj: Record<string, string | undefined>) =>
  Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
    .join("&");

export const api = {
  health: () => req<{ ok: boolean }>("GET", "/api/health"),
  root: () => req<OutlineFile>("GET", "/api/root"),
  file: (path: string) => req<OutlineFile>("GET", `/api/files?${q({ path })}`),
  getBullet: (id: string) => req<LocatedBullet>("GET", `/api/bullets/${id}`),
  addBullet: (filePath: string, parentId: string | null, index: number, text: string) =>
    req<Bullet>("POST", "/api/bullets", { filePath, parentId, index, text }),
  patchBullet: (id: string, patch: BulletPatch) => req<Bullet>("PATCH", `/api/bullets/${id}`, patch),
  moveBullet: (id: string, filePath: string, parentId: string | null, index: number) =>
    req<{ ok: true }>("POST", `/api/bullets/${id}/move`, { filePath, parentId, index }),
  deleteBullet: (id: string) => req<{ ok: true; detached: boolean }>("DELETE", `/api/bullets/${id}`),
  toFolder: (id: string, folder: string) => req<Bullet>("POST", `/api/bullets/${id}/to-folder`, { folder }),
  inline: (id: string) => req<Bullet>("POST", `/api/bullets/${id}/inline`),
  search: (query: string) => req<{ hits: Hit[] }>("GET", `/api/search?${q({ q: query })}`),
  dirs: (path: string) => req<{ dirs: string[] }>("GET", `/api/fs/dirs?${q({ path })}`),
  recent: () => req<{ recent: string[] }>("GET", "/api/fs/recent"),
  adminFolders: () => req<AdminReport>("GET", "/api/admin/folders"),
  adminMove: (id: string, folder: string) => req<Bullet>("POST", "/api/admin/move", { id, folder }),
  adminRelink: (id: string, filePath: string) => req<Bullet>("POST", "/api/admin/relink", { id, filePath }),
  adminAdopt: (filePath: string, parentId?: string) => req<Bullet>("POST", "/api/admin/adopt", { filePath, parentId }),
  adminTrash: (filePath: string) => req<{ trashed: string; detached?: string }>("POST", "/api/admin/trash", { filePath }),
  importOpml: (xml: string, parentId?: string) =>
    req<{ imported: number; filePath: string }>("POST", `/api/import/opml${parentId ? `?${q({ parentId })}` : ""}`, xml, "text/xml"),
};

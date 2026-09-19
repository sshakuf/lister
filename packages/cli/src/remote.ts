import { readServerInfo, listerDirFor } from "@lister/server";
import type { Backend, LocatedBullet } from "./backend.js";

export class RemoteError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Talks to a running lister server over HTTP. */
export class RemoteBackend implements Backend {
  readonly mode = "server" as const;
  constructor(readonly base: string) {}

  private async call<T>(method: string, url: string, body?: unknown, contentType = "application/json"): Promise<T> {
    const res = await fetch(this.base + url, {
      method,
      headers: body === undefined ? {} : { "content-type": contentType },
      body: body === undefined ? undefined : contentType === "application/json" ? JSON.stringify(body) : (body as string),
    });
    const text = await res.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: text };
    }
    if (!res.ok) throw new RemoteError(res.status, data.error ?? `HTTP ${res.status}`);
    return data as T;
  }

  root() {
    return this.call<any>("GET", "/api/root");
  }
  file(p: string) {
    return this.call<any>("GET", `/api/files?path=${encodeURIComponent(p)}`);
  }
  locate(id: string) {
    return this.call<LocatedBullet>("GET", `/api/bullets/${id}`);
  }
  addBullet(filePath: string, parentId: string | null, index: number, text: string) {
    return this.call<any>("POST", "/api/bullets", { filePath, parentId, index, text });
  }
  patchBullet(id: string, patch: any) {
    return this.call<any>("PATCH", `/api/bullets/${id}`, patch);
  }
  async deleteBullet(id: string) {
    await this.call("DELETE", `/api/bullets/${id}`);
  }
  toFolder(id: string, folder: string) {
    return this.call<any>("POST", `/api/bullets/${id}/to-folder`, { folder });
  }
  adopt(filePath: string, parentId?: string) {
    return this.call<any>("POST", "/api/admin/adopt", { filePath, parentId });
  }
  adminReport() {
    return this.call<any>("GET", "/api/admin/folders");
  }
  moveFolder(id: string, folder: string) {
    return this.call<any>("POST", "/api/admin/move", { id, folder });
  }
  relink(id: string, filePath: string) {
    return this.call<any>("POST", "/api/admin/relink", { id, filePath });
  }
  trash(filePath: string) {
    return this.call<any>("POST", "/api/admin/trash", { filePath });
  }
  async search(q: string) {
    const r = await this.call<{ hits: any[] }>("GET", `/api/search?q=${encodeURIComponent(q)}`);
    return r.hits;
  }
  importOpml(xml: string, parentId?: string) {
    const qs = parentId ? `?parentId=${encodeURIComponent(parentId)}` : "";
    return this.call<any>("POST", `/api/import/opml${qs}`, xml, "text/xml");
  }
  async close() {}
}

/** Returns the base URL of a live server, or null. */
export async function findServer(home?: string, timeoutMs = 400): Promise<string | null> {
  const info = readServerInfo(listerDirFor(home));
  if (!info) return null;
  const base = `http://127.0.0.1:${info.port}`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(base + "/api/health", { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    return base;
  } catch {
    return null;
  }
}

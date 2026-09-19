import path from "node:path";
import { Store, Admin, Search, loadConfig, type Config } from "@lister/server";
import { opmlToBullets, isFolderBullet } from "@lister/core";
import type { Backend, LocatedBullet } from "./backend.js";

/** Operates directly on files through the server's Store; used when no server is running. */
export class LocalBackend implements Backend {
  readonly mode = "local" as const;
  readonly cfg: Config;
  readonly store: Store;
  readonly admin: Admin;

  constructor(home?: string) {
    this.cfg = loadConfig(home);
    this.store = new Store(this.cfg, { watch: false, debounceMs: 0 });
    this.admin = new Admin(this.store);
  }

  root() {
    return this.store.root();
  }
  file(p: string) {
    return this.store.file(p);
  }
  async locate(id: string): Promise<LocatedBullet> {
    const loc = await this.store.locate(id);
    return { bullet: loc.bullet, filePath: loc.file.path, fileName: loc.file.name, parentId: loc.parent?.id ?? null, index: loc.index };
  }
  addBullet(filePath: string, parentId: string | null, index: number, text: string) {
    return this.store.addBullet(filePath, parentId, index, text);
  }
  patchBullet(id: string, patch: any) {
    return this.store.patchBullet(id, patch);
  }
  deleteBullet(id: string) {
    return this.store.deleteBullet(id);
  }
  toFolder(id: string, folder: string) {
    return this.store.toFolder(id, folder);
  }
  adopt(filePath: string, parentId?: string) {
    return this.admin.adopt(filePath, parentId);
  }
  adminReport() {
    return this.admin.report();
  }
  moveFolder(id: string, folder: string) {
    return this.store.moveFolder(id, folder);
  }
  relink(id: string, filePath: string) {
    return this.store.relink(id, filePath);
  }
  trash(filePath: string) {
    return this.admin.trash(filePath);
  }
  async search(q: string) {
    const s = new Search();
    const { files } = await this.admin.allFiles();
    for (const f of files) s.index(f);
    return s.query(q);
  }
  async importOpml(xml: string, parentId?: string) {
    const bullets = opmlToBullets(xml);
    let filePath = this.store.rootPath;
    let pid: string | null = null;
    if (parentId) {
      const loc = await this.store.locate(parentId);
      if (isFolderBullet(loc.bullet)) filePath = this.store.folderFile(loc.bullet);
      else {
        filePath = loc.file.path;
        pid = loc.bullet.id;
      }
    }
    await this.store.insertBullets(path.resolve(filePath), pid, bullets);
    return { imported: bullets.length, filePath };
  }
  async close() {
    await this.store.close();
  }
}

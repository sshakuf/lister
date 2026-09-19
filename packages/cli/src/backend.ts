import type { Bullet, OutlineFile, BulletPatch } from "@lister/core";
import type { AdminReport, Hit } from "@lister/server";

export interface LocatedBullet {
  bullet: Bullet;
  filePath: string;
  fileName: string;
  parentId: string | null;
  index: number;
}

/** What the CLI needs from either the running server or the local store. */
export interface Backend {
  readonly mode: "server" | "local";
  root(): Promise<OutlineFile>;
  file(path: string): Promise<OutlineFile>;
  locate(id: string): Promise<LocatedBullet>;
  addBullet(filePath: string, parentId: string | null, index: number, text: string): Promise<Bullet>;
  patchBullet(id: string, patch: BulletPatch): Promise<Bullet>;
  deleteBullet(id: string): Promise<void>;
  toFolder(id: string, folder: string): Promise<Bullet>;
  adopt(filePath: string, parentId?: string): Promise<Bullet>;
  adminReport(): Promise<AdminReport>;
  moveFolder(id: string, folder: string): Promise<Bullet>;
  relink(id: string, filePath: string): Promise<Bullet>;
  trash(filePath: string): Promise<{ trashed: string }>;
  search(q: string): Promise<Hit[]>;
  importOpml(xml: string, parentId?: string): Promise<{ imported: number; filePath: string }>;
  close(): Promise<void>;
}

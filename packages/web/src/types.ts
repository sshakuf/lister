// Mirrors packages/core/src/model.ts (kept in sync by hand; core uses node modules).
export type BulletId = string;

export interface Bullet {
  id: BulletId;
  text: string;
  note?: string;
  folder?: string;
  date?: string;
  priority?: 1 | 2 | 3;
  done?: string;
  children: Bullet[];
}

export interface OutlineFile {
  path: string;
  name: string;
  id: BulletId;
  parentId?: BulletId;
  bullets: Bullet[];
}

export interface Hit {
  id: string;
  text: string;
  filePath: string;
  fileName: string;
  path: string[];
  done?: string;
  folder?: string;
}

export interface FolderEntry {
  id: string;
  text: string;
  folder: string;
  filePath: string;
  inFile: string;
  status: "ok" | "broken";
}

export interface OrphanEntry {
  filePath: string;
  name: string;
  id?: string;
  parentId?: string;
  parentExists: boolean;
}

export interface AdminReport {
  folders: FolderEntry[];
  orphans: OrphanEntry[];
}

export interface LocatedBullet {
  bullet: Bullet;
  filePath: string;
  fileName: string;
  parentId: string | null;
  index: number;
}

export type BulletPatch = Partial<Pick<Bullet, "text" | "note" | "date" | "priority" | "done">> & {
  date?: string | null;
  priority?: 1 | 2 | 3 | null;
  done?: string | null;
  note?: string | null;
};

export function isFolderBullet(b: Bullet): boolean {
  return typeof b.folder === "string" && b.folder.length > 0;
}

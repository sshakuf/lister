import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { type Bullet, type OutlineFile, walk, isFolderBullet, parseOutline, OUTLINE_EXT, contractHome } from "@lister/core";
import type { Store } from "./store.js";
import { NotFoundError } from "./errors.js";

export interface FolderEntry {
  id: string;
  text: string;
  folder: string;
  filePath: string;
  /** file the Folder Bullet line lives in */
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

export const RECOVERED_TEXT = "Recovered";

export class Admin {
  constructor(private store: Store) {}

  /** Walk the whole tree from the root, loading every reachable Outline File. */
  async allFiles(): Promise<{ files: OutlineFile[]; folders: FolderEntry[] }> {
    const files: OutlineFile[] = [];
    const folders: FolderEntry[] = [];
    const queue: string[] = [this.store.rootPath];
    const seen = new Set<string>();
    while (queue.length) {
      const p = queue.shift()!;
      if (seen.has(p)) continue;
      seen.add(p);
      let f: OutlineFile;
      try {
        f = await this.store.file(p);
      } catch {
        continue;
      }
      files.push(f);
      walk(f.bullets, (b) => {
        if (!isFolderBullet(b)) return;
        const fp = this.store.folderFile(b);
        const ok = fs.existsSync(fp);
        folders.push({ id: b.id, text: b.text, folder: b.folder!, filePath: fp, inFile: f.path, status: ok ? "ok" : "broken" });
        if (ok) queue.push(fp);
      });
    }
    return { files, folders };
  }

  async report(): Promise<AdminReport> {
    const { files, folders } = await this.allFiles();
    const owned = new Set<string>([this.store.rootPath, ...folders.map((f) => f.filePath)]);
    const dirs = new Set<string>([path.dirname(this.store.rootPath), ...folders.map((f) => f.folder)]);
    const knownIds = new Set<string>();
    for (const f of files) {
      knownIds.add(f.id);
      walk(f.bullets, (b) => knownIds.add(b.id));
    }
    const orphans: OrphanEntry[] = [];
    for (const dir of dirs) {
      let names: string[];
      try {
        names = await fsp.readdir(dir);
      } catch {
        continue;
      }
      for (const n of names) {
        if (!n.endsWith(OUTLINE_EXT)) continue;
        const fp = path.join(dir, n);
        if (owned.has(fp) || [...owned].some((o) => sameFile(o, fp))) continue;
        let name = path.basename(n, OUTLINE_EXT);
        let id: string | undefined;
        let parentId: string | undefined;
        try {
          const { file } = parseOutline(await fsp.readFile(fp, "utf8"), fp);
          name = file.name;
          id = file.id;
          parentId = file.parentId;
        } catch {
          /* unreadable: still report */
        }
        orphans.push({ filePath: fp, name, id, parentId, parentExists: !!parentId && knownIds.has(parentId) });
      }
    }
    return { folders, orphans };
  }

  /** Adopt an Orphan: under its recorded parent if it exists, else under `parentId`, else under Recovered. */
  async adopt(filePath: string, parentId?: string): Promise<Bullet> {
    filePath = path.resolve(filePath);
    if (!fs.existsSync(filePath)) throw new NotFoundError(`no file at ${filePath}`);
    let target: string | null = parentId ?? null;
    if (!target) {
      try {
        const { file } = parseOutline(await fsp.readFile(filePath, "utf8"), filePath);
        if (file.parentId) {
          try {
            const loc = await this.store.locate(file.parentId);
            target = loc.bullet.id;
          } catch {
            const root = await this.store.root();
            if (file.parentId === root.id) target = null;
            else target = (await this.recovered()).id;
          }
        } else {
          target = (await this.recovered()).id;
        }
      } catch {
        target = (await this.recovered()).id;
      }
    }
    return this.store.adoptFile(filePath, target);
  }

  /** Find or create the "Recovered" Bullet at the end of the Root Outline. */
  async recovered(): Promise<Bullet> {
    const root = await this.store.root();
    const existing = root.bullets.find((b) => b.text === RECOVERED_TEXT && !isFolderBullet(b));
    if (existing) return existing;
    return this.store.addBullet(root.path, null, Number.MAX_SAFE_INTEGER, RECOVERED_TEXT);
  }

  /** Folder Bullets whose Outline File exists in the given directory. */
  async foldersFor(dir: string): Promise<FolderEntry[]> {
    const { folders } = await this.allFiles();
    const real = safeReal(dir);
    return folders.filter((f) => safeReal(f.folder) === real);
  }

  async trash(filePath: string): Promise<{ trashed: string; detached?: string }> {
    filePath = path.resolve(filePath);
    const { folders } = await this.allFiles();
    const owner = folders.find((f) => sameFile(f.filePath, filePath));
    if (owner) await this.store.deleteBullet(owner.id);
    const trashed = await this.store.trashFile(filePath);
    return { trashed, detached: owner?.id };
  }

  describeFolder(f: FolderEntry): string {
    return `${f.text}  ${contractHome(f.filePath)}  [${f.id}] ${f.status}`;
  }
}

function safeReal(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

function sameFile(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return fs.realpathSync.native(a) === fs.realpathSync.native(b);
  } catch {
    return false;
  }
}

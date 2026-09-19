import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import {
  type Bullet,
  type BulletId,
  type OutlineFile,
  parseOutline,
  serializeOutline,
  mergeOutlines,
  findBullet,
  insertBullet,
  removeBullet,
  updateBullet,
  moveBullet,
  walk,
  newId,
  splitMetadata,
  folderFilePath,
  expandHome,
  isFolderBullet,
  slugify,
  OUTLINE_EXT,
  type BulletPatch,
} from "@lister/core";
import { type Config, rememberFolder } from "./config.js";
import { ConflictError, NotFoundError, BadRequestError } from "./errors.js";

const WRITE_DEBOUNCE_MS = 150;

interface Entry {
  file: OutlineFile;
  /** Text as last written by us (or read from disk), the merge base. */
  lastWritten: string;
  timer: NodeJS.Timeout | null;
  pending: Promise<void> | null;
}

export interface StoreOptions {
  onChange?: (filePath: string) => void;
  watch?: boolean;
  debounceMs?: number;
}

export interface Located {
  file: OutlineFile;
  bullet: Bullet;
  parent: Bullet | null;
  index: number;
}

/** In-memory model of loaded Outline Files with persistence, watching, and merge. */
export class Store {
  private entries = new Map<string, Entry>();
  private watcher: FSWatcher | null = null;
  private readonly debounceMs: number;
  readonly cfg: Config;
  private onChange: (p: string) => void;

  constructor(cfg: Config, opts: StoreOptions = {}) {
    this.cfg = cfg;
    this.onChange = opts.onChange ?? (() => {});
    this.debounceMs = opts.debounceMs ?? WRITE_DEBOUNCE_MS;
    if (opts.watch !== false) {
      this.watcher = chokidar.watch([], { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 } });
      this.watcher.on("change", (p) => void this.externalChange(path.resolve(p)));
      this.watcher.on("unlink", (p) => this.onChange(path.resolve(p)));
    }
  }

  // ---------- loading ----------

  get rootPath(): string {
    return this.cfg.rootFile;
  }

  async root(): Promise<OutlineFile> {
    return this.file(this.cfg.rootFile);
  }

  isLoaded(filePath: string): boolean {
    return this.entries.has(filePath);
  }

  loadedFiles(): OutlineFile[] {
    return [...this.entries.values()].map((e) => e.file);
  }

  async file(filePath: string): Promise<OutlineFile> {
    filePath = path.resolve(filePath);
    const existing = this.entries.get(filePath);
    if (existing) return existing.file;
    let text: string;
    if (fs.existsSync(filePath)) {
      text = await fsp.readFile(filePath, "utf8");
    } else if (filePath === this.cfg.rootFile) {
      text = "# Home\n";
    } else {
      throw new NotFoundError(`outline file not found: ${filePath}`);
    }
    const { file, healed } = parseOutline(text, filePath, { knownIds: this.knownIds() });
    const entry: Entry = { file, lastWritten: text, timer: null, pending: null };
    this.entries.set(filePath, entry);
    this.watcher?.add(filePath);
    if (healed || !fs.existsSync(filePath)) this.scheduleWrite(filePath);
    return file;
  }

  private knownIds(): Set<string> {
    const s = new Set<string>();
    for (const e of this.entries.values()) {
      s.add(e.file.id);
      walk(e.file.bullets, (b) => s.add(b.id));
    }
    return s;
  }

  /** Resolve the Outline File path for a Folder Bullet. */
  folderFile(b: Bullet): string {
    if (!b.folder) throw new BadRequestError(`${b.id} is not a Folder Bullet`);
    return folderFilePath(b.folder, b.text);
  }

  /** Find a bullet in loaded files, then by walking unloaded Folder Bullets from the root. */
  async locate(id: BulletId): Promise<Located> {
    const found = this.locateLoaded(id);
    if (found) return found;
    // walk from root, loading folder files breadth-first
    const queue: string[] = [this.cfg.rootFile];
    const seen = new Set<string>();
    while (queue.length) {
      const p = queue.shift()!;
      if (seen.has(p)) continue;
      seen.add(p);
      let f: OutlineFile;
      try {
        f = await this.file(p);
      } catch {
        continue;
      }
      const loc = findBullet(f.bullets, id);
      if (loc) return { file: f, ...loc };
      walk(f.bullets, (b) => {
        if (isFolderBullet(b)) {
          const fp = this.folderFile(b);
          if (fs.existsSync(fp)) queue.push(fp);
        }
      });
    }
    throw new NotFoundError(`bullet ${id} not found`);
  }

  private locateLoaded(id: BulletId): Located | null {
    for (const e of this.entries.values()) {
      const loc = findBullet(e.file.bullets, id);
      if (loc) return { file: e.file, ...loc };
    }
    return null;
  }

  /** The file whose header id is `id`, if it is loaded or derivable. */
  async fileForFolderBullet(b: Bullet): Promise<OutlineFile> {
    return this.file(this.folderFile(b));
  }

  // ---------- mutations ----------

  private replace(filePath: string, bullets: Bullet[], patch: Partial<OutlineFile> = {}): OutlineFile {
    const e = this.entries.get(filePath);
    if (!e) throw new NotFoundError(`file not loaded: ${filePath}`);
    e.file = { ...e.file, ...patch, bullets };
    this.scheduleWrite(filePath);
    return e.file;
  }

  /** Add a Bullet. `text` may carry metadata annotations, which are extracted. */
  async addBullet(filePath: string, parentId: BulletId | null, index: number, text: string): Promise<Bullet> {
    const f = await this.file(filePath);
    const b = this.bulletFromRaw(text);
    if (parentId !== null) {
      const parentLoc = findBullet(f.bullets, parentId);
      if (!parentLoc) throw new NotFoundError(`parent ${parentId} not found in ${filePath}`);
      if (isFolderBullet(parentLoc.bullet)) throw new BadRequestError("cannot add a child to a Folder Bullet in this file; add to its Outline File instead");
    }
    this.replace(f.path, insertBullet(f.bullets, parentId, index, b));
    return b;
  }

  bulletFromRaw(raw: string): Bullet {
    const { text, meta } = splitMetadata(raw);
    const b: Bullet = { id: newId(), text, children: [] };
    if (typeof meta.folder === "string" && meta.folder) b.folder = expandHome(meta.folder);
    if (typeof meta.date === "string") b.date = meta.date;
    if (typeof meta.priority === "string" && ["1", "2", "3"].includes(meta.priority)) b.priority = Number(meta.priority) as 1 | 2 | 3;
    if (meta.done !== undefined) b.done = meta.done === true ? "" : meta.done;
    return b;
  }

  async patchBullet(id: BulletId, patch: BulletPatch): Promise<Bullet> {
    const loc = await this.locate(id);
    const b = loc.bullet;
    if ("folder" in patch) throw new BadRequestError("use to-folder / inline / admin move to change folder");
    if (isFolderBullet(b) && typeof patch.text === "string" && patch.text !== b.text) {
      await this.renameFolderFile(b, patch.text);
    }
    const bullets = updateBullet(loc.file.bullets, id, patch);
    this.replace(loc.file.path, bullets);
    return findBullet(bullets, id)!.bullet;
  }

  private async renameFolderFile(b: Bullet, newText: string): Promise<void> {
    const oldPath = this.folderFile(b);
    const newPath = folderFilePath(b.folder!, newText);
    if (oldPath === newPath) {
      const child = this.entries.get(oldPath);
      if (child) this.replace(oldPath, child.file.bullets, { name: newText });
      return;
    }
    if (existsOther(newPath, oldPath)) throw new ConflictError(`an Outline File already exists at ${newPath}`);
    if (fs.existsSync(oldPath)) {
      await this.flushFile(oldPath);
      await fsp.rename(oldPath, newPath);
    }
    const child = this.entries.get(oldPath);
    if (child) {
      this.entries.delete(oldPath);
      this.watcher?.unwatch(oldPath);
      child.file = { ...child.file, path: newPath, name: newText };
      this.entries.set(newPath, child);
      this.watcher?.add(newPath);
      this.scheduleWrite(newPath);
    } else if (fs.existsSync(newPath)) {
      const f = await this.file(newPath);
      this.replace(newPath, f.bullets, { name: newText });
    }
  }

  async moveBulletTo(id: BulletId, filePath: string, parentId: BulletId | null, index: number): Promise<void> {
    const loc = await this.locate(id);
    const target = await this.file(filePath);
    if (loc.file.path === target.path) {
      this.replace(target.path, moveBullet(target.bullets, id, parentId, index));
    } else {
      if (parentId !== null && !findBullet(target.bullets, parentId)) throw new NotFoundError(`parent ${parentId} not found in target`);
      const { bullets: srcRest, removed } = removeBullet(loc.file.bullets, id);
      this.replace(loc.file.path, srcRest);
      this.replace(target.path, insertBullet(target.bullets, parentId, index, removed!));
    }
    // keep [parent:] header of moved Folder Bullets accurate
    const moved = (await this.locate(id));
    walk([moved.bullet], (b) => {
      if (isFolderBullet(b)) void this.updateChildHeaderParent(b, moved);
    });
  }

  private async updateChildHeaderParent(folderBullet: Bullet, loc: Located): Promise<void> {
    const fp = this.folderFile(folderBullet);
    if (!fs.existsSync(fp)) return;
    const child = await this.file(fp);
    const parentLoc = this.locateLoaded(folderBullet.id) ?? loc;
    const newParent = parentLoc.parent ? parentLoc.parent.id : parentLoc.file.id;
    if (child.parentId !== newParent) this.replace(fp, child.bullets, { parentId: newParent });
  }

  /** Delete a Bullet. Folder Bullets are detached only: their Outline File stays on disk. */
  async deleteBullet(id: BulletId): Promise<void> {
    const loc = await this.locate(id);
    const { bullets } = removeBullet(loc.file.bullets, id);
    this.replace(loc.file.path, bullets);
    if (isFolderBullet(loc.bullet)) {
      const fp = this.folderFile(loc.bullet);
      await this.flushFile(fp);
      this.entries.delete(fp);
      this.watcher?.unwatch(fp);
    }
  }

  /** Convert an ordinary Bullet into a Folder Bullet, moving its children into a new Outline File. */
  async toFolder(id: BulletId, folder: string): Promise<Bullet> {
    const loc = await this.locate(id);
    if (isFolderBullet(loc.bullet)) throw new BadRequestError(`${id} is already a Folder Bullet`);
    const dir = expandHome(folder);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new BadRequestError(`not a directory: ${folder}`);
    const target = folderFilePath(dir, loc.bullet.text);
    if (fs.existsSync(target) || this.entries.has(target)) throw new ConflictError(`an Outline File already exists at ${target}`);
    const parentId = loc.parent ? loc.parent.id : loc.file.id;
    const child: OutlineFile = { path: target, name: loc.bullet.text, id: loc.bullet.id, parentId, bullets: loc.bullet.children };
    const text = serializeOutline(child);
    await fsp.writeFile(target, text);
    this.entries.set(target, { file: child, lastWritten: text, timer: null, pending: null });
    this.watcher?.add(target);
    const updated: Bullet = { ...loc.bullet, folder: dir, children: [] };
    const bullets = updateBullet(loc.file.bullets, id, { folder: dir });
    const withoutChildren = replaceChildren(bullets, id, []);
    this.replace(loc.file.path, withoutChildren);
    rememberFolder(this.cfg, dir);
    return updated;
  }

  /** Reverse of toFolder: pull the Outline File's bullets back under the Bullet, trash the file. */
  async inline(id: BulletId): Promise<Bullet> {
    const loc = await this.locate(id);
    if (!isFolderBullet(loc.bullet)) throw new BadRequestError(`${id} is not a Folder Bullet`);
    const fp = this.folderFile(loc.bullet);
    const child = await this.file(fp);
    await this.flushFile(fp);
    let bullets = updateBullet(loc.file.bullets, id, { folder: undefined });
    bullets = replaceChildren(bullets, id, child.bullets);
    this.replace(loc.file.path, bullets);
    this.entries.delete(fp);
    this.watcher?.unwatch(fp);
    await this.trashFile(fp);
    return findBullet(bullets, id)!.bullet;
  }

  /** Register an existing Outline File on disk as a Folder Bullet under `parentId` (null = root end). */
  async adoptFile(filePath: string, parentId: BulletId | null): Promise<Bullet> {
    filePath = path.resolve(filePath);
    if (!fs.existsSync(filePath)) throw new NotFoundError(`no file at ${filePath}`);
    const child = await this.file(filePath);
    const dir = path.dirname(filePath);
    let targetFile: OutlineFile;
    let parentBulletId: BulletId | null;
    if (parentId === null) {
      targetFile = await this.root();
      parentBulletId = null;
    } else {
      const ploc = await this.locate(parentId);
      if (isFolderBullet(ploc.bullet)) {
        targetFile = await this.fileForFolderBullet(ploc.bullet);
        parentBulletId = null;
      } else {
        targetFile = ploc.file;
        parentBulletId = parentId;
      }
    }
    // file name must match slug of header name; rename if needed
    const expected = folderFilePath(dir, child.name);
    if (expected !== filePath) {
      if (existsOther(expected, filePath)) throw new ConflictError(`cannot adopt: ${expected} already exists`);
      await this.flushFile(filePath);
      await fsp.rename(filePath, expected);
      const e = this.entries.get(filePath)!;
      this.entries.delete(filePath);
      this.watcher?.unwatch(filePath);
      e.file = { ...e.file, path: expected };
      this.entries.set(expected, e);
      this.watcher?.add(expected);
      filePath = expected;
    }
    // ensure header id is unique among bullets
    let fid = child.id;
    if (this.locateLoaded(fid)) {
      fid = newId();
      this.replace(filePath, child.bullets, { id: fid });
    }
    const fb: Bullet = { id: fid, text: child.name, folder: dir, children: [] };
    this.replace(targetFile.path, insertBullet(targetFile.bullets, parentBulletId, Number.MAX_SAFE_INTEGER, fb));
    const headerParent = parentBulletId ?? targetFile.id;
    if (child.parentId !== headerParent) this.replace(filePath, this.entries.get(filePath)!.file.bullets, { parentId: headerParent });
    return fb;
  }

  async trashFile(filePath: string): Promise<string> {
    const trashDir = path.join(this.cfg.listerDir, "trash");
    await fsp.mkdir(trashDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = path.join(trashDir, `${stamp}-${path.basename(filePath)}`);
    if (fs.existsSync(filePath)) await fsp.rename(filePath, dest);
    return dest;
  }

  /** Move a Folder Bullet's Outline File to another directory. */
  async moveFolder(id: BulletId, folder: string): Promise<Bullet> {
    const loc = await this.locate(id);
    if (!isFolderBullet(loc.bullet)) throw new BadRequestError(`${id} is not a Folder Bullet`);
    const dir = expandHome(folder);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new BadRequestError(`not a directory: ${folder}`);
    const oldPath = this.folderFile(loc.bullet);
    const newPath = folderFilePath(dir, loc.bullet.text);
    if (oldPath !== newPath) {
      if (existsOther(newPath, oldPath)) throw new ConflictError(`an Outline File already exists at ${newPath}`);
      if (fs.existsSync(oldPath)) {
        await this.flushFile(oldPath);
        await fsp.rename(oldPath, newPath);
      }
      const e = this.entries.get(oldPath);
      if (e) {
        this.entries.delete(oldPath);
        this.watcher?.unwatch(oldPath);
        e.file = { ...e.file, path: newPath };
        this.entries.set(newPath, e);
        this.watcher?.add(newPath);
      }
    }
    const bullets = updateBullet(loc.file.bullets, id, { folder: dir });
    this.replace(loc.file.path, bullets);
    rememberFolder(this.cfg, dir);
    return findBullet(bullets, id)!.bullet;
  }

  /** Point a Broken Folder Bullet at an existing file; the file is renamed to match the Bullet's slug. */
  async relink(id: BulletId, filePath: string): Promise<Bullet> {
    const loc = await this.locate(id);
    if (!isFolderBullet(loc.bullet)) throw new BadRequestError(`${id} is not a Folder Bullet`);
    filePath = path.resolve(filePath);
    if (!fs.existsSync(filePath)) throw new NotFoundError(`no file at ${filePath}`);
    const dir = path.dirname(filePath);
    const expected = folderFilePath(dir, loc.bullet.text);
    if (expected !== filePath) {
      if (existsOther(expected, filePath)) throw new ConflictError(`${expected} already exists`);
      await fsp.rename(filePath, expected);
    }
    const bullets = updateBullet(loc.file.bullets, id, { folder: dir });
    this.replace(loc.file.path, bullets);
    const child = await this.file(expected);
    const headerParent = loc.parent ? loc.parent.id : loc.file.id;
    this.replace(expected, child.bullets, { id: loc.bullet.id, name: loc.bullet.text, parentId: headerParent });
    return findBullet(bullets, id)!.bullet;
  }

  async insertBullets(filePath: string, parentId: BulletId | null, bullets: Bullet[]): Promise<void> {
    const f = await this.file(filePath);
    let next = f.bullets;
    for (const b of bullets) next = insertBullet(next, parentId, Number.MAX_SAFE_INTEGER, b);
    this.replace(f.path, next);
  }

  // ---------- persistence ----------

  private scheduleWrite(filePath: string): void {
    const e = this.entries.get(filePath);
    if (!e) return;
    if (e.timer) clearTimeout(e.timer);
    e.timer = setTimeout(() => {
      e.timer = null;
      e.pending = this.writeNow(filePath).finally(() => {
        e.pending = null;
      });
    }, this.debounceMs);
  }

  private async writeNow(filePath: string): Promise<void> {
    const e = this.entries.get(filePath);
    if (!e) return;
    const text = serializeOutline(e.file);
    if (text === e.lastWritten && fs.existsSync(filePath)) return;
    e.lastWritten = text;
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, text);
    this.watcher?.add(filePath); // idempotent; needed when the file did not exist at load time
    this.onChange(filePath);
  }

  async flushFile(filePath: string): Promise<void> {
    const e = this.entries.get(filePath);
    if (!e) return;
    if (e.timer) {
      clearTimeout(e.timer);
      e.timer = null;
      await this.writeNow(filePath);
    }
    if (e.pending) await e.pending;
  }

  async flush(): Promise<void> {
    for (const p of [...this.entries.keys()]) await this.flushFile(p);
  }

  /** Disk changed under us: three-way merge and re-persist if needed. */
  async externalChange(filePath: string): Promise<void> {
    const e = this.entries.get(filePath);
    if (!e) return;
    let onDisk: string;
    try {
      onDisk = await fsp.readFile(filePath, "utf8");
    } catch {
      return;
    }
    if (onDisk === e.lastWritten) return;
    const base = parseOutline(e.lastWritten, filePath).file;
    const theirs = parseOutline(onDisk, filePath, { knownIds: this.knownIdsExcept(filePath) }).file;
    const merged = mergeOutlines(base, e.file, theirs);
    e.file = merged;
    e.lastWritten = onDisk;
    const canonical = serializeOutline(merged);
    if (canonical !== onDisk) this.scheduleWrite(filePath);
    this.onChange(filePath);
  }

  private knownIdsExcept(filePath: string): Set<string> {
    const s = new Set<string>();
    for (const [p, e] of this.entries) {
      if (p === filePath) continue;
      s.add(e.file.id);
      walk(e.file.bullets, (b) => s.add(b.id));
    }
    return s;
  }

  async close(): Promise<void> {
    await this.flush();
    await this.watcher?.close();
  }
}

/** True when `target` exists on disk and is not the same file as `current` (case-insensitive filesystems). */
function existsOther(target: string, current?: string): boolean {
  if (!fs.existsSync(target)) return false;
  if (!current || !fs.existsSync(current)) return true;
  try {
    return fs.realpathSync.native(target) !== fs.realpathSync.native(current);
  } catch {
    return true;
  }
}

function replaceChildren(bullets: Bullet[], id: BulletId, children: Bullet[]): Bullet[] {
  return bullets.map((b) => (b.id === id ? { ...b, children } : { ...b, children: replaceChildren(b.children, id, children) }));
}

export { slugify, OUTLINE_EXT };

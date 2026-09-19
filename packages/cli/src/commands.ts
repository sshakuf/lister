import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { renderPlain, OUTLINE_EXT, parseOutline, serializeOutline, newId, slugify, contractHome, isFolderBullet, type OutlineFile, type Bullet } from "@lister/core";
import type { Backend } from "./backend.js";

export interface Ctx {
  backend: Backend;
  cwd: string;
  out: (s: string) => void;
}

export class CliError extends Error {}

/** `*.lister` files in a directory (non-recursive). */
export async function outlineFilesIn(dir: string, recursive = false): Promise<string[]> {
  const out: string[] = [];
  const rec = async (d: string, depth: number) => {
    let ents: import("node:fs").Dirent[];
    try {
      ents = await fsp.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isFile() && e.name.endsWith(OUTLINE_EXT)) out.push(p);
      else if (recursive && e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules" && depth < 8) await rec(p, depth + 1);
    }
  };
  await rec(dir, 0);
  return out.sort();
}

/** Walk up from cwd looking for the nearest directory holding Outline Files. */
export async function nearestOutlineDir(cwd: string): Promise<string | null> {
  let d = path.dirname(cwd);
  while (true) {
    if ((await outlineFilesIn(d)).length) return d;
    const parent = path.dirname(d);
    if (parent === d) return null;
    d = parent;
  }
}

function printFile(ctx: Ctx, f: OutlineFile, opts: { ids: boolean }) {
  ctx.out(`## ${f.name}  (${contractHome(f.path)})`);
  ctx.out(f.bullets.length ? renderPlain(f.bullets, { ids: opts.ids }) : "  (empty)");
  ctx.out("");
}

export async function cmdList(ctx: Ctx, opts: { all?: boolean; recursive?: boolean; ids?: boolean }): Promise<void> {
  const ids = opts.ids !== false;
  if (opts.all) {
    const rep = await ctx.backend.adminReport();
    const root = await ctx.backend.root();
    printFile(ctx, root, { ids });
    for (const f of rep.folders) {
      if (f.status !== "ok") {
        ctx.out(`## ${f.text}  (${contractHome(f.filePath)})  BROKEN: file missing`);
        continue;
      }
      printFile(ctx, await ctx.backend.file(f.filePath), { ids });
    }
    return;
  }
  const files = await outlineFilesIn(ctx.cwd, !!opts.recursive);
  if (!files.length) {
    const near = await nearestOutlineDir(ctx.cwd);
    ctx.out(`No Outline Files in ${contractHome(ctx.cwd)}.`);
    if (near) ctx.out(`Nearest: ${contractHome(near)} (run with --recursive from there, or cd into it)`);
    else ctx.out(`Create one with: lister new "<Name>"`);
    return;
  }
  for (const p of files) printFile(ctx, await ctx.backend.file(p), { ids });
}

/** Resolve which Outline File a write targets. */
export async function resolveFile(ctx: Ctx, opts: { file?: string; under?: string }): Promise<{ filePath: string; parentId: string | null }> {
  if (opts.under) {
    const loc = await ctx.backend.locate(opts.under);
    if (isFolderBullet(loc.bullet)) {
      const fp = path.join(loc.bullet.folder!, slugify(loc.bullet.text) + OUTLINE_EXT);
      return { filePath: fp, parentId: null };
    }
    return { filePath: loc.filePath, parentId: loc.bullet.id };
  }
  if (opts.file) {
    const fp = path.resolve(ctx.cwd, opts.file);
    if (!fs.existsSync(fp)) throw new CliError(`no such file: ${fp}`);
    return { filePath: fp, parentId: null };
  }
  const files = await outlineFilesIn(ctx.cwd);
  if (files.length === 1) return { filePath: files[0], parentId: null };
  if (files.length === 0) throw new CliError(`no Outline File in ${contractHome(ctx.cwd)}; use --file, --under, or \`lister new\``);
  throw new CliError(`several Outline Files here; pick one with --file:\n  ${files.map((f) => path.basename(f)).join("\n  ")}`);
}

export async function cmdAdd(ctx: Ctx, text: string, opts: { file?: string; under?: string; index?: number }): Promise<Bullet> {
  const { filePath, parentId } = await resolveFile(ctx, opts);
  const b = await ctx.backend.addBullet(filePath, parentId, opts.index ?? Number.MAX_SAFE_INTEGER, text);
  ctx.out(`added [${b.id}] ${b.text}  → ${contractHome(filePath)}`);
  return b;
}

export async function cmdDone(ctx: Ctx, id: string, undo = false): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const b = await ctx.backend.patchBullet(id, { done: undo ? undefined : today });
  ctx.out(`${undo ? "reopened" : "done"} [${b.id}] ${b.text}`);
}

export async function cmdEdit(ctx: Ctx, id: string, text: string): Promise<void> {
  const b = await ctx.backend.patchBullet(id, { text });
  ctx.out(`edited [${b.id}] ${b.text}`);
}

export async function cmdRm(ctx: Ctx, id: string): Promise<void> {
  const loc = await ctx.backend.locate(id);
  await ctx.backend.deleteBullet(id);
  ctx.out(isFolderBullet(loc.bullet) ? `detached Folder Bullet [${id}] (file kept on disk)` : `removed [${id}] ${loc.bullet.text}`);
}

export async function cmdShow(ctx: Ctx, id: string): Promise<void> {
  const loc = await ctx.backend.locate(id);
  ctx.out(`${contractHome(loc.filePath)}  parent=${loc.parentId ?? "(file root)"} index=${loc.index}`);
  ctx.out(renderPlain([loc.bullet]));
}

/** Create a new Outline File in cwd and register its Folder Bullet. */
export async function cmdNew(ctx: Ctx, name: string, opts: { dir?: string; under?: string }): Promise<Bullet> {
  const dir = path.resolve(ctx.cwd, opts.dir ?? ".");
  const filePath = path.join(dir, slugify(name) + OUTLINE_EXT);
  if (fs.existsSync(filePath)) throw new CliError(`${contractHome(filePath)} already exists; adopt it with: lister admin adopt ${path.basename(filePath)}`);
  const file: OutlineFile = { path: filePath, name, id: newId(), bullets: [] };
  await fsp.writeFile(filePath, serializeOutline(file));
  let parentId: string | undefined = opts.under;
  if (!parentId) {
    // sibling of an existing Folder Bullet pointing at this directory
    const rep = await ctx.backend.adminReport();
    const real = safeReal(dir);
    const sib = rep.folders.find((f) => f.status === "ok" && safeReal(f.folder) === real);
    if (sib) {
      const loc = await ctx.backend.locate(sib.id);
      // same parent as the sibling: its parent Bullet, or the id of the file it sits in (root id = top level)
      parentId = loc.parentId ?? (await ctx.backend.file(loc.filePath)).id;
    }
  }
  const b = await ctx.backend.adopt(filePath, parentId);
  ctx.out(`created ${contractHome(filePath)} and registered Folder Bullet [${b.id}] ${b.text}`);
  return b;
}

export async function cmdSearch(ctx: Ctx, q: string): Promise<void> {
  const hits = await ctx.backend.search(q);
  if (!hits.length) return ctx.out("no matches");
  for (const h of hits) {
    const trail = h.path.length ? h.path.join(" › ") + " › " : "";
    ctx.out(`[${h.id}] ${h.fileName}: ${trail}${h.text}${h.done !== undefined ? "  (done)" : ""}`);
  }
}

export async function cmdAdminFolders(ctx: Ctx): Promise<void> {
  const rep = await ctx.backend.adminReport();
  if (!rep.folders.length) ctx.out("no Folder Bullets yet");
  for (const f of rep.folders) ctx.out(`${f.status === "ok" ? "ok     " : "BROKEN "} [${f.id}] ${f.text}  →  ${contractHome(f.filePath)}`);
  if (rep.orphans.length) {
    ctx.out("");
    ctx.out(`orphans (${rep.orphans.length}):`);
    for (const o of rep.orphans) ctx.out(`  ${contractHome(o.filePath)}  "${o.name}"${o.parentId ? `  parent ${o.parentId}${o.parentExists ? "" : " (missing)"}` : ""}`);
  }
}

export async function cmdAdminOrphans(ctx: Ctx): Promise<void> {
  const rep = await ctx.backend.adminReport();
  if (!rep.orphans.length) return ctx.out("no orphans");
  for (const o of rep.orphans) ctx.out(`${contractHome(o.filePath)}  "${o.name}"${o.parentId ? `  parent ${o.parentId}${o.parentExists ? "" : " (missing)"}` : ""}`);
}

export async function cmdAdminAdopt(ctx: Ctx, file: string, opts: { under?: string }): Promise<void> {
  const b = await ctx.backend.adopt(path.resolve(ctx.cwd, file), opts.under);
  ctx.out(`adopted as Folder Bullet [${b.id}] ${b.text}`);
}

export async function cmdAdminMove(ctx: Ctx, id: string, dir: string): Promise<void> {
  const b = await ctx.backend.moveFolder(id, path.resolve(ctx.cwd, dir));
  ctx.out(`moved [${b.id}] ${b.text} → ${contractHome(b.folder!)}`);
}

export async function cmdAdminRelink(ctx: Ctx, id: string, file: string): Promise<void> {
  const b = await ctx.backend.relink(id, path.resolve(ctx.cwd, file));
  ctx.out(`relinked [${b.id}] ${b.text} → ${contractHome(b.folder!)}`);
}

export async function cmdAdminTrash(ctx: Ctx, file: string): Promise<void> {
  const r = await ctx.backend.trash(path.resolve(ctx.cwd, file));
  ctx.out(`moved to trash: ${contractHome(r.trashed)}`);
}

export async function cmdImport(ctx: Ctx, file: string, opts: { under?: string }): Promise<void> {
  const xml = await fsp.readFile(path.resolve(ctx.cwd, file), "utf8");
  const r = await ctx.backend.importOpml(xml, opts.under);
  ctx.out(`imported ${r.imported} top-level bullet(s) into ${contractHome(r.filePath)}`);
}

function safeReal(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

export { parseOutline };

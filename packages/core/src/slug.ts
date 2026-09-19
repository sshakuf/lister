import os from "node:os";
import path from "node:path";

export const OUTLINE_EXT = ".lister";
const MAX_SLUG = 60;

/** Filename-safe slug derived from Folder Bullet text. */
export function slugify(text: string): string {
  const base = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const cut = base.slice(0, MAX_SLUG).replace(/-+$/g, "");
  return cut.length ? cut : "untitled";
}

export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return path.resolve(p);
}

export function contractHome(p: string): string {
  const home = os.homedir();
  if (p === home) return "~";
  if (p.startsWith(home + path.sep)) return "~" + p.slice(home.length);
  return p;
}

/** Absolute path of the Outline File for a Folder Bullet with `text` pointing at `folder`. */
export function folderFilePath(folder: string, text: string): string {
  return path.join(expandHome(folder), slugify(text) + OUTLINE_EXT);
}

export function isOutlineFile(p: string): boolean {
  return p.endsWith(OUTLINE_EXT);
}

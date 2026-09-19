import path from "node:path";
import { newId, isValidId } from "./ids.js";
import { splitMetadata, joinMetadata, type Metadata } from "./annotations.js";
import { expandHome, contractHome, OUTLINE_EXT } from "./slug.js";
import type { Bullet, OutlineFile } from "./model.js";

const INDENT = "  ";
const BULLET_RE = /^( *)- ?(.*)$/;
const HEADER_RE = /^# ?(.*)$/;

export interface ParseResult {
  file: OutlineFile;
  /** True when the file needed normalising (missing ids/header, non-canonical form). */
  healed: boolean;
}

/** Parse an Outline File. Assigns ids to id-less Bullets. */
export function parseOutline(text: string, filePath: string, opts: { knownIds?: Set<string> } = {}): ParseResult {
  const lines = text.split(/\r?\n/);
  let healed = false;
  const seen = opts.knownIds ?? new Set<string>();

  // header
  let name = path.basename(filePath, OUTLINE_EXT);
  let fileId: string | undefined;
  let parentId: string | undefined;
  let start = 0;
  while (start < lines.length && lines[start].trim() === "") start++;
  const headerMatch = start < lines.length ? lines[start].match(HEADER_RE) : null;
  if (headerMatch) {
    // [parent:] is header-only and not a metadata kind; extract it first
    let headerText = headerMatch[1];
    const pm = headerText.match(/\s*\[parent:([0-9a-z]{8})\]/);
    if (pm) {
      parentId = pm[1];
      headerText = headerText.replace(pm[0], "");
    }
    const { text: hText, meta } = splitMetadata(headerText);
    const idFromHeader = typeof meta.id === "string" ? meta.id : undefined;
    name = hText || name;
    if (isValidId(idFromHeader)) fileId = idFromHeader;
    start++;
  } else {
    healed = true;
  }
  if (!fileId) {
    fileId = newId();
    healed = true;
  }
  seen.add(fileId);

  const root: Bullet = { id: fileId, text: "", children: [] };
  const stack: { bullet: Bullet; depth: number }[] = [{ bullet: root, depth: -1 }];
  let last: { bullet: Bullet; depth: number } | null = null;

  for (let i = start; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "") continue;
    const m = raw.match(BULLET_RE);
    const leading = m ? m[1].length : raw.length - raw.trimStart().length;
    const isBullet = !!m && raw.trimStart().startsWith("-");
    if (!isBullet) {
      // continuation note line: attach to last bullet
      if (last) {
        const noteText = raw.trimStart();
        last.bullet.note = last.bullet.note ? last.bullet.note + "\n" + noteText : noteText;
        // canonical note indent is (depth+1)*2
        if (leading !== (last.depth + 1) * INDENT.length) healed = true;
      } else {
        healed = true; // stray text before any bullet: drop it
      }
      continue;
    }
    let depth = Math.floor(leading / INDENT.length);
    if (leading % INDENT.length !== 0) healed = true;
    while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
    const parent = stack[stack.length - 1];
    if (depth > parent.depth + 1) {
      depth = parent.depth + 1;
      healed = true;
    }
    const { bullet, healed: bh } = lineToBullet(m![2], seen);
    if (bh) healed = true;
    parent.bullet.children.push(bullet);
    const entry = { bullet, depth };
    stack.push(entry);
    last = entry;
  }

  const file: OutlineFile = { path: filePath, name, id: fileId, parentId, bullets: root.children };
  if (!healed && serializeOutline(file) !== normaliseNewlines(text)) healed = true;
  return { file, healed };
}

function normaliseNewlines(t: string): string {
  return t.replace(/\r\n/g, "\n");
}

function lineToBullet(content: string, seen: Set<string>): { bullet: Bullet; healed: boolean } {
  const { text, meta } = splitMetadata(content);
  let healed = false;
  let id = typeof meta.id === "string" ? meta.id : undefined;
  if (!isValidId(id) || seen.has(id)) {
    id = newId();
    healed = true;
  }
  seen.add(id);
  const bullet: Bullet = { id, text, children: [] };
  if (typeof meta.folder === "string" && meta.folder) bullet.folder = expandHome(meta.folder);
  if (typeof meta.date === "string") bullet.date = meta.date;
  if (typeof meta.priority === "string") {
    const p = Number(meta.priority);
    if (p === 1 || p === 2 || p === 3) bullet.priority = p;
    else healed = true;
  }
  if (meta.done !== undefined) bullet.done = meta.done === true ? "" : meta.done;
  return { bullet, healed };
}

export function bulletMetadata(b: Bullet): Metadata {
  const meta: Metadata = { id: b.id };
  if (b.folder) meta.folder = contractHome(b.folder);
  if (b.date) meta.date = b.date;
  if (b.priority) meta.priority = String(b.priority);
  if (b.done !== undefined) meta.done = b.done === "" ? true : b.done;
  return meta;
}

export function serializeBulletLine(b: Bullet): string {
  return joinMetadata(b.text, bulletMetadata(b));
}

export function serializeOutline(file: OutlineFile): string {
  const out: string[] = [];
  const header = ["#", file.name.trim() || "Untitled", `[id:${file.id}]`];
  if (file.parentId) header.push(`[parent:${file.parentId}]`);
  out.push(header.join(" "));
  const walk = (bullets: Bullet[], depth: number) => {
    for (const b of bullets) {
      out.push(INDENT.repeat(depth) + "- " + serializeBulletLine(b));
      if (b.note) {
        for (const nl of b.note.split("\n")) out.push(INDENT.repeat(depth + 1) + nl);
      }
      walk(b.children, depth + 1);
    }
  };
  walk(file.bullets, 0);
  return out.join("\n") + "\n";
}

/** Render a file's bullets as plain indented text for terminals (no header). */
export function renderPlain(bullets: Bullet[], opts: { ids?: boolean } = {}): string {
  const out: string[] = [];
  const walk = (bs: Bullet[], depth: number) => {
    for (const b of bs) {
      const flags: string[] = [];
      if (b.done !== undefined) flags.push("done");
      if (b.folder) flags.push("folder:" + contractHome(b.folder));
      if (b.date) flags.push("date:" + b.date);
      if (b.priority) flags.push("!" + b.priority);
      let line = INDENT.repeat(depth) + "- " + b.text;
      if (flags.length) line += "  (" + flags.join(", ") + ")";
      if (opts.ids !== false) line += `  [${b.id}]`;
      out.push(line);
      if (b.note) for (const nl of b.note.split("\n")) out.push(INDENT.repeat(depth + 1) + nl);
      walk(b.children, depth + 1);
    }
  };
  walk(bullets, 0);
  return out.join("\n");
}

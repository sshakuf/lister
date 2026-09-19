// Client-side copies of pure helpers from @lister/core (annotations, slug, dates).
import type { Bullet } from "./types";

export const OUTLINE_EXT = ".lister";

export const STYLE_KINDS = ["bold", "italic", "highlight", "code", "red", "green", "blue", "yellow", "purple", "grey"] as const;
const STYLE_SET: ReadonlySet<string> = new Set(STYLE_KINDS);

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "annotation"; kinds: string[]; value: string | null; raw: string };

const KIND_RE = /^[a-z][a-z0-9_-]*$/;

export function parseSegments(line: string): Segment[] {
  const out: Segment[] = [];
  let text = "";
  let i = 0;
  const flush = () => {
    if (text) out.push({ kind: "text", text });
    text = "";
  };
  while (i < line.length) {
    const ch = line[i];
    if (ch === "\\" && i + 1 < line.length && (line[i + 1] === "[" || line[i + 1] === "]" || line[i + 1] === "\\")) {
      text += line[i + 1];
      i += 2;
      continue;
    }
    if (ch === "[") {
      const p = tryAnnotation(line, i);
      if (p) {
        flush();
        out.push(p.segment);
        i = p.end;
        continue;
      }
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

function tryAnnotation(line: string, start: number): { segment: Segment; end: number } | null {
  let j = start + 1;
  let head = "";
  while (j < line.length && line[j] !== ":" && line[j] !== "]" && line[j] !== "[") {
    head += line[j];
    j++;
  }
  if (j >= line.length || line[j] === "[") return null;
  const kinds = head.split(",").map((k) => k.trim());
  if (!kinds.length || !kinds.every((k) => KIND_RE.test(k))) return null;
  if (line[j] === "]") return { segment: { kind: "annotation", kinds, value: null, raw: line.slice(start, j + 1) }, end: j + 1 };
  j++;
  let value = "";
  while (j < line.length) {
    const c = line[j];
    if (c === "\\" && j + 1 < line.length && (line[j + 1] === "]" || line[j + 1] === "[" || line[j + 1] === "\\")) {
      value += line[j + 1];
      j += 2;
      continue;
    }
    if (c === "]") return { segment: { kind: "annotation", kinds, value, raw: line.slice(start, j + 1) }, end: j + 1 };
    if (c === "[") return null;
    value += c;
    j++;
  }
  return null;
}

export function isStyleAnnotation(kinds: string[]): boolean {
  return kinds.every((k) => STYLE_SET.has(k));
}

export function slugify(text: string): string {
  const base = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const cut = base.slice(0, 60).replace(/-+$/g, "");
  return cut.length ? cut : "untitled";
}

/** Server returns `folder` already expanded to an absolute path. */
/** Text with annotations reduced to their values; must match core's plainText(). */
export function plainText(line: string): string {
  return parseSegments(line)
    .map((s) => (s.kind === "text" ? s.text : s.value ?? ""))
    .join("")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function folderFilePath(b: Bullet): string {
  const dir = (b.folder ?? "").replace(/\/+$/, "");
  return `${dir}/${slugify(plainText(b.text))}${OUTLINE_EXT}`;
}

export function lastSegment(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** `@15/9/27`, `@15/9/2027`, `@15/9`, optional ` 10:30` → ISO or null. Day first. */
export function parseDateShorthand(input: string, now = new Date()): string | null {
  const m = input.trim().match(/^@(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = m[3] === undefined ? now.getFullYear() : Number(m[3]);
  if (m[3] !== undefined && m[3].length === 2) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  let iso = `${year}-${pad(month)}-${pad(day)}`;
  if (m[4] !== undefined) {
    const h = Number(m[4]);
    const mi = Number(m[5]);
    if (h > 23 || mi > 59) return null;
    iso += `T${pad(h)}:${pad(mi)}`;
  }
  return iso;
}

export function formatDateShorthand(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/);
  if (!m) return iso;
  let out = `${Number(m[3])}/${Number(m[2])}/${m[1].slice(2)}`;
  if (m[4]) out += ` ${m[4]}:${m[5]}`;
  return out;
}

export function parsePriorityShorthand(input: string): 1 | 2 | 3 | null {
  const m = input.trim().match(/^!([123])$/);
  return m ? (Number(m[1]) as 1 | 2 | 3) : null;
}

export const URL_RE = /https?:\/\/[^\s<>()\[\]]+/g;

// ---------- annotation autocomplete ----------

export interface AnnotationKindInfo {
  kind: string;
  hint: string;
  /** what to insert after the kind */
  suffix: string;
}

/** Kinds offered when the user types `[`. `id`, `folder`, `parent` are managed by Lister and not offered. */
export const COMPLETABLE_KINDS: AnnotationKindInfo[] = [
  { kind: "bold", hint: "[bold:text]", suffix: ":" },
  { kind: "italic", hint: "[italic:text]", suffix: ":" },
  { kind: "highlight", hint: "[highlight:text]", suffix: ":" },
  { kind: "code", hint: "[code:text]", suffix: ":" },
  { kind: "red", hint: "colour", suffix: ":" },
  { kind: "green", hint: "colour", suffix: ":" },
  { kind: "blue", hint: "colour", suffix: ":" },
  { kind: "yellow", hint: "colour", suffix: ":" },
  { kind: "purple", hint: "colour", suffix: ":" },
  { kind: "grey", hint: "colour", suffix: ":" },
  { kind: "date", hint: "[date:2027-09-15]  or type @15/9/27", suffix: ":" },
  { kind: "priority", hint: "[priority:1]  1 high … 3 low, or type !1", suffix: ":" },
  { kind: "done", hint: "[done:2026-09-19]", suffix: ":" },
  { kind: "link", hint: "[link:<bullet id>]", suffix: ":" },
];

export interface Completion {
  /** index of the opening `[` in the text */
  start: number;
  /** full text between `[` and the caret, e.g. `bold,re` */
  typed: string;
  /** the segment being completed (after the last comma) */
  query: string;
  matches: AnnotationKindInfo[];
}

/**
 * If the caret sits inside an unfinished annotation head (`[bo|`, `[bold,re|`), return the completion state.
 * Closed by `:` / `]` / whitespace, an escaped `\[`, or moving the caret out of the head.
 */
export function annotationCompletion(text: string, caret: number): Completion | null {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf("[");
  if (start < 0) return null;
  if (start > 0 && before[start - 1] === "\\") return null;
  const typed = before.slice(start + 1);
  if (!/^[a-z,]*$/i.test(typed)) return null;
  const parts = typed.toLowerCase().split(",");
  const query = parts[parts.length - 1];
  const already = new Set(parts.slice(0, -1));
  const matches = COMPLETABLE_KINDS.filter((k) => k.kind.startsWith(query) && !already.has(k.kind));
  if (!matches.length) return null;
  return { start, typed, query, matches };
}

/** Apply a chosen kind: replaces the partial head and returns the new text and caret. */
export function applyCompletion(text: string, caret: number, c: Completion, pick: AnnotationKindInfo): { text: string; caret: number } {
  const headStart = caret - c.query.length;
  const insert = pick.kind + pick.suffix;
  const next = text.slice(0, headStart) + insert + text.slice(caret);
  return { text: next, caret: headStart + insert.length };
}

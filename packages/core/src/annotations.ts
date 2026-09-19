/**
 * Annotation tokenizer for Bullet text.
 *
 * Syntax: `[kind:value]`, `[kind]` (flag), `[a,b:value]` (combined kinds).
 * No nesting. `\[` and `\]` are literal brackets.
 */

export const METADATA_KINDS = ["id", "folder", "date", "priority", "done"] as const;
export type MetadataKind = (typeof METADATA_KINDS)[number];

export const STYLE_KINDS = [
  "bold", "italic", "highlight", "code",
  "red", "green", "blue", "yellow", "purple", "grey",
] as const;
export type StyleKind = (typeof STYLE_KINDS)[number];

export type Segment =
  | { kind: "text"; text: string }
  | { kind: "annotation"; kinds: string[]; value: string | null; raw: string };

const META_SET: ReadonlySet<string> = new Set(METADATA_KINDS);
const KIND_RE = /^[a-z][a-z0-9_-]*$/;

/** Split a line into text and annotation segments. Unterminated `[` is literal text. */
export function parseSegments(line: string): Segment[] {
  const out: Segment[] = [];
  let text = "";
  let i = 0;
  const flushText = () => {
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
      const parsed = tryParseAnnotation(line, i);
      if (parsed) {
        flushText();
        out.push(parsed.segment);
        i = parsed.end;
        continue;
      }
    }
    text += ch;
    i++;
  }
  flushText();
  return out;
}

function tryParseAnnotation(line: string, start: number): { segment: Segment; end: number } | null {
  // read kinds up to ':' or ']'
  let j = start + 1;
  let head = "";
  while (j < line.length && line[j] !== ":" && line[j] !== "]" && line[j] !== "[") {
    head += line[j];
    j++;
  }
  if (j >= line.length || line[j] === "[") return null;
  const kinds = head.split(",").map((k) => k.trim());
  if (kinds.length === 0 || !kinds.every((k) => KIND_RE.test(k))) return null;
  if (line[j] === "]") {
    return { segment: { kind: "annotation", kinds, value: null, raw: line.slice(start, j + 1) }, end: j + 1 };
  }
  // value until unescaped ']'
  j++;
  let value = "";
  while (j < line.length) {
    const c = line[j];
    if (c === "\\" && j + 1 < line.length && (line[j + 1] === "]" || line[j + 1] === "[" || line[j + 1] === "\\")) {
      value += line[j + 1];
      j += 2;
      continue;
    }
    if (c === "]") {
      return { segment: { kind: "annotation", kinds, value, raw: line.slice(start, j + 1) }, end: j + 1 };
    }
    if (c === "[") return null; // nesting not allowed
    value += c;
    j++;
  }
  return null; // unterminated
}

export function escapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

export function escapeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

export function formatAnnotation(kinds: string[], value: string | null): string {
  return value === null ? `[${kinds.join(",")}]` : `[${kinds.join(",")}:${escapeValue(value)}]`;
}

export function serializeSegments(segs: Segment[]): string {
  return segs
    .map((s) => (s.kind === "text" ? escapeText(s.text) : formatAnnotation(s.kinds, s.value)))
    .join("");
}

export type Metadata = Partial<Record<MetadataKind, string | true>>;

/** Strip metadata annotations from a line. Returns remaining text (inline annotations kept) and the metadata. */
export function splitMetadata(line: string): { text: string; meta: Metadata } {
  const segs = parseSegments(line);
  const meta: Metadata = {};
  const kept: Segment[] = [];
  for (const s of segs) {
    if (s.kind === "annotation" && s.kinds.length === 1 && META_SET.has(s.kinds[0])) {
      const k = s.kinds[0] as MetadataKind;
      if (meta[k] === undefined) meta[k] = s.value === null ? true : s.value;
      continue;
    }
    kept.push(s);
  }
  return { text: collapseSpaces(serializeSegments(kept)), meta };
}

function collapseSpaces(s: string): string {
  return s.replace(/[ \t]{2,}/g, " ").trim();
}

/** Append metadata annotations in canonical order. */
export function joinMetadata(text: string, meta: Metadata): string {
  const parts: string[] = [];
  const t = text.trim();
  if (t) parts.push(t);
  for (const k of METADATA_KINDS) {
    const v = meta[k];
    if (v === undefined) continue;
    parts.push(v === true ? `[${k}]` : formatAnnotation([k], String(v)));
  }
  return parts.join(" ");
}

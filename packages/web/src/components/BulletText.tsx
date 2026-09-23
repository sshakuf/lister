import { useEffect, useState } from "react";
import { parseSegments, isStyleAnnotation, URL_RE } from "../format";
import { Checkbox } from "./Checkbox";
import { api } from "../api";
import { revealBullet } from "../navigate";

const linkCache = new Map<string, string>();

function LinkChip({ id }: { id: string }) {
  const [label, setLabel] = useState(linkCache.get(id) ?? id);
  useEffect(() => {
    if (linkCache.has(id)) return;
    api
      .getBullet(id)
      .then((l) => {
        linkCache.set(id, l.bullet.text || "(untitled)");
        setLabel(l.bullet.text || "(untitled)");
      })
      .catch(() => setLabel(`missing ${id}`));
  }, [id]);
  return (
    <a
      className="link-chip"
      href={`#/b/${id}`}
      title={`link to ${id}`}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        revealBullet(id).catch(() => undefined);
      }}
    >
      {label}
    </a>
  );
}

function AutoLinked({ text }: { text: string }) {
  const parts: (string | { url: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const i = m.index ?? 0;
    if (i > last) parts.push(text.slice(last, i));
    parts.push({ url: m[0] });
    last = i + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <span key={i}>{p}</span>
        ) : (
          <a key={i} href={p.url} target="_blank" rel="noreferrer" className="url" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            {p.url}
          </a>
        ),
      )}
    </>
  );
}

interface Props {
  text: string;
  /** called with the new checked state when a rendered checkbox is tapped */
  onToggleCheck?: (checked: boolean) => void;
}

/** Render bullet text with annotations applied (read mode). */
export function BulletText({ text, onToggleCheck }: Props) {
  const segs = parseSegments(text);
  if (!text.trim()) return <span className="placeholder">Empty bullet</span>;
  return (
    <>
      {segs.map((s, i) => {
        if (s.kind === "text") return <AutoLinked key={i} text={s.text} />;
        if (s.kinds.length === 1 && s.kinds[0] === "link" && s.value) return <LinkChip key={i} id={s.value} />;
        if (isStyleAnnotation(s.kinds)) {
          const checked = s.kinds.includes("checked");
          const box = checked || s.kinds.includes("checkbox");
          return (
            <span key={i} className={s.kinds.map((k) => `st-${k}`).join(" ")}>
              {box && (
                <Checkbox checked={checked} onChange={(on) => onToggleCheck?.(on)} />
              )}
              {s.value ?? ""}
            </span>
          );
        }
        return (
          <span key={i} className="raw-annotation">
            {s.raw}
          </span>
        );
      })}
    </>
  );
}

import { useStore } from "../store";
import { zoomToCrumb } from "../navigate";

export function Breadcrumbs() {
  const crumbs = useStore((s) => s.crumbs);
  if (crumbs.length <= 1) return <div className="crumbs" />;
  return (
    <nav className="crumbs">
      {crumbs.map((c, i) => (
        <span key={`${c.filePath}:${c.bulletId ?? ""}:${i}`}>
          {i > 0 && <span className="crumb-sep">›</span>}
          {i < crumbs.length - 1 ? (
            <button className="crumb" onClick={() => zoomToCrumb(i)}>
              {c.text || "(untitled)"}
            </button>
          ) : (
            <span className="crumb current">{c.text || "(untitled)"}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

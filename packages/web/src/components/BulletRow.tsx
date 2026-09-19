import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Row } from "../tree";
import { isFolderBullet } from "../types";
import { formatDateShorthand, lastSegment } from "../format";
import { BulletText } from "./BulletText";
import { useStore } from "../store";

export interface RowHandlers {
  onKeyDown(rowIndex: number, e: React.KeyboardEvent<HTMLTextAreaElement>, draft: string, setDraft: (v: string) => void): void;
  commit(rowIndex: number, draft: string): void;
  zoom(rowIndex: number): void;
  toggleExpand(rowIndex: number): void;
  convertToFolder(rowIndex: number): void;
  inlineFolder(rowIndex: number): void;
  remove(rowIndex: number): void;
}

interface Props {
  row: Row;
  rowIndex: number;
  handlers: RowHandlers;
}

export function BulletRow({ row, rowIndex, handlers }: Props) {
  const b = row.bullet;
  const focus = useStore((s) => s.focus);
  const setFocus = useStore((s) => s.setFocus);
  const editing = focus?.id === b.id;
  const [draft, setDraft] = useState(b.text);
  const dirty = useRef(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const commitTimer = useRef<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const folder = isFolderBullet(b);

  // adopt server text unless the user has unsaved edits
  useEffect(() => {
    if (!dirty.current) setDraft(b.text);
  }, [b.text]);

  // focus + caret when this row becomes the focused one
  useLayoutEffect(() => {
    if (!editing || !ta.current) return;
    const el = ta.current;
    el.focus();
    const caret = Math.min(focus?.caret ?? draft.length, el.value.length);
    el.setSelectionRange(caret, caret);
    autosize(el);
  }, [editing, focus?.caret]);

  useLayoutEffect(() => {
    if (ta.current) autosize(ta.current);
  }, [draft, editing]);

  const scheduleCommit = (value: string) => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => {
      dirty.current = false;
      handlers.commit(rowIndex, value);
    }, 600);
  };

  const commitNow = (value: string) => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = null;
    dirty.current = false;
    handlers.commit(rowIndex, value);
  };

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: b.id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const cls = ["row", b.done !== undefined ? "done" : "", folder ? "folder" : "", editing ? "editing" : ""].filter(Boolean).join(" ");

  return (
    <div ref={setNodeRef} style={style} className={cls} data-id={b.id}>
      <div className="row-line" style={{ paddingLeft: `${row.depth * 26}px` }}>
        <button
          className={`toggle ${row.hasChildren ? "" : "hidden"} ${row.expanded ? "open" : ""}`}
          tabIndex={-1}
          title={row.expanded ? "Collapse (⌘.)" : "Expand (⌘.)"}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handlers.toggleExpand(rowIndex)}
        >
          ▸
        </button>
        <button
          className={`dot ${row.hasChildren && !row.expanded ? "has-collapsed" : ""}`}
          title={folder ? `Zoom into ${b.folder}` : "Zoom in (drag to reorder)"}
          {...attributes}
          {...listeners}
          onClick={() => handlers.zoom(rowIndex)}
        >
          {folder ? "▣" : "●"}
        </button>
        <div className="content" onMouseDown={(e) => {
          if (editing) return;
          // clicking rendered text starts editing with caret at end
          e.preventDefault();
          setFocus({ id: b.id, caret: draft.length });
        }}>
          {editing ? (
            <textarea
              ref={ta}
              className="edit"
              rows={1}
              value={draft}
              spellCheck={false}
              onChange={(e) => {
                dirty.current = true;
                setDraft(e.target.value);
                scheduleCommit(e.target.value);
              }}
              onBlur={() => {
                if (dirty.current) commitNow(draft);
                if (useStore.getState().focus?.id === b.id) setFocus(null);
              }}
              onKeyDown={(e) => handlers.onKeyDown(rowIndex, e, draft, (v) => {
                dirty.current = true;
                setDraft(v);
              })}
            />
          ) : (
            <div className="rendered">
              <BulletText text={draft} />
            </div>
          )}
          {folder && (
            <span className="folder-hint" title={b.folder}>
              {lastSegment(b.folder!)}
            </span>
          )}
          {b.date && (
            <span className="pill date" title={b.date}>
              {formatDateShorthand(b.date)}
            </span>
          )}
          {b.priority && <span className={`pill prio p${b.priority}`}>!{b.priority}</span>}
          {b.done !== undefined && b.done && (
            <span className="pill donepill" title={`done ${b.done}`}>
              ✓
            </span>
          )}
        </div>
        <div className="row-actions">
          <button className="more" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => setMenuOpen((v) => !v)} title="Actions">
            ⋯
          </button>
          {menuOpen && (
            <div className="menu" onMouseLeave={() => setMenuOpen(false)}>
              <button onClick={() => { setMenuOpen(false); handlers.zoom(rowIndex); }}>Zoom in</button>
              {!folder && <button onClick={() => { setMenuOpen(false); handlers.convertToFolder(rowIndex); }}>Convert to Folder Bullet…</button>}
              {folder && <button onClick={() => { setMenuOpen(false); handlers.inlineFolder(rowIndex); }}>Inline file back</button>}
              <button className="danger" onClick={() => { setMenuOpen(false); handlers.remove(rowIndex); }}>
                {folder ? "Detach (keeps file)" : "Delete"}
              </button>
            </div>
          )}
        </div>
      </div>
      {b.note && !editing && (
        <div className="note" style={{ paddingLeft: `${row.depth * 26 + 46}px` }}>
          {b.note}
        </div>
      )}
    </div>
  );
}

function autosize(el: HTMLTextAreaElement) {
  el.style.height = "0px";
  el.style.height = `${el.scrollHeight}px`;
}

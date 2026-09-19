import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Row } from "../tree";
import { isFolderBullet } from "../types";
import { formatDateShorthand, lastSegment, annotationCompletion, applyCompletion, setChecked } from "../format";
import * as ops from "../ops";
import { RowMenu } from "./RowMenu";
import { BulletText } from "./BulletText";
import { AnnotationMenu } from "./AnnotationMenu";
import { useStore } from "../store";
import { toolbarTouching } from "../ui";

export interface RowHandlers {
  onKeyDown(rowIndex: number, e: React.KeyboardEvent<HTMLTextAreaElement>, draft: string, setDraft: (v: string) => void): void;
  /** Persist edited text. Keyed by file + id so a delayed commit can never hit the wrong (or a deleted) bullet. */
  commit(filePath: string, id: string, draft: string): void;
  zoom(rowIndex: number): void;
  toggleExpand(rowIndex: number): void;
  convertToFolder(rowIndex: number): void;
  inlineFolder(rowIndex: number): void;
  remove(rowIndex: number): void;
  indent(rowIndex: number, caret?: number): void;
  outdent(rowIndex: number, caret?: number): void;
  toggleDone(rowIndex: number): void;
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
  const setText = (text: string) => {
    if (text === b.text) return;
    setDraft(text);
    ops.patchBullet(row.filePath, b.id, { text });
  };

  // `[` autocomplete: derived from the draft and caret; dismissed with Esc until the head changes
  const [caretPos, setCaretPos] = useState(0);
  const [acDismissed, setAcDismissed] = useState<string | null>(null);
  const [acSel, setAcSel] = useState(0);
  const completion = editing ? annotationCompletion(draft, caretPos) : null;
  const acKey = completion ? `${completion.start}:${completion.typed}` : null;
  const acOpen = completion !== null && acDismissed !== acKey;
  const acSelected = Math.min(acSel, (completion?.matches.length ?? 1) - 1);

  const pickCompletion = (i: number) => {
    if (!completion) return;
    const { text, caret } = applyCompletion(draft, caretPos, completion, completion.matches[i]);
    dirty.current = true;
    setDraft(text);
    setCaretPos(caret);
    setAcSel(0);
    scheduleCommit(text);
    requestAnimationFrame(() => ta.current?.setSelectionRange(caret, caret));
  };

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

  const cancelPending = () => {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = null;
  };

  const scheduleCommit = (value: string) => {
    cancelPending();
    commitTimer.current = window.setTimeout(() => {
      commitTimer.current = null;
      dirty.current = false;
      handlers.commit(row.filePath, b.id, value);
    }, 600);
  };

  const commitNow = (value: string) => {
    cancelPending();
    dirty.current = false;
    handlers.commit(row.filePath, b.id, value);
  };

  // unmount (deleted, collapsed away, zoomed out): flush a pending edit once, never after
  const latest = useRef({ draft, filePath: row.filePath });
  latest.current = { draft, filePath: row.filePath };
  useEffect(() => {
    return () => {
      const pending = commitTimer.current !== null;
      cancelPending();
      if (pending && dirty.current) {
        dirty.current = false;
        handlers.commit(latest.current.filePath, b.id, latest.current.draft);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
                setCaretPos(e.target.selectionStart ?? e.target.value.length);
                setAcSel(0);
                scheduleCommit(e.target.value);
              }}
              onSelect={(e) => setCaretPos((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
              onClick={(e) => setCaretPos((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
              onBlur={() => {
                if (dirty.current) commitNow(draft);
                if (toolbarTouching()) {
                  // iOS Safari blurs the textarea when a fixed toolbar button is tapped; keep editing
                  requestAnimationFrame(() => ta.current?.focus({ preventScroll: true }));
                  return;
                }
                if (useStore.getState().focus?.id === b.id) setFocus(null);
              }}
              onKeyDown={(e) => {
                if (acOpen && completion) {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const n = completion.matches.length;
                    setAcSel((acSelected + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
                    return;
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    pickCompletion(acSelected);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setAcDismissed(acKey);
                    return;
                  }
                }
                // deleting this bullet: drop any pending text commit so it cannot fire afterwards
                if (e.key === "Backspace" && draft === "" && !e.metaKey && !e.ctrlKey) {
                  cancelPending();
                  dirty.current = false;
                }
                handlers.onKeyDown(rowIndex, e, draft, (v) => {
                  // the key handler persists this change itself (shorthand conversion), so a
                  // delayed commit from earlier typing must not overwrite it with stale text
                  cancelPending();
                  dirty.current = false;
                  setDraft(v);
                });
              }}
            />
          ) : (
            <div className="rendered">
              <BulletText text={draft} onToggleCheck={(on) => setText(setChecked(b.text, on))} />
            </div>
          )}
          {acOpen && completion && (
            <AnnotationMenu completion={completion} selected={acSelected} onHover={setAcSel} onPick={pickCompletion} />
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
          <button
            className="indent-btn"
            tabIndex={-1}
            disabled={rowIsTopOfRoot(row)}
            title="Outdent (Shift+Tab)"
            aria-label="Outdent"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handlers.outdent(rowIndex)}
          >
            ←
          </button>
          <button
            className="indent-btn"
            tabIndex={-1}
            disabled={row.index === 0}
            title="Indent (Tab)"
            aria-label="Indent"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handlers.indent(rowIndex)}
          >
            →
          </button>
          <button className="more" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => setMenuOpen((v) => !v)} title="Actions">
            ⋯
          </button>
          {menuOpen && (
            <div onMouseLeave={() => setMenuOpen(false)}>
              <RowMenu row={row} rowIndex={rowIndex} handlers={handlers} close={() => setMenuOpen(false)} />
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

/** Top-level rows of the zoomed root list have nothing to outdent to. */
function rowIsTopOfRoot(row: Row): boolean {
  return row.depth === 0 && row.parentId === null;
}

function autosize(el: HTMLTextAreaElement) {
  el.style.height = "0px";
  el.style.height = `${el.scrollHeight}px`;
}

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
import { hive } from "../hive/client";
import { editParts, replacePart, sourceCaret, labelCaret } from "../checkbox-editing";
import { Checkbox } from "./Checkbox";
import { toolbarTouching } from "../ui";

export interface RowHandlers {
  onKeyDown(rowIndex: number, e: React.KeyboardEvent<HTMLTextAreaElement>, draft: string, setDraft: (v: string) => void, selection?: { start: number; end: number }): void;
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
  const ta = useRef<HTMLTextAreaElement | null>(null);
  const editor = useRef<HTMLDivElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const parts = editParts(draft);
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
  const completion = editing && !parts.some(p => p.checked !== null && caretPos >= p.start && caretPos <= p.start + p.raw.length) ? annotationCompletion(draft, caretPos) : null;
  const acKey = completion ? `${completion.start}:${completion.typed}` : null;
  const acOpen = completion !== null && acDismissed !== acKey;
  const acSelected = Math.min(acSel, (completion?.matches.length ?? 1) - 1);

  const pickCompletion = (i: number) => {
    if (!completion) return;
    const { text, caret } = applyCompletion(draft, caretPos, completion, completion.matches[i]);
    dirty.current = true;
    pendingCaret.current = caret;
    setDraft(text);
    setCaretPos(caret);
    setAcSel(0);
    scheduleCommit(text);
  };

  useEffect(() => {
    const node = editor.current;
    if (!editing || !node) return;
    const insertAnnotation = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement) || target.getAttribute('aria-label') !== 'Checkbox label') return;
      event.preventDefault();
      const next = draft + (draft.endsWith(' ') ? '[' : ' [');
      pendingCaret.current = next.length;
      dirty.current = true;
      setDraft(next);
      setCaretPos(next.length);
      setAcSel(0);
      scheduleCommit(next);
    };
    node.addEventListener('lister-insert-annotation', insertAnnotation);
    return () => node.removeEventListener('lister-insert-annotation', insertAnnotation);
  }, [draft, editing]);

  // adopt server text unless the user has unsaved edits
  useEffect(() => {
    if (!dirty.current) setDraft(b.text);
  }, [b.text]);

  // focus + caret when this row becomes the focused one
  useLayoutEffect(() => {
    if (!editing || !editor.current) return;
    const pos = focus?.caret ?? draft.length;
    const found = parts.findIndex(p => pos < p.start + p.raw.length);
    const index = found < 0 ? parts.length - 1 : found;
    const el = editor.current.querySelectorAll('textarea')[index];
    if (!el) return;
    ta.current = el;
    el.focus();
    const caret = labelCaret(parts[index], pos);
    el.setSelectionRange(caret, caret);
    autosize(el);
  }, [editing, focus?.caret]);

  useLayoutEffect(() => {
    if (pendingCaret.current !== null && editing && editor.current) {
      const pos = pendingCaret.current;
      pendingCaret.current = null;
      const index = parts.findIndex(p => pos < p.start + p.raw.length);
      const el = editor.current.querySelectorAll('textarea')[index < 0 ? parts.length - 1 : index];
      if (el) {
        const caret = labelCaret(parts[index < 0 ? parts.length - 1 : index], pos);
        ta.current = el;
        el.focus({ preventScroll: true });
        el.setSelectionRange(caret, caret);
      }
    }
    editor.current?.querySelectorAll('textarea').forEach(autosize);
  }, [draft, editing]);

  const cancelPending = () => {
    hive.draft(b.id, false);
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = null;
  };

  const scheduleCommit = (value: string) => {
    cancelPending();
    hive.draft(b.id, true);
    commitTimer.current = window.setTimeout(() => {
      commitTimer.current = null;
      hive.draft(b.id, false);
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
            <div className="checkbox-editor" ref={editor}>
            {parts.map((part, partIndex) => <div className="edit-part" key={partIndex}>
              {part.checked !== null && <Checkbox checked={part.checked} onChange={(on) => {
                const next = parts.map((p, i) => i === partIndex
                  ? { ...p, raw: setChecked(p.raw, on) } : p).map(p => p.raw).join('');
                setDraft(next);
                commitNow(next);
              }} />}
            <textarea
              aria-label={part.checked === null ? "Bullet text" : "Checkbox label"}
              dir="auto"
              onFocus={(e) => { ta.current = e.currentTarget; }}
              className="edit"
              rows={1}
              value={part.value}
              spellCheck={false}
              onChange={(e) => {
                dirty.current = true;
                const next = replacePart(parts, partIndex, e.target.value);
                const updatedPart = part.checked === null ? { ...part, value: e.target.value } : editParts(next)[partIndex];
                const pos = sourceCaret(updatedPart, e.target.selectionStart ?? e.target.value.length);
                pendingCaret.current = (e.nativeEvent as InputEvent).isComposing ? null : pos;
                setDraft(next);
                setCaretPos(pos);
                setAcSel(0);
                scheduleCommit(next);
              }}
              onSelect={(e) => setCaretPos(sourceCaret(part, (e.target as HTMLTextAreaElement).selectionStart ?? 0))}
              onClick={(e) => setCaretPos(sourceCaret(part, (e.target as HTMLTextAreaElement).selectionStart ?? 0))}
              onBlur={(e) => {
                if (e.relatedTarget instanceof Node && editor.current?.contains(e.relatedTarget)) return;
                if (dirty.current) commitNow(draft);
                if (toolbarTouching() && useStore.getState().focus?.id === b.id) {
                  // iOS Safari blurs the textarea when a fixed toolbar button is tapped; keep editing
                  requestAnimationFrame(() => ta.current?.focus({ preventScroll: true }));
                  return;
                }
                if (useStore.getState().focus?.id === b.id) setFocus(null);
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
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
                if (e.key === "Backspace" && part.checked !== null && part.value === "" && !e.metaKey && !e.ctrlKey) {
                  e.preventDefault();
                  const next = parts.filter((_, i) => i !== partIndex).map(p => p.raw).join('');
                  pendingCaret.current = part.start;
                  setDraft(next);
                  commitNow(next);
                  setFocus({ id: b.id, caret: part.start });
                  return;
                }
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
                }, { start: sourceCaret(part, e.currentTarget.selectionStart), end: sourceCaret(part, e.currentTarget.selectionEnd) });
              }}
            />
            </div>)}
            </div>
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

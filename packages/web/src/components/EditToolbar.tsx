import { useEffect, useState } from "react";
import { useStore } from "../store";
import type { Row } from "../tree";
import type { RowHandlers } from "./BulletRow";
import { RowMenu } from "./RowMenu";

interface Props {
  rows: Row[];
  handlers: RowHandlers;
}

/** Bottom of the *visual* viewport, which shrinks when the on-screen keyboard opens (iOS Safari, Android Chrome). */
function useKeyboardOffset(): number {
  const [bottom, setBottom] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setBottom(Math.max(0, window.innerHeight - (vv.height + vv.offsetTop)));
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  return bottom;
}

/** Insert text at the caret of the focused bullet's textarea through the browser's editing pipeline so React sees it. */
function insertAtCaret(id: string, text: string) {
  const ta = document.querySelector<HTMLTextAreaElement>(`[data-id="${id}"] textarea`);
  if (!ta) return;
  ta.focus();
  if (!document.execCommand("insertText", false, text)) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

/** Toolbar pinned above the on-screen keyboard while a bullet is being edited (touch devices). */
export function EditToolbar({ rows, handlers }: Props) {
  const focus = useStore((s) => s.focus);
  const undoN = useStore((s) => s.undoStack.length);
  const redoN = useStore((s) => s.redoStack.length);
  const bottom = useKeyboardOffset();
  const [menu, setMenu] = useState(false);
  const i = focus ? rows.findIndex((r) => r.bullet.id === focus.id) : -1;
  useEffect(() => setMenu(false), [focus?.id]);
  if (i < 0 || !focus) return null;
  const r = rows[i];
  const keep = (e: React.SyntheticEvent) => e.preventDefault(); // do not steal focus from the textarea
  const refocus = () => useStore.getState().setFocus({ id: r.bullet.id, caret: focus.caret });
  const btn = (label: string, title: string, fn: () => void, disabled = false) => (
    <button key={title} title={title} aria-label={title} disabled={disabled} onMouseDown={keep} onTouchStart={keep} onClick={fn}>
      {label}
    </button>
  );
  return (
    <div className="edit-toolbar" style={{ bottom }} onMouseDown={keep}>
      {menu && <RowMenu row={r} rowIndex={i} handlers={handlers} close={() => setMenu(false)} className="menu sheet" />}
      <div className="edit-toolbar-row">
        {btn("⇤", "Outdent", () => handlers.outdent(i), r.depth === 0 && r.parentId === null)}
        {btn("⇥", "Indent", () => handlers.indent(i), r.index === 0)}
        {btn("↶", "Undo", () => void useStore.getState().undo(), !undoN)}
        {btn("↷", "Redo", () => void useStore.getState().redo(), !redoN)}
        {btn("✓", r.bullet.done !== undefined ? "Mark not done" : "Mark done", () => handlers.toggleDone(i))}
        {btn("@", "Insert date (@15/9/27)", () => insertAtCaret(r.bullet.id, "@"))}
        {btn("[", "Insert annotation", () => insertAtCaret(r.bullet.id, "["))}
        {btn("⋯", "More actions", () => {
          setMenu((v) => !v);
          refocus();
        })}
        {btn("⌨", "Hide keyboard", () => {
          document.querySelector<HTMLTextAreaElement>(`[data-id="${r.bullet.id}"] textarea`)?.blur();
          useStore.getState().setFocus(null);
        })}
      </div>
    </div>
  );
}

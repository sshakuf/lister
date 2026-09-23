import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { keyboardLayout } from "../keyboard-layout";
import { useStore } from "../store";
import type { Row } from "../tree";
import type { RowHandlers } from "./BulletRow";
import { RowMenu } from "./RowMenu";
import { TapButton } from "./TapButton";
import { markToolbarTouch } from "../ui";

interface Props {
  rows: Row[];
  handlers: RowHandlers;
}

/** Bottom of the *visual* viewport, which shrinks when the on-screen keyboard opens (iOS Safari, Android Chrome). */
function useKeyboardOffset() {
  const [layout, setLayout] = useState(() => keyboardLayout(window.innerHeight, window.visualViewport ?? undefined));
  useEffect(() => {
    const vv = window.visualViewport;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setLayout(keyboardLayout(window.innerHeight, vv ?? undefined)));
    };
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("focusin", update);
    return () => {
      cancelAnimationFrame(frame);
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("focusin", update);
    };
  }, []);
  return layout;
}

/**
 * Insert text at the caret of the focused bullet's textarea through the browser's editing pipeline so React sees it.
 * A shorthand token (`@…`, `[…`) must start a word, so a space is added when the caret follows a non-space.
 */
function insertAtCaret(id: string, text: string) {
  const active = document.activeElement;
  const ta = active instanceof HTMLTextAreaElement && active.closest(`[data-id="${id}"]`)
    ? active : document.querySelector<HTMLTextAreaElement>(`[data-id="${id}"] textarea`);
  if (!ta) return;
  if (text === '[' && !ta.dispatchEvent(new Event('lister-insert-annotation', { bubbles: true, cancelable: true }))) return;
  ta.focus();
  const before = ta.value.slice(0, ta.selectionStart);
  const insert = before && !/\s$/.test(before) ? " " + text : text;
  if (!document.execCommand("insertText", false, insert)) {
    ta.setRangeText(insert, ta.selectionStart, ta.selectionEnd, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

/** Toolbar pinned above the on-screen keyboard while a bullet is being edited (touch devices). */
export function EditToolbar({ rows, handlers }: Props) {
  const focus = useStore((s) => s.focus);
  const undoN = useStore((s) => s.undoStack.length);
  const redoN = useStore((s) => s.redoStack.length);
  const layout = useKeyboardOffset();
  const toolbar = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  const i = focus ? rows.findIndex((r) => r.bullet.id === focus.id) : -1;
  useEffect(() => setMenu(false), [focus?.id]);
  useLayoutEffect(() => {
    if (!focus || !toolbar.current || !matchMedia('(hover: none), (pointer: coarse)').matches) return;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLTextAreaElement)) return;
      const rect = active.getBoundingClientRect();
      const top = window.visualViewport?.offsetTop ?? 0;
      const bottom = layout.top - (toolbar.current?.offsetHeight ?? 0) - 12;
      if (rect.bottom > bottom) window.scrollBy(0, rect.bottom - bottom);
      else if (rect.top < top + 12) window.scrollBy(0, rect.top - top - 12);
    });
    return () => cancelAnimationFrame(frame);
  }, [focus?.id, layout.top]);
  if (i < 0 || !focus) return null;
  const r = rows[i];
  const keep = (e: React.SyntheticEvent) => e.preventDefault(); // do not steal focus from the textarea
  const btn = (label: string, title: string, fn: () => void, disabled = false) => (
    <TapButton key={title} title={title} aria-label={title} disabled={disabled} onTap={fn}>
      {label}
    </TapButton>
  );
  return createPortal(
    <div ref={toolbar} className={`edit-toolbar ${layout.keyboard ? "keyboard-open" : ""}`} style={{ top: layout.top, "--edit-viewport-height": `${window.visualViewport?.height ?? window.innerHeight}px` } as React.CSSProperties} onMouseDown={keep} onTouchStart={markToolbarTouch}>
      {menu && <>
        <div className="edit-toolbar-insert">
          {btn("@ Date", "Insert date (@15/9/27)", () => { insertAtCaret(r.bullet.id, "@"); setMenu(false); })}
          {btn("[ Annotation", "Insert annotation", () => { insertAtCaret(r.bullet.id, "["); setMenu(false); })}
        </div>
        <RowMenu row={r} rowIndex={i} handlers={handlers} close={() => setMenu(false)} className="menu sheet" />
      </>}
      <div className="edit-toolbar-row">
        {btn("⇤", "Outdent", () => handlers.outdent(i), r.depth === 0 && r.parentId === null)}
        {btn("⇥", "Indent", () => handlers.indent(i), r.index === 0)}
        {btn("↶", "Undo", () => void useStore.getState().undo(), !undoN)}
        {btn("↷", "Redo", () => void useStore.getState().redo(), !redoN)}
        {btn("✓", r.bullet.done !== undefined ? "Mark not done" : "Mark done", () => handlers.toggleDone(i))}
        {btn("⋯", "More actions", () => {
          setMenu((v) => !v);
        })}
        {btn("Done", "Finish editing", () => {
          useStore.getState().setFocus(null);
          if (document.activeElement instanceof HTMLTextAreaElement) document.activeElement.blur();
        })}
      </div>
    </div>, document.body
  );
}

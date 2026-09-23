import { useCallback, useEffect, useMemo } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useStore } from "../store";
import { useUi } from "../ui";
import { flattenVisible, findBullet, type Row } from "../tree";
import { isFolderBullet } from "../types";
import { parseDateShorthand, parsePriorityShorthand, todayIso } from "../format";
import * as ops from "../ops";
import { zoomIntoRow } from "../navigate";
import { BulletRow, type RowHandlers } from "./BulletRow";
import { Breadcrumbs } from "./Breadcrumbs";
import { splitBullet } from "../checkbox-editing";
import { EditToolbar } from "./EditToolbar";

const isMac = navigator.platform.toLowerCase().includes("mac");

/** Load an Outline File into the store if it is not there yet. Resolves false (and shows the error) on failure. */
async function ensureFileLoaded(filePath: string): Promise<boolean> {
  const st = useStore.getState();
  if (st.files[filePath]) return true;
  try {
    await st.loadFile(filePath);
    return true;
  } catch (e) {
    st.setError((e as Error).message);
    return false;
  }
}
const mod = (e: React.KeyboardEvent | KeyboardEvent) => (isMac ? e.metaKey : e.ctrlKey);

export function Outline() {
  const zoom = useStore((s) => s.zoom);
  const files = useStore((s) => s.files);
  const collapsed = useStore((s) => s.collapsed);
  const expandedFolders = useStore((s) => s.expandedFolders);
  const crumbs = useStore((s) => s.crumbs);
  const setFocus = useStore((s) => s.setFocus);
  const openPicker = useUi((s) => s.openPicker);

  const rows: Row[] = useMemo(
    () => (zoom ? flattenVisible(zoom.filePath, zoom.bulletId, { files, collapsed, expandedFolders }) : []),
    [zoom, files, collapsed, expandedFolders],
  );

  // the list the zoomed view adds new bullets into when empty
  const container = useMemo(() => {
    if (!zoom) return null;
    const f = files[zoom.filePath];
    if (!f) return null;
    if (zoom.bulletId === null) return { filePath: f.path, parentId: null as string | null, length: f.bullets.length };
    const loc = findBullet(f.bullets, zoom.bulletId);
    if (!loc) return null;
    if (isFolderBullet(loc.bullet)) {
      // zoomed into a Folder Bullet through its own file; flattenVisible already redirected
      return null;
    }
    return { filePath: f.path, parentId: zoom.bulletId, length: loc.bullet.children.length };
  }, [zoom, files]);

  // make sure the zoomed file is loaded (e.g. restored from localStorage)
  useEffect(() => {
    if (zoom && !files[zoom.filePath]) useStore.getState().loadFile(zoom.filePath).catch(() => undefined);
  }, [zoom, files]);

  const focusRow = (i: number, caret: number) => {
    const r = rows[i];
    if (r) setFocus({ id: r.bullet.id, caret });
  };

  const handlers: RowHandlers = useMemo(() => ({
    commit(filePath, id, draft) {
      // Validate against the *current* store, not the row snapshot this closure was created with:
      // the bullet may have been deleted or its text changed since the commit was scheduled.
      const f = useStore.getState().files[filePath];
      const loc = f ? findBullet(f.bullets, id) : null;
      if (!loc || draft === loc.bullet.text) return;
      ops.patchBullet(filePath, id, { text: draft });
    },
    zoom(i) {
      zoomIntoRow(rows, i);
    },
    async toggleExpand(i) {
      const r = rows[i];
      if (!r) return;
      if (r.childFile) {
        const next = !r.expanded;
        if (next) await useStore.getState().loadFile(r.childFile).catch((e) => useStore.getState().setError(e.message));
        useStore.getState().setFolderExpanded(r.bullet.id, next);
      } else useStore.getState().toggleCollapsed(r.bullet.id);
    },
    convertToFolder(i) {
      const r = rows[i];
      if (!r || isFolderBullet(r.bullet)) return;
      openPicker({
        title: `Store "${r.bullet.text || "untitled"}" in folder`,
        onPick: async (folder) => {
          await ops.convertToFolder(r.filePath, r.bullet.id, folder);
        },
      });
    },
    inlineFolder(i) {
      const r = rows[i];
      if (!r || !isFolderBullet(r.bullet)) return;
      if (!confirm(`Inline "${r.bullet.text}" back into this list? Its Outline File will be moved to the trash.`)) return;
      ops.inlineFolder(r.filePath, r.bullet);
    },
    /** Make the bullet the last child of its previous sibling (Tab). */
    indent(i, caret) {
      const r = rows[i];
      if (!r) return;
      const b = r.bullet;
      const from: ops.Position = { filePath: r.filePath, parentId: r.parentId, index: r.index };
      const prev = r.siblings[r.index - 1];
      if (!prev) return;
      const c = caret ?? b.text.length;
      if (isFolderBullet(prev)) {
        // nest under a Folder Bullet: its children live in its Outline File, which may not be loaded yet
        const cf = rows.find((x) => x.bullet.id === prev.id)?.childFile;
        if (!cf) return;
        ensureFileLoaded(cf).then((ok) => {
          if (!ok) return;
          const target = useStore.getState().files[cf];
          useStore.getState().setFolderExpanded(prev.id, true);
          ops.moveTo(b.id, from, { filePath: cf, parentId: null, index: target?.bullets.length ?? 0 });
          setFocus({ id: b.id, caret: c });
        });
        return;
      }
      useStore.getState().setCollapsed(prev.id, false);
      ops.moveTo(b.id, from, { filePath: r.filePath, parentId: prev.id, index: prev.children.length });
      setFocus({ id: b.id, caret: c });
    },
    /** Move the bullet out to sit right after its parent (Shift+Tab). Top-level bullets of a Folder Bullet's file move to the parent file. */
    outdent(i, caret) {
      const r = rows[i];
      if (!r) return;
      const b = r.bullet;
      const from: ops.Position = { filePath: r.filePath, parentId: r.parentId, index: r.index };
      const c = caret ?? b.text.length;
      if (r.parentId === null) {
        // top of an Outline File: the Folder Bullet that owns it is the effective parent
        const owner = rows.find((x) => x.childFile === r.filePath);
        if (!owner) return;
        ops.moveTo(b.id, from, { filePath: owner.filePath, parentId: owner.parentId, index: owner.index + 1 });
        setFocus({ id: b.id, caret: c });
        return;
      }
      const f = files[r.filePath];
      const ploc = f ? findBullet(f.bullets, r.parentId) : null;
      if (!ploc) return;
      ops.moveTo(b.id, from, { filePath: r.filePath, parentId: ploc.parent?.id ?? null, index: ploc.index + 1 });
      setFocus({ id: b.id, caret: c });
    },
    toggleDone(i) {
      const r = rows[i];
      if (r) ops.toggleDone(r.filePath, r.bullet, todayIso());
    },
    remove(i) {
      const r = rows[i];
      if (!r) return;
      if (r.bullet.children.length && !confirm(`Delete "${r.bullet.text}" and its ${r.bullet.children.length} children?`)) return;
      ops.deleteBullet(r.filePath, r.bullet.id);
      if (i > 0) focusRow(i - 1, rows[i - 1].bullet.text.length);
    },
    onKeyDown(i, e, draft, setDraft, selection) {
      const r = rows[i];
      if (!r) return;
      const el = e.currentTarget;
      const caret = selection?.start ?? el.selectionStart ?? draft.length;
      const b = r.bullet;
      const from: ops.Position = { filePath: r.filePath, parentId: r.parentId, index: r.index };

      if (e.key === "Escape") {
        el.blur();
        return;
      }

      // shorthand: "@15/9/27 " or "!2 " converts to date / priority
      if (e.key === " " && !mod(e)) {
        const before = draft.slice(0, caret);
        const m = before.match(/(^|\s)(\S+)$/);
        const token = m?.[2];
        if (token) {
          const iso = parseDateShorthand(token);
          const prio = parsePriorityShorthand(token);
          if (iso || prio) {
            e.preventDefault();
            const start = caret - token.length;
            // keep the space that preceded the token so the next word does not glue on
            const newText = (draft.slice(0, start) + draft.slice(caret)).replace(/\s{2,}/g, " ");
            setDraft(newText);
            ops.patchBullet(r.filePath, b.id, iso ? { text: newText.trim(), date: iso } : { text: newText.trim(), priority: prio! });
            setFocus({ id: b.id, caret: Math.min(start, newText.length) });
            return;
          }
        }
      }

      if (e.key === "Enter") {
        e.preventDefault();
        if (mod(e) && e.shiftKey) {
          handlers.convertToFolder(i);
          return;
        }
        if (mod(e)) {
          ops.toggleDone(r.filePath, b, todayIso());
          return;
        }
        if (e.shiftKey) return; // notes editing is v2
        const { before, after } = splitBullet(draft, caret, selection?.end ?? el.selectionEnd);
        setDraft(before); // cancel the old debounced edit before it can overwrite the split
        if (before !== b.text) ops.patchBullet(r.filePath, b.id, { text: before }, { undo: false });
        const goesInside = !isFolderBullet(b) && b.children.length > 0 && r.expanded && (after === "" || after === "[checkbox:]") && before.length > 0;
        if (goesInside) ops.addBullet(r.filePath, b.id, 0, after);
        else if (isFolderBullet(b) && r.expanded && r.childFile) {
          // expanded Folder Bullet: new first child goes into its Outline File (load it if needed)
          const cf = r.childFile;
          ensureFileLoaded(cf).then((ok) => {
            if (ok) ops.addBullet(cf, null, 0, after);
            else ops.addBullet(r.filePath, r.parentId, r.index + 1, after);
          });
        } else ops.addBullet(r.filePath, r.parentId, r.index + 1, after);
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        if (e.shiftKey) handlers.outdent(i, caret);
        else handlers.indent(i, caret);
        return;
      }

      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const dir = e.key === "ArrowUp" ? -1 : 1;
        if (mod(e)) {
          e.preventDefault();
          const ni = r.index + dir;
          if (ni < 0 || ni >= r.siblings.length) return;
          ops.moveTo(b.id, from, { filePath: r.filePath, parentId: r.parentId, index: ni });
          setFocus({ id: b.id, caret });
          return;
        }
        if (e.altKey || e.shiftKey) return;
        const ti = i + dir;
        if (ti < 0 || ti >= rows.length) return;
        e.preventDefault();
        focusRow(ti, Math.min(caret, rows[ti].bullet.text.length));
        return;
      }

      if (e.key === "." && mod(e)) {
        e.preventDefault();
        handlers.toggleExpand(i);
        return;
      }

      if (e.key === "Backspace" && draft === "" && !mod(e)) {
        e.preventDefault();
        if (b.children.length > 0 || isFolderBullet(b)) return;
        ops.deleteBullet(r.filePath, b.id);
        if (i > 0) focusRow(i - 1, rows[i - 1].bullet.text.length);
        else setFocus(null);
        return;
      }
    },
  }), [rows, files, openPicker, setFocus]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const onDragEnd = useCallback(
    (ev: DragEndEvent) => {
      const { active, over } = ev;
      if (!over || active.id === over.id) return;
      const a = rows.find((r) => r.bullet.id === active.id);
      const o = rows.find((r) => r.bullet.id === over.id);
      if (!a || !o) return;
      if (a.filePath !== o.filePath) return; // cross-file drag not supported
      // if `over` is a descendant of `active`, ignore
      if (findBullet(a.bullet.children, o.bullet.id)) return;
      const from: ops.Position = { filePath: a.filePath, parentId: a.parentId, index: a.index };
      // server removes then inserts: inserting at o.index lands after `over` when moving down, before it when moving up
      ops.moveTo(a.bullet.id, from, { filePath: o.filePath, parentId: o.parentId, index: o.index });
    },
    [rows],
  );

  const title = crumbs.length > 1 ? crumbs[crumbs.length - 1].text : files[zoom?.filePath ?? ""]?.name;

  if (!zoom) return <div className="outline loading">Loading…</div>;

  return (
    <div className="outline">
      <Breadcrumbs />
      {crumbs.length > 1 && <h1 className="zoom-title">{title || "(untitled)"}</h1>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={rows.map((r) => r.bullet.id)} strategy={verticalListSortingStrategy}>
          <div className="rows">
            {rows.map((r, i) => (
              <BulletRow key={r.bullet.id} row={r} rowIndex={i} handlers={handlers} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {container && (
        <button className="add-row" onClick={() => ops.addBullet(container.filePath, container.parentId, container.length, "")}>
          + Add bullet
        </button>
      )}
      <EditToolbar rows={rows} handlers={handlers} />
    </div>
  );
}

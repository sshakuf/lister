import type { Row } from "../tree";
import { isFolderBullet } from "../types";
import { hasStyle, toggleStyle, checkState, setChecked, addCheckbox, removeCheckbox } from "../format";
import * as ops from "../ops";
import type { RowHandlers } from "./BulletRow";
import { TapButton } from "./TapButton";

interface Props {
  row: Row;
  rowIndex: number;
  handlers: RowHandlers;
  close(): void;
  className?: string;
}

/** The per-bullet action list. Used as a popover on desktop and as a sheet above the mobile toolbar. */
export function RowMenu({ row, rowIndex, handlers, close, className = "menu" }: Props) {
  const b = row.bullet;
  const folder = isFolderBullet(b);
  const struck = hasStyle(b.text, "strike");
  const check = checkState(b.text);
  const setText = (text: string) => {
    if (text !== b.text) ops.patchBullet(row.filePath, b.id, { text });
  };
  const item = (label: string, fn: () => void, cls = "") => (
    <TapButton
      key={label}
      className={cls}
      onTap={() => {
        close();
        fn();
      }}
    >
      {label}
    </TapButton>
  );
  return (
    <div className={className} role="menu">
      {item("Zoom in", () => handlers.zoom(rowIndex))}
      {item(struck ? "Remove strike" : "Strike through", () => setText(toggleStyle(b.text, "strike")))}
      {item("Convert to checkbox", () => { void ops.convertToCheckbox(row.filePath, b.id); })}
      {check === null && item("Add checkbox", () => setText(addCheckbox(b.text)))}
      {check === "checkbox" && item("Check ☑", () => setText(setChecked(b.text, true)))}
      {check === "checked" && item("Uncheck ☐", () => setText(setChecked(b.text, false)))}
      {check !== null && item("Remove checkbox", () => setText(removeCheckbox(b.text)))}
      {item(b.done !== undefined ? "Mark not done" : "Mark done ✓", () => handlers.toggleDone(rowIndex))}
      {!folder && item("Convert to Folder Bullet…", () => handlers.convertToFolder(rowIndex))}
      {folder && item("Inline file back", () => handlers.inlineFolder(rowIndex))}
      {item(folder ? "Detach (keeps file)" : "Delete", () => handlers.remove(rowIndex), "danger")}
    </div>
  );
}

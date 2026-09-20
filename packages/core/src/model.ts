export type BulletId = string;

export interface Bullet {
  id: BulletId;
  /** Text with inline annotations (styles, links); metadata annotations stripped. */
  text: string;
  /** Multi-line note from continuation lines. */
  note?: string;
  /** Absolute directory path when this is a Folder Bullet. */
  folder?: string;
  /** Shared Outline File identity; never a local filesystem path. */
  outline?: string;
  /** YYYY-MM-DD or YYYY-MM-DDTHH:mm */
  date?: string;
  priority?: 1 | 2 | 3;
  /** YYYY-MM-DD of completion, or "" when written as bare [done]. */
  done?: string;
  children: Bullet[];
}

export interface OutlineFile {
  /** Absolute path of the .lister file. */
  path: string;
  /** Header name. */
  name: string;
  /** Header id; equals the owning Folder Bullet's id. */
  id: BulletId;
  parentId?: BulletId;
  bullets: Bullet[];
}

export function isFolderBullet(b: Bullet): boolean {
  return (typeof b.folder === "string" && b.folder.length > 0) ||
    (typeof b.outline === "string" && b.outline.length > 0);
}

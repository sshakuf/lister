import { type OutlineFile, walk, type Bullet } from "@lister/core";

export interface Hit {
  id: string;
  text: string;
  filePath: string;
  fileName: string;
  /** Ancestor texts within the file, root first. */
  path: string[];
  done?: string;
  folder?: string;
}

/** In-memory case-insensitive substring index over loaded Outline Files. */
export class Search {
  private byFile = new Map<string, Hit[]>();

  index(file: OutlineFile): void {
    const hits: Hit[] = [];
    const trail: Bullet[] = [];
    const rec = (bullets: Bullet[]) => {
      for (const b of bullets) {
        hits.push({
          id: b.id,
          text: b.text,
          filePath: file.path,
          fileName: file.name,
          path: trail.map((t) => t.text),
          done: b.done,
          folder: b.folder,
        });
        trail.push(b);
        rec(b.children);
        trail.pop();
      }
    };
    rec(file.bullets);
    this.byFile.set(file.path, hits);
  }

  remove(filePath: string): void {
    this.byFile.delete(filePath);
  }

  query(q: string, limit = 50): Hit[] {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const out: Hit[] = [];
    for (const hits of this.byFile.values()) {
      for (const h of hits) {
        if (h.text.toLowerCase().includes(needle)) {
          out.push(h);
          if (out.length >= limit) return out;
        }
      }
    }
    return out;
  }
}

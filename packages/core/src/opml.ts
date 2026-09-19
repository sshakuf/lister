import { XMLParser } from "fast-xml-parser";
import type { Bullet } from "./model.js";
import { newId } from "./ids.js";
import { todayIso } from "./dates.js";

interface OpmlOutline {
  "@_text"?: string;
  "@__note"?: string;
  "@__complete"?: string;
  outline?: OpmlOutline | OpmlOutline[];
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function toBullet(o: OpmlOutline): Bullet {
  const b: Bullet = { id: newId(), text: (o["@_text"] ?? "").trim(), children: asArray(o.outline).map(toBullet) };
  const note = o["@__note"];
  if (note && note.trim()) b.note = note.replace(/\r\n/g, "\n").trim();
  if (o["@__complete"] === "true") b.done = todayIso();
  return b;
}

/** Convert Workflowy-style OPML into Bullets (ids assigned). */
export function opmlToBullets(xml: string): Bullet[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    processEntities: true,
    htmlEntities: true,
    trimValues: false,
  });
  const doc = parser.parse(xml);
  const body = doc?.opml?.body;
  if (!body) throw new Error("not an OPML document");
  return asArray<OpmlOutline>(body.outline).map(toBullet);
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { opmlToBullets } from "../src/opml.ts";

const XML = `<?xml version="1.0"?>
<opml version="2.0"><head><title>x</title></head><body>
  <outline text="Project &amp; Co">
    <outline text="Task one" _note="line one&#10;line two" />
    <outline text="Done task" _complete="true" />
    <outline text="Nested">
      <outline text="Deep" />
    </outline>
  </outline>
  <outline text="Second root" />
</body></opml>`;

test("opmlToBullets", () => {
  const bs = opmlToBullets(XML);
  assert.equal(bs.length, 2);
  assert.equal(bs[0].text, "Project & Co");
  assert.equal(bs[0].children[0].note, "line one\nline two");
  assert.match(bs[0].children[1].done!, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(bs[0].children[2].children[0].text, "Deep");
  assert.match(bs[1].id, /^[0-9a-z]{8}$/);
});

test("rejects non-opml", () => {
  assert.throws(() => opmlToBullets("<html></html>"));
});

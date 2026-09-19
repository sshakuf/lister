import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOutline, serializeOutline } from "../src/outline.ts";
import { mergeOutlines } from "../src/merge.ts";

const P = (t: string) => parseOutline(t, "/x/t.lister").file;
const BASE = `# T [id:aaaaaaaa]
- one [id:c0000001]
  - one-a [id:c0000002]
- two [id:c0000003]
`;

test("disjoint edits both survive", () => {
  const mine = P(BASE.replace("- one ", "- ONE "));
  const theirs = P(BASE.replace("- two ", "- TWO "));
  const out = serializeOutline(mergeOutlines(P(BASE), mine, theirs));
  assert.match(out, /- ONE \[id:c0000001\]/);
  assert.match(out, /- TWO \[id:c0000003\]/);
});

test("mine adds child while theirs edits sibling", () => {
  const mine = P(BASE.replace("- two [id:c0000003]\n", "- two [id:c0000003]\n  - new [id:c0000009]\n"));
  const theirs = P(BASE.replace("- one-a ", "- one-A "));
  const out = serializeOutline(mergeOutlines(P(BASE), mine, theirs));
  assert.match(out, /- one-A /);
  assert.match(out, /- two \[id:c0000003\]\n  - new \[id:c0000009\]/);
});

test("same-bullet conflict takes theirs", () => {
  const mine = P(BASE.replace("- one ", "- mine "));
  const theirs = P(BASE.replace("- one ", "- theirs "));
  const out = serializeOutline(mergeOutlines(P(BASE), mine, theirs));
  assert.match(out, /- theirs \[id:c0000001\]/);
  assert.doesNotMatch(out, /- mine /);
});

test("mine deletes, theirs untouched -> deleted", () => {
  const mine = P(BASE.replace("- two [id:c0000003]\n", ""));
  const out = serializeOutline(mergeOutlines(P(BASE), mine, P(BASE)));
  assert.doesNotMatch(out, /c0000003/);
});

test("theirs deletes, mine edits -> theirs wins (deleted)", () => {
  const mine = P(BASE.replace("- two ", "- edited "));
  const theirs = P(BASE.replace("- two [id:c0000003]\n", ""));
  const out = serializeOutline(mergeOutlines(P(BASE), mine, theirs));
  assert.doesNotMatch(out, /c0000003/);
});

test("new in mine with parent gone lands at root end", () => {
  const mine = P(BASE.replace("- two [id:c0000003]\n", "- two [id:c0000003]\n  - new [id:c0000009]\n"));
  const theirs = P(BASE.replace("- two [id:c0000003]\n", ""));
  const f = mergeOutlines(P(BASE), mine, theirs);
  assert.equal(f.bullets[f.bullets.length - 1].id, "c0000009");
});

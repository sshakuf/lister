import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSegments, serializeSegments, splitMetadata, joinMetadata } from "../src/annotations.ts";

test("parseSegments basic", () => {
  const segs = parseSegments("hi [bold:there] x");
  assert.deepEqual(segs, [
    { kind: "text", text: "hi " },
    { kind: "annotation", kinds: ["bold"], value: "there", raw: "[bold:there]" },
    { kind: "text", text: " x" },
  ]);
});

test("combined kinds and flag form", () => {
  const segs = parseSegments("[bold,red:hot] [done]");
  assert.equal(segs[0].kind, "annotation");
  assert.deepEqual((segs[0] as any).kinds, ["bold", "red"]);
  assert.equal((segs[2] as any).value, null);
});

test("escapes round-trip", () => {
  const line = "a \\[not\\] b [code:x\\]y]";
  const segs = parseSegments(line);
  assert.deepEqual(segs, [
    { kind: "text", text: "a [not] b " },
    { kind: "annotation", kinds: ["code"], value: "x]y", raw: "[code:x\\]y]" },
  ]);
  assert.equal(serializeSegments(segs), line);
});

test("unterminated and nested brackets are literal", () => {
  assert.deepEqual(parseSegments("a [b"), [{ kind: "text", text: "a [b" }]);
  // no nesting: the outer bracket becomes literal, the inner annotation parses
  assert.deepEqual(parseSegments("[bold:[red:x]]"), [
    { kind: "text", text: "[bold:" },
    { kind: "annotation", kinds: ["red"], value: "x", raw: "[red:x]" },
    { kind: "text", text: "]" },
  ]);
  assert.deepEqual(parseSegments("arr[0]"), [{ kind: "text", text: "arr[0]" }]);
});

test("splitMetadata pulls metadata out and keeps inline annotations", () => {
  const { text, meta } = splitMetadata("Fix login [id:abc12345] mid [date:2027-09-15] [bold:now]");
  assert.equal(text, "Fix login mid [bold:now]");
  assert.deepEqual(meta, { id: "abc12345", date: "2027-09-15" });
});

test("joinMetadata canonical order", () => {
  assert.equal(
    joinMetadata("Fix", { done: "2026-09-19", id: "abc12345", priority: "2" }),
    "Fix [id:abc12345] [priority:2] [done:2026-09-19]",
  );
  assert.equal(joinMetadata("", { id: "abc12345" }), "[id:abc12345]");
  assert.equal(joinMetadata("x", { done: true }), "x [done]");
});

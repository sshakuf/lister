import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import { newId, isValidId } from "../src/ids.ts";
import { slugify, folderFilePath, expandHome, contractHome } from "../src/slug.ts";

test("newId is 8 chars of [0-9a-z] and unique", () => {
  const ids = new Set<string>();
  for (let i = 0; i < 1000; i++) {
    const id = newId();
    assert.match(id, /^[0-9a-z]{8}$/);
    assert.ok(isValidId(id));
    ids.add(id);
  }
  assert.equal(ids.size, 1000);
});

test("isValidId rejects bad input", () => {
  assert.equal(isValidId("ABCDEFGH"), false);
  assert.equal(isValidId("abc"), false);
  assert.equal(isValidId(12345678), false);
});

test("slugify", () => {
  assert.equal(slugify("Bugs & Ideas!"), "bugs-ideas");
  assert.equal(slugify(""), "untitled");
  assert.equal(slugify("   "), "untitled");
  assert.equal(slugify("Café"), "cafe");
  const long = slugify("a".repeat(59) + "-b" + "c".repeat(30));
  assert.ok(long.length <= 60);
  assert.ok(!long.endsWith("-"));
});

test("folderFilePath expands ~ and appends slug", () => {
  const p = folderFilePath("~/proj", "Bugs");
  assert.ok(p.startsWith(os.homedir()));
  assert.ok(p.endsWith("/proj/bugs.lister"));
});

test("expandHome / contractHome round trip", () => {
  assert.equal(contractHome(expandHome("~/x/y")), "~/x/y");
  assert.equal(expandHome("~"), os.homedir());
  assert.equal(contractHome("/tmp/z"), "/tmp/z");
});

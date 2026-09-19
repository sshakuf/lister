import { test } from "node:test";
import assert from "node:assert/strict";
import type { Bullet } from "../src/model.ts";
import { findBullet, insertBullet, removeBullet, updateBullet, moveBullet, pathTo, CycleError } from "../src/tree.ts";

const b = (id: string, children: Bullet[] = []): Bullet => ({ id, text: id, children });
const tree = () => [b("a1", [b("a2", [b("a3")])]), b("b1")];

test("findBullet", () => {
  const loc = findBullet(tree(), "a3")!;
  assert.equal(loc.bullet.id, "a3");
  assert.equal(loc.parent!.id, "a2");
  assert.equal(loc.index, 0);
  assert.equal(findBullet(tree(), "zz"), null);
});

test("insertBullet at root and under parent", () => {
  const t = insertBullet(tree(), null, 1, b("mid"));
  assert.deepEqual(t.map((x) => x.id), ["a1", "mid", "b1"]);
  const t2 = insertBullet(tree(), "a2", 99, b("tail"));
  assert.deepEqual(findBullet(t2, "a2")!.bullet.children.map((x) => x.id), ["a3", "tail"]);
  assert.throws(() => insertBullet(tree(), "nope", 0, b("x")));
});

test("removeBullet", () => {
  const { bullets, removed } = removeBullet(tree(), "a2");
  assert.equal(removed!.id, "a2");
  assert.equal(findBullet(bullets, "a3"), null);
  assert.equal(bullets[0].children.length, 0);
});

test("updateBullet sets and clears fields", () => {
  const t = updateBullet(tree(), "b1", { text: "new", date: "2027-01-01" });
  assert.equal(t[1].text, "new");
  const t2 = updateBullet(t, "b1", { date: undefined });
  assert.equal(t2[1].date, undefined);
});

test("moveBullet and cycle detection", () => {
  const t = moveBullet(tree(), "b1", "a3", 0);
  assert.equal(findBullet(t, "a3")!.bullet.children[0].id, "b1");
  assert.throws(() => moveBullet(tree(), "a1", "a3", 0), CycleError);
  assert.throws(() => moveBullet(tree(), "a1", "a1", 0), CycleError);
});

test("pathTo", () => {
  assert.deepEqual(pathTo(tree(), "a3").map((x) => x.id), ["a1", "a2", "a3"]);
  assert.deepEqual(pathTo(tree(), "zz"), []);
});

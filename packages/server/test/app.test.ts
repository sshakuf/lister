import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.ts";
import { Store } from "../src/store.ts";
import { Search } from "../src/search.ts";
import { Admin } from "../src/admin.ts";
import { buildApp } from "../src/app.ts";

async function setup(t: import("node:test").TestContext) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lister-app-"));
  const proj = path.join(home, "proj");
  fs.mkdirSync(proj);
  const store = new Store(loadConfig(home), { watch: false, debounceMs: 5 });
  const search = new Search();
  const admin = new Admin(store);
  const app = buildApp({ store, search, admin, webDist: "/nonexistent" });
  await app.ready();
  t.after(async () => {
    await app.close();
    await store.close();
  });
  const json = async (method: string, url: string, body?: unknown, headers?: Record<string, string>) => {
    const res = await app.inject({ method: method as any, url, payload: body as any, headers });
    return { status: res.statusCode, body: res.json() };
  };
  return { home, proj, store, app, json };
}

test("root, add, patch, search", async (t) => {
  const { json, store } = await setup(t);
  const root = await json("GET", "/api/root");
  assert.equal(root.status, 200);
  assert.equal(root.body.name, "Home");
  const add = await json("POST", "/api/bullets", { filePath: root.body.path, parentId: null, index: 0, text: "Write tests [priority:2]" });
  assert.equal(add.status, 200);
  assert.equal(add.body.priority, 2);
  const patch = await json("PATCH", `/api/bullets/${add.body.id}`, { text: "Write MORE tests", done: "2026-09-19" });
  assert.equal(patch.body.text, "Write MORE tests");
  assert.equal(patch.body.done, "2026-09-19");
  const s = await json("GET", "/api/search?q=more");
  assert.equal(s.body.hits.length, 1);
  assert.equal(s.body.hits[0].fileName, "Home");
  const missing = await json("GET", "/api/bullets/zzzzzzzz");
  assert.equal(missing.status, 404);
  await store.flush();
});

test("to-folder, admin folders, orphan adopt, slug collision 409", async (t) => {
  const { json, proj, home, store } = await setup(t);
  const root = (await json("GET", "/api/root")).body;
  const a = (await json("POST", "/api/bullets", { filePath: root.path, text: "Proj" })).body;
  await json("POST", "/api/bullets", { filePath: root.path, parentId: a.id, text: "child" });
  const tf = await json("POST", `/api/bullets/${a.id}/to-folder`, { folder: proj });
  assert.equal(tf.status, 200);
  assert.equal(tf.body.folder, proj);
  const b = (await json("POST", "/api/bullets", { filePath: root.path, text: "Proj" })).body;
  const dup = await json("POST", `/api/bullets/${b.id}/to-folder`, { folder: proj });
  assert.equal(dup.status, 409);
  fs.writeFileSync(path.join(proj, "stray.lister"), "# Stray\n- x\n");
  const rep = await json("GET", "/api/admin/folders");
  assert.equal(rep.body.folders.length, 1);
  assert.equal(rep.body.folders[0].status, "ok");
  assert.equal(rep.body.orphans.length, 1);
  assert.equal(rep.body.orphans[0].name, "Stray");
  const adopted = await json("POST", "/api/admin/adopt", { filePath: rep.body.orphans[0].filePath });
  assert.equal(adopted.status, 200);
  const rep2 = await json("GET", "/api/admin/folders");
  assert.equal(rep2.body.orphans.length, 0);
  assert.equal(rep2.body.folders.length, 2);
  await store.flush();
  const rootTxt = fs.readFileSync(path.join(home, ".lister", "root.lister"), "utf8");
  assert.match(rootTxt, /- Recovered \[id:[0-9a-z]{8}\]\n  - Stray \[id:[0-9a-z]{8}\] \[folder:/);
  // search spans files
  const s = await json("GET", "/api/search?q=child");
  assert.equal(s.body.hits.length, 1);
  assert.equal(s.body.hits[0].fileName, "Proj");
});

test("fs dirs and opml import", async (t) => {
  const { json, home } = await setup(t);
  const dirs = await json("GET", `/api/fs/dirs?path=${encodeURIComponent(home + "/pr")}`);
  assert.deepEqual(dirs.body.dirs.map((d: string) => path.basename(d)), ["proj"]);
  const xml = `<opml version="2.0"><body><outline text="A"><outline text="B" _complete="true"/></outline></body></opml>`;
  const imp = await json("POST", "/api/import/opml", xml, { "content-type": "text/xml" });
  assert.equal(imp.status, 200);
  assert.equal(imp.body.imported, 1);
  const root = (await json("GET", "/api/root")).body;
  assert.equal(root.bullets[0].text, "A");
  assert.ok(root.bullets[0].children[0].done);
});

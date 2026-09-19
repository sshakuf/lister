import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.ts";
import { Store } from "../src/store.ts";

function tmpHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lister-"));
  const proj = path.join(home, "proj");
  fs.mkdirSync(proj);
  return { home, proj };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("root is created on first access and persists mutations", async (t) => {
  const { home } = tmpHome();
  const store = new Store(loadConfig(home), { watch: false, debounceMs: 5 });
  t.after(() => store.close());
  const root = await store.root();
  assert.equal(root.name, "Home");
  const b = await store.addBullet(root.path, null, 0, "First [date:2027-01-02] [priority:1]");
  assert.equal(b.text, "First");
  assert.equal(b.date, "2027-01-02");
  await store.patchBullet(b.id, { text: "First!" });
  const c = await store.addBullet(root.path, b.id, 0, "child");
  await store.flush();
  const txt = fs.readFileSync(root.path, "utf8");
  assert.match(txt, /^# Home \[id:[0-9a-z]{8}\]\n- First! \[id:/);
  assert.match(txt, /\[date:2027-01-02\] \[priority:1\]\n  - child \[id:/);
  await store.moveBulletTo(c.id, root.path, null, 0);
  await store.deleteBullet(b.id);
  await store.flush();
  const txt2 = fs.readFileSync(root.path, "utf8");
  assert.match(txt2, /- child/);
  assert.doesNotMatch(txt2, /First!/);
  await store.close();
});

test("toFolder creates an Outline File and inline reverses it", async (t) => {
  const { home, proj } = tmpHome();
  const store = new Store(loadConfig(home), { watch: false, debounceMs: 5 });
  t.after(() => store.close());
  const root = await store.root();
  const bugs = await store.addBullet(root.path, null, 0, "Bugs & Ideas");
  await store.addBullet(root.path, bugs.id, 0, "login broken");
  const fb = await store.toFolder(bugs.id, proj);
  assert.equal(fb.folder, proj);
  await store.flush();
  const childPath = path.join(proj, "bugs-ideas.lister");
  assert.ok(fs.existsSync(childPath));
  const childTxt = fs.readFileSync(childPath, "utf8");
  assert.equal(childTxt.split("\n")[0], `# Bugs & Ideas [id:${bugs.id}] [parent:${root.id}]`);
  assert.match(childTxt, /- login broken \[id:/);
  const rootTxt = fs.readFileSync(root.path, "utf8");
  assert.match(rootTxt, /- Bugs & Ideas \[id:[0-9a-z]{8}\] \[folder:.*proj\]\n$/);
  assert.doesNotMatch(rootTxt, /login broken/);

  // collision
  const other = await store.addBullet(root.path, null, 1, "Bugs & Ideas");
  await assert.rejects(() => store.toFolder(other.id, proj), /already exists/);

  // rename renames the file
  await store.patchBullet(bugs.id, { text: "Bugs" });
  await store.flush();
  assert.ok(fs.existsSync(path.join(proj, "bugs.lister")));
  assert.ok(!fs.existsSync(childPath));

  // inline
  const back = await store.inline(bugs.id);
  assert.equal(back.folder, undefined);
  assert.equal(back.children[0].text, "login broken");
  await store.flush();
  assert.ok(!fs.existsSync(path.join(proj, "bugs.lister")));
  assert.equal(fs.readdirSync(path.join(home, ".lister", "trash")).length, 1);
  await store.close();
});

test("locate walks unloaded folder files from root", async () => {
  const { home, proj } = tmpHome();
  const cfg = loadConfig(home);
  let store = new Store(cfg, { watch: false, debounceMs: 5 });
  const root = await store.root();
  const b = await store.addBullet(root.path, null, 0, "Proj");
  const kid = await store.addBullet(root.path, b.id, 0, "deep");
  await store.toFolder(b.id, proj);
  await store.close();
  store = new Store(cfg, { watch: false, debounceMs: 5 });
  const loc = await store.locate(kid.id);
  assert.equal(loc.bullet.text, "deep");
  assert.equal(loc.file.path, path.join(proj, "proj.lister"));
  await store.close();
});

test("external edit merges with unflushed in-memory edit", async () => {
  const { home } = tmpHome();
  const store = new Store(loadConfig(home), { watch: false, debounceMs: 5 });
  const root = await store.root();
  const a = await store.addBullet(root.path, null, 0, "alpha");
  const b = await store.addBullet(root.path, null, 1, "beta");
  await store.flush();
  // in-memory edit, not flushed
  const slow = new Store(loadConfig(home), { watch: false, debounceMs: 10_000 });
  await slow.root();
  await slow.patchBullet(a.id, { text: "ALPHA" });
  // agent appends a line on disk
  fs.appendFileSync(root.path, "- gamma\n");
  await slow.externalChange(root.path);
  await slow.flushFile(root.path);
  const txt = fs.readFileSync(root.path, "utf8");
  assert.match(txt, /- ALPHA \[id:/);
  assert.match(txt, new RegExp(`- beta \\[id:${b.id}\\]`));
  assert.match(txt, /- gamma \[id:[0-9a-z]{8}\]/);
  await slow.close();
  await store.close();
});

test("watcher picks up external change", async (t) => {
  const { home } = tmpHome();
  const changed: string[] = [];
  const store = new Store(loadConfig(home), { debounceMs: 5, onChange: (p) => changed.push(p) });
  t.after(() => store.close());
  const root = await store.root();
  await store.flush();
  await sleep(150);
  changed.length = 0;
  fs.appendFileSync(root.path, "- from agent\n");
  for (let i = 0; i < 60 && !changed.length; i++) await sleep(50);
  assert.ok(changed.length > 0, "onChange fired");
  const f = await store.root();
  assert.ok(f.bullets.some((b) => b.text === "from agent"), "merged external bullet");
  await store.flush();
  assert.match(fs.readFileSync(root.path, "utf8"), /- from agent \[id:[0-9a-z]{8}\]/);
  await store.close();
});

test("adoptFile registers an orphan", async (t) => {
  const { home, proj } = tmpHome();
  const store = new Store(loadConfig(home), { watch: false, debounceMs: 5 });
  t.after(() => store.close());
  const root = await store.root();
  const orphan = path.join(proj, "Ideas.lister");
  fs.writeFileSync(orphan, "- idea one\n");
  const fb = await store.adoptFile(orphan, null);
  await store.flush();
  assert.equal(fb.text, "Ideas");
  assert.ok(fs.existsSync(path.join(proj, "ideas.lister")));
  const rootTxt = fs.readFileSync(root.path, "utf8");
  assert.match(rootTxt, /- Ideas \[id:[0-9a-z]{8}\] \[folder:.*proj\]/);
  const child = fs.readFileSync(path.join(proj, "ideas.lister"), "utf8");
  assert.match(child, new RegExp(`^# Ideas \\[id:${fb.id}\\] \\[parent:${root.id}\\]`));
  await store.close();
});

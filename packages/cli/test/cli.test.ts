import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocalBackend } from "../src/local.ts";
import * as c from "../src/commands.ts";
import { installSkill } from "../src/skill.ts";
import { setupGitExcludes } from "../src/setup.ts";

function env() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lister-cli-"));
  const proj = path.join(home, "proj");
  fs.mkdirSync(proj);
  const lines: string[] = [];
  const backend = new LocalBackend(home);
  const ctx: c.Ctx = { backend, cwd: proj, out: (s) => lines.push(s) };
  return { home, proj, ctx, lines, backend };
}

test("list with no files, new, add, list, done, search", async (t) => {
  const { proj, ctx, lines, backend } = env();
  t.after(() => backend.close());
  await c.cmdList(ctx, {});
  assert.match(lines.join("\n"), /No Outline Files/);
  lines.length = 0;

  const fb = await c.cmdNew(ctx, "Bugs", {});
  assert.ok(fs.existsSync(path.join(proj, "bugs.lister")));
  await backend.store.flush();
  const rootTxt = fs.readFileSync(backend.cfg.rootFile, "utf8");
  assert.match(rootTxt, /- Recovered \[id:[0-9a-z]{8}\]\n  - Bugs \[id:[0-9a-z]{8}\] \[folder:.*proj\]/);

  const b = await c.cmdAdd(ctx, "Login broken [priority:1]", {});
  assert.equal(b.priority, 1);
  await c.cmdAdd(ctx, "child", { under: b.id });
  await backend.store.flush();
  const txt = fs.readFileSync(path.join(proj, "bugs.lister"), "utf8");
  assert.match(txt, /^# Bugs \[id:.*\]\n- Login broken \[id:.*\] \[priority:1\]\n  - child \[id:/);

  lines.length = 0;
  await c.cmdList(ctx, {});
  assert.match(lines.join("\n"), /## Bugs/);
  assert.match(lines.join("\n"), /- Login broken  \(!1\)  \[/);

  await c.cmdDone(ctx, b.id);
  await backend.store.flush();
  assert.match(fs.readFileSync(path.join(proj, "bugs.lister"), "utf8"), /\[done:\d{4}-\d{2}-\d{2}\]/);

  lines.length = 0;
  await c.cmdSearch(ctx, "login");
  assert.match(lines[0], /Bugs: Login broken/);

  // second file in same dir becomes a sibling of the first Folder Bullet
  const fb2 = await c.cmdNew(ctx, "Ideas", {});
  await backend.store.flush();
  const root2 = fs.readFileSync(backend.cfg.rootFile, "utf8");
  assert.match(root2, /  - Bugs .*\n  - Ideas \[id:/);
  void fb;
  void fb2;

  // ambiguous add
  await assert.rejects(() => c.cmdAdd(ctx, "x", {}), /several Outline Files/);
  const b3 = await c.cmdAdd(ctx, "x", { file: "ideas.lister" });
  assert.ok(b3.id);
});

test("admin folders and orphan adopt via CLI", async (t) => {
  const { proj, ctx, lines, backend } = env();
  t.after(() => backend.close());
  await c.cmdNew(ctx, "Bugs", {});
  fs.writeFileSync(path.join(proj, "notes.lister"), "- loose note\n");
  lines.length = 0;
  await c.cmdAdminFolders(ctx);
  const s = lines.join("\n");
  assert.match(s, /ok +\[[0-9a-z]{8}\] Bugs/);
  assert.match(s, /orphans \(1\)/);
  await c.cmdAdminAdopt(ctx, "notes.lister", {});
  lines.length = 0;
  await c.cmdAdminOrphans(ctx);
  assert.equal(lines[0], "no orphans");
});

test("skill install local writes claude, codex, generic and git exclude", async (t) => {
  const { home, proj } = env();
  fs.mkdirSync(path.join(proj, ".git"));
  const r = await installSkill({ scope: "local", agents: ["claude", "codex", "generic"], cwd: proj, home });
  assert.ok(fs.existsSync(path.join(proj, ".claude", "skills", "lister", "SKILL.md")));
  assert.match(fs.readFileSync(path.join(proj, ".claude", "skills", "lister", "SKILL.md"), "utf8"), /^---\nname: lister\n/);
  assert.match(fs.readFileSync(path.join(proj, "AGENTS.md"), "utf8"), /lister-skill:start/);
  assert.ok(fs.existsSync(path.join(proj, "LISTER.md")));
  assert.equal(r.excluded, path.join(proj, ".git", "info", "exclude"));
  assert.match(fs.readFileSync(r.excluded!, "utf8"), /^\*\.lister$/m);
  // idempotent codex upsert
  await installSkill({ scope: "local", agents: ["codex"], cwd: proj, home });
  const agents = fs.readFileSync(path.join(proj, "AGENTS.md"), "utf8");
  assert.equal(agents.split("lister-skill:start").length, 2);
  // global
  await installSkill({ scope: "global", agents: ["claude"], cwd: proj, home });
  assert.ok(fs.existsSync(path.join(home, ".claude", "skills", "lister", "SKILL.md")));
});

test("setup writes global git excludes (no git invocation)", async () => {
  const { home } = env();
  const r = await setupGitExcludes({ home, git: false });
  assert.equal(r.excludesFile, path.join(home, ".config", "git", "ignore"));
  assert.equal(r.added, true);
  const again = await setupGitExcludes({ home, git: false });
  assert.equal(again.added, false);
  assert.equal(fs.readFileSync(r.excludesFile, "utf8"), "*.lister\n");
});

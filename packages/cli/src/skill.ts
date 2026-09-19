import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

export type AgentKind = "claude" | "codex" | "generic";
export const ALL_AGENTS: AgentKind[] = ["claude", "codex", "generic"];

const MARK_START = "<!-- lister-skill:start -->";
const MARK_END = "<!-- lister-skill:end -->";

/** The Skill document shipped with the CLI. */
export async function skillDocument(): Promise<string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.join(here, "LISTER-SKILL.md"), path.resolve(here, "../../../skill/LISTER-SKILL.md")];
  for (const c of candidates) if (fs.existsSync(c)) return fsp.readFile(c, "utf8");
  throw new Error("LISTER-SKILL.md not found next to the CLI");
}

export interface InstallOpts {
  scope: "global" | "local";
  agents: AgentKind[];
  cwd: string;
  home?: string;
}

export interface InstallResult {
  written: string[];
  excluded?: string;
}

export async function installSkill(opts: InstallOpts): Promise<InstallResult> {
  const home = opts.home ?? os.homedir();
  const doc = await skillDocument();
  const written: string[] = [];
  for (const agent of opts.agents) {
    if (agent === "claude") {
      const dir = opts.scope === "global" ? path.join(home, ".claude", "skills", "lister") : path.join(opts.cwd, ".claude", "skills", "lister");
      await fsp.mkdir(dir, { recursive: true });
      const target = path.join(dir, "SKILL.md");
      await fsp.writeFile(target, claudeFrontmatter() + doc);
      written.push(target);
    } else if (agent === "codex") {
      const target = opts.scope === "global" ? path.join(home, ".codex", "AGENTS.md") : path.join(opts.cwd, "AGENTS.md");
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await upsertSection(target, doc);
      written.push(target);
    } else {
      const target = opts.scope === "global" ? path.join(home, ".lister", "LISTER.md") : path.join(opts.cwd, "LISTER.md");
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, doc);
      written.push(target);
    }
  }
  let excluded: string | undefined;
  if (opts.scope === "local") excluded = (await addLocalGitExclude(opts.cwd)) ?? undefined;
  return { written, excluded };
}

function claudeFrontmatter(): string {
  return `---
name: lister
description: Read and edit Lister outline files (*.lister) found in the current project directory; use when the user mentions their lister bullets, todo outline, or asks to record notes/tasks for this project.
---

`;
}

async function upsertSection(target: string, doc: string): Promise<void> {
  const block = `${MARK_START}\n${doc.trim()}\n${MARK_END}\n`;
  let existing = "";
  if (fs.existsSync(target)) existing = await fsp.readFile(target, "utf8");
  const s = existing.indexOf(MARK_START);
  const e = existing.indexOf(MARK_END);
  let next: string;
  if (s >= 0 && e > s) next = existing.slice(0, s) + block + existing.slice(e + MARK_END.length).replace(/^\n/, "");
  else next = existing ? existing.replace(/\n*$/, "\n\n") + block : block;
  await fsp.writeFile(target, next);
}

/** Add `*.lister` to <repo>/.git/info/exclude when cwd is inside a git repo. Returns the exclude path or null. */
export async function addLocalGitExclude(cwd: string): Promise<string | null> {
  let d = cwd;
  while (true) {
    const gitDir = path.join(d, ".git");
    if (fs.existsSync(gitDir) && fs.statSync(gitDir).isDirectory()) {
      const infoDir = path.join(gitDir, "info");
      await fsp.mkdir(infoDir, { recursive: true });
      const exclude = path.join(infoDir, "exclude");
      await appendLineOnce(exclude, "*.lister");
      return exclude;
    }
    const parent = path.dirname(d);
    if (parent === d) return null;
    d = parent;
  }
}

export async function appendLineOnce(file: string, line: string): Promise<boolean> {
  let existing = "";
  if (fs.existsSync(file)) existing = await fsp.readFile(file, "utf8");
  if (existing.split(/\r?\n/).some((l) => l.trim() === line)) return false;
  const sep = existing && !existing.endsWith("\n") ? "\n" : "";
  await fsp.writeFile(file, existing + sep + line + "\n");
  return true;
}

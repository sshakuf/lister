import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendLineOnce } from "./skill.js";

const execFileP = promisify(execFile);

export interface SetupResult {
  excludesFile: string;
  added: boolean;
  configuredGit: boolean;
}

/** Ensure `*.lister` is in git's global excludes file so Outline Files never enter any repo. */
export async function setupGitExcludes(opts: { home?: string; git?: boolean } = {}): Promise<SetupResult> {
  const home = opts.home ?? os.homedir();
  let excludesFile: string | null = null;
  let configuredGit = false;
  const useGit = opts.git !== false;
  if (useGit) {
    try {
      const { stdout } = await execFileP("git", ["config", "--global", "--get", "core.excludesFile"], { env: { ...process.env, HOME: home } });
      const v = stdout.trim();
      if (v) excludesFile = v.startsWith("~") ? path.join(home, v.slice(1)) : v;
    } catch {
      /* unset */
    }
  }
  if (!excludesFile) {
    const xdg = process.env.XDG_CONFIG_HOME && opts.home === undefined ? process.env.XDG_CONFIG_HOME : path.join(home, ".config");
    excludesFile = path.join(xdg, "git", "ignore");
    if (useGit) {
      try {
        await execFileP("git", ["config", "--global", "core.excludesFile", excludesFile], { env: { ...process.env, HOME: home } });
        configuredGit = true;
      } catch {
        /* git missing */
      }
    }
  }
  await fsp.mkdir(path.dirname(excludesFile), { recursive: true });
  if (!fs.existsSync(excludesFile)) await fsp.writeFile(excludesFile, "");
  const added = await appendLineOnce(excludesFile, "*.lister");
  return { excludesFile, added, configuredGit };
}

import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expandHome, contractHome } from "@lister/core";

/** Complete directory paths for the folder picker. `input` may be partial, e.g. `~/Dev/li`. */
export async function completeDirs(input: string, limit = 30): Promise<string[]> {
  const raw = input.trim() || "~/";
  const expanded = expandHome(raw);
  const endsWithSep = raw.endsWith("/") || raw === "~";
  const dir = endsWithSep ? expanded : path.dirname(expanded);
  const partial = endsWithSep ? "" : path.basename(expanded);
  let names: import("node:fs").Dirent[];
  try {
    names = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const showHidden = partial.startsWith(".");
  const out = names
    .filter((d) => d.isDirectory() || d.isSymbolicLink())
    .map((d) => d.name)
    .filter((n) => (showHidden || !n.startsWith(".")) && n.toLowerCase().startsWith(partial.toLowerCase()))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, limit)
    .map((n) => contractHome(path.join(dir, n)));
  return out;
}

export function homeDir(): string {
  return os.homedir();
}

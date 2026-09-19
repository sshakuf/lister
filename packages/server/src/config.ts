import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_PORT = 7433;

export interface Config {
  /** ~/.lister */
  listerDir: string;
  /** absolute path of the Root Outline file */
  rootFile: string;
  port: number;
  recentFolders: string[];
}

export interface ServerInfo {
  port: number;
  pid: number;
}

export function listerDirFor(home = os.homedir()): string {
  return path.join(home, ".lister");
}

export function loadConfig(home = os.homedir()): Config {
  const listerDir = listerDirFor(home);
  fs.mkdirSync(listerDir, { recursive: true });
  const cfgPath = path.join(listerDir, "config.json");
  let raw: Partial<Config> = {};
  if (fs.existsSync(cfgPath)) {
    try {
      raw = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    } catch {
      raw = {};
    }
  }
  const cfg: Config = {
    listerDir,
    rootFile: raw.rootFile ? expand(raw.rootFile, home) : path.join(listerDir, "root.lister"),
    port: typeof raw.port === "number" ? raw.port : DEFAULT_PORT,
    recentFolders: Array.isArray(raw.recentFolders) ? raw.recentFolders.slice(0, 20) : [],
  };
  return cfg;
}

export function saveConfig(cfg: Config): void {
  const cfgPath = path.join(cfg.listerDir, "config.json");
  const out = { rootFile: cfg.rootFile, port: cfg.port, recentFolders: cfg.recentFolders };
  fs.writeFileSync(cfgPath, JSON.stringify(out, null, 2) + "\n");
}

export function rememberFolder(cfg: Config, folder: string): void {
  cfg.recentFolders = [folder, ...cfg.recentFolders.filter((f) => f !== folder)].slice(0, 20);
  saveConfig(cfg);
}

function expand(p: string, home: string): string {
  if (p === "~") return home;
  if (p.startsWith("~/")) return path.join(home, p.slice(2));
  return path.resolve(p);
}

export function serverInfoPath(listerDir: string): string {
  return path.join(listerDir, "server.json");
}

export function readServerInfo(listerDir: string): ServerInfo | null {
  const p = serverInfoPath(listerDir);
  if (!fs.existsSync(p)) return null;
  try {
    const info = JSON.parse(fs.readFileSync(p, "utf8"));
    if (typeof info.port === "number" && typeof info.pid === "number") return info;
  } catch {
    /* ignore */
  }
  return null;
}

export function writeServerInfo(listerDir: string, info: ServerInfo): void {
  fs.writeFileSync(serverInfoPath(listerDir), JSON.stringify(info) + "\n");
}

export function removeServerInfo(listerDir: string): void {
  try {
    fs.unlinkSync(serverInfoPath(listerDir));
  } catch {
    /* ignore */
  }
}

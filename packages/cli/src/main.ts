#!/usr/bin/env node
import { installHiveCommands } from "./hive.js";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { Command } from "commander";
import { contractHome } from "@lister/core";
import { readServerInfo, listerDirFor, loadConfig, saveConfig } from "@lister/server";
import type { Backend } from "./backend.js";
import { LocalBackend } from "./local.js";
import { RemoteBackend, findServer } from "./remote.js";
import * as c from "./commands.js";
import { installSkill, ALL_AGENTS, type AgentKind } from "./skill.js";
import { setupGitExcludes } from "./setup.js";

const program = new Command();
program.name("lister").description("Plain-text outliner whose lists live inside your project directories").version("0.1.0");
program.option("--local", "operate on files directly even if a server is running");

const out = (s: string) => console.log(s);

async function withBackend<T>(fn: (ctx: c.Ctx) => Promise<T>): Promise<T> {
  const forceLocal = program.opts().local as boolean | undefined;
  const base = forceLocal ? null : await findServer();
  const backend: Backend = base ? new RemoteBackend(base) : new LocalBackend();
  const ctx: c.Ctx = { backend, cwd: process.cwd(), out };
  try {
    return await fn(ctx);
  } finally {
    await backend.close();
  }
}

function run(fn: (ctx: c.Ctx) => Promise<unknown>) {
  return async () => {
    try {
      await withBackend(fn);
    } catch (err: any) {
      console.error(`error: ${err.message ?? err}`);
      process.exitCode = 1;
    }
  };
}

program
  .command("list")
  .description("show Outline Files in the current directory")
  .option("-r, --recursive", "include subdirectories")
  .option("-a, --all", "every Outline File reachable from the Root Outline")
  .option("--no-ids", "hide bullet ids")
  .action((opts) => run((ctx) => c.cmdList(ctx, opts))());

program
  .command("add <text>")
  .description("add a bullet (text may include [date:..] [priority:..] annotations)")
  .option("-f, --file <path>", "target Outline File")
  .option("-u, --under <id>", "parent bullet id")
  .option("-i, --index <n>", "position among siblings", (v) => Number(v))
  .action((text, opts) => run((ctx) => c.cmdAdd(ctx, text, opts))());

program.command("done <id>").description("mark a bullet done").option("--undo", "reopen").action((id, opts) => run((ctx) => c.cmdDone(ctx, id, !!opts.undo))());
program.command("edit <id> <text>").description("replace a bullet's text").action((id, text) => run((ctx) => c.cmdEdit(ctx, id, text))());
program.command("rm <id>").description("remove a bullet (Folder Bullets are detached, file kept)").action((id) => run((ctx) => c.cmdRm(ctx, id))());
program.command("show <id>").description("show one bullet with its subtree").action((id) => run((ctx) => c.cmdShow(ctx, id))());

program
  .command("new <name>")
  .description("create an Outline File here and register its Folder Bullet")
  .option("-d, --dir <dir>", "directory (default: cwd)")
  .option("-u, --under <id>", "parent bullet id (default: beside existing Folder Bullets for this directory, else Recovered)")
  .action((name, opts) => run((ctx) => c.cmdNew(ctx, name, opts))());

program.command("search <query>").description("search bullet text across all Outline Files").action((q) => run((ctx) => c.cmdSearch(ctx, q))());

const admin = program.command("admin").description("manage Folder Bullets and Outline Files");
admin.command("folders").description("list Folder Bullets, broken ones, and orphans").action(() => run((ctx) => c.cmdAdminFolders(ctx))());
admin.command("orphans").description("list Outline Files no Folder Bullet references").action(() => run((ctx) => c.cmdAdminOrphans(ctx))());
admin.command("adopt <file>").description("register an orphan file").option("-u, --under <id>").action((f, o) => run((ctx) => c.cmdAdminAdopt(ctx, f, o))());
admin.command("move <id> <dir>").description("move a Folder Bullet's file to another directory").action((id, d) => run((ctx) => c.cmdAdminMove(ctx, id, d))());
admin.command("relink <id> <file>").description("point a broken Folder Bullet at an existing file").action((id, f) => run((ctx) => c.cmdAdminRelink(ctx, id, f))());
admin.command("trash <file>").description("move an Outline File to ~/.lister/trash and detach its Folder Bullet").action((f) => run((ctx) => c.cmdAdminTrash(ctx, f))());

program.command("import <file.opml>").description("import a Workflowy OPML export").option("-u, --under <id>").action((f, o) => run((ctx) => c.cmdImport(ctx, f, o))());

const skill = program.command("skill").description("agent skill management");
skill
  .command("install")
  .description("install the Lister skill for agents")
  .option("-g, --global", "install for the user (default)")
  .option("-l, --local", "install into the current project")
  .option("--agent <kinds...>", "claude, codex, generic, all (default: all)")
  .action(async (opts) => {
    const scope = opts.local ? "local" : "global";
    const kinds: AgentKind[] = !opts.agent || opts.agent.includes("all") ? ALL_AGENTS : opts.agent;
    const r = await installSkill({ scope, agents: kinds, cwd: process.cwd() });
    for (const w of r.written) out(`wrote ${contractHome(w)}`);
    if (r.excluded) out(`added *.lister to ${contractHome(r.excluded)}`);
    if (scope === "global") out(`tip: run \`lister setup\` once so *.lister stays out of every git repo`);
  });

program
  .command("setup")
  .description("keep *.lister out of git everywhere via the global excludes file")
  .action(async () => {
    const r = await setupGitExcludes();
    out(`${r.added ? "added" : "already present:"} *.lister in ${contractHome(r.excludesFile)}${r.configuredGit ? " (set as git core.excludesFile)" : ""}`);
  });

program
  .command("serve")
  .description("run the lister server")
  .option("-p, --port <n>", "port", (v) => Number(v))
  .option("-H, --host <addr>", "interface to bind: 127.0.0.1 (default), 0.0.0.0, or e.g. your Tailscale IP. Persist with `lister config set host <addr>`")
  .option("-d, --daemon", "run detached in the background")
  .action(async (opts) => {
    if (opts.daemon) {
      const pid = await startDaemon(opts.port, opts.host);
      out(`lister server started in background (pid ${pid})`);
      return;
    }
    const { startServer } = await import("@lister/server");
    const srv = await startServer({ port: opts.port, host: opts.host });
    out(`lister server listening on http://${srv.host}:${srv.port}`);
    if (srv.host !== "127.0.0.1") out(`note: standalone mode has no authentication; hive mode requires remote credentials. Only bind to trusted networks.`);
    const stop = async () => {
      await srv.close();
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });

program
  .command("open")
  .description("start the server if needed and open the web app")
  .action(async () => {
    let base = await findServer();
    if (!base) {
      await startDaemon();
      for (let i = 0; i < 40 && !base; i++) {
        await new Promise((r) => setTimeout(r, 100));
        base = await findServer();
      }
    }
    if (!base) {
      console.error("error: server did not start");
      process.exitCode = 1;
      return;
    }
    out(base);
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    spawn(opener, [base], { stdio: "ignore", detached: true }).unref();
  });

const config = program.command("config").description("read or set ~/.lister/config.json values");
config
  .command("get [key]")
  .description("show config (or one key: host, port, rootFile)")
  .action((key?: string) => {
    const cfg = loadConfig();
    const view: Record<string, unknown> = { rootFile: contractHome(cfg.rootFile), port: cfg.port, host: cfg.host };
    if (key) out(String(view[key] ?? ""));
    else for (const [k, v] of Object.entries(view)) out(`${k}: ${v}`);
  });
config
  .command("set <key> <value>")
  .description("set host, port, or rootFile; restart the server to apply")
  .action((key: string, value: string) => {
    const cfg = loadConfig();
    if (key === "host") cfg.host = value;
    else if (key === "port") cfg.port = Number(value);
    else if (key === "rootFile") cfg.rootFile = path.resolve(value.replace(/^~(?=$|\/)/, os.homedir()));
    else {
      console.error(`error: unknown key ${key} (host, port, rootFile)`);
      process.exitCode = 1;
      return;
    }
    saveConfig(cfg);
    out(`${key} = ${key === "rootFile" ? contractHome(cfg.rootFile) : value}  (restart the server: lister serve --daemon)`);
  });

program
  .command("status")
  .description("show server status and config")
  .action(async () => {
    const cfg = loadConfig();
    const info = readServerInfo(listerDirFor());
    const base = await findServer();
    out(`root:   ${contractHome(cfg.rootFile)}`);
    out(`host:   ${cfg.host}`);
    out(`server: ${base ? `running at ${base} (pid ${info?.pid}, bound to ${info?.host ?? "127.0.0.1"})` : "not running"}`);
  });

async function startDaemon(port?: number, host?: string): Promise<number> {
  const require = createRequire(import.meta.url);
  const serverMain = path.join(path.dirname(require.resolve("@lister/server")), "main.js");
  if (!fs.existsSync(serverMain)) throw new Error(`server entry not found at ${serverMain}; run pnpm build`);
  const args = [serverMain, ...(port ? ["--port", String(port)] : []), ...(host ? ["--host", host] : [])];
  const logDir = listerDirFor();
  fs.mkdirSync(logDir, { recursive: true });
  const log = fs.openSync(path.join(logDir, "server.log"), "a");
  const child = spawn(process.execPath, args, { detached: true, stdio: ["ignore", log, log] });
  child.unref();
  return child.pid ?? -1;
}

installHiveCommands(program);
await program.parseAsync(process.argv);

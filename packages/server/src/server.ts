import path from "node:path";
import { HiveAgent } from "./hive/agent.js";
import { loadConfig, writeServerInfo, removeServerInfo, type Config } from "./config.js";
import { Store } from "./store.js";
import { Search } from "./search.js";
import { Admin } from "./admin.js";
import { buildApp } from "./app.js";

export interface RunningServer {
  port: number;
  host: string;
  cfg: Config;
  close(): Promise<void>;
}

export async function startServer(opts: { home?: string; port?: number; host?: string; logger?: boolean; webDist?: string } = {}): Promise<RunningServer> {
  const cfg = loadConfig(opts.home);
  if (opts.port) cfg.port = opts.port;
  if (opts.host) cfg.host = opts.host;
  const hive = new HiveAgent(path.join(cfg.listerDir, "hive"));
  const search = new Search();
  let app: ReturnType<typeof buildApp> | null = null;
  const store = new Store(cfg, {
    onChange: async (p) => {
      if (store.isLoaded(p)) search.index(await store.file(p));
      else search.remove(p);
      app?.broadcast({ type: "file.changed", path: p });
    },
  });
  if (hive.enabled) await store.close();
  const admin = new Admin(store);
  app = buildApp({ store, search, admin, logger: opts.logger, webDist: opts.webDist, hive, onHiveEnable: () => store.close(), beforeHiveEnable: () => store.flush() });
  await app.listen({ port: cfg.port, host: cfg.host });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : cfg.port;
  writeServerInfo(cfg.listerDir, { port, pid: process.pid, host: cfg.host });
  const timer = setInterval(() => { void hive.tick().catch((e) => { hive.error = e.message; }); }, 1500);
  timer.unref();
  const close = async () => {
    clearInterval(timer);
    await hive.stop();
    removeServerInfo(cfg.listerDir);
    await store.close();
    await app!.close();
  };
  return { port, host: cfg.host, cfg, close };
}

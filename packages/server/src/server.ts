import { loadConfig, writeServerInfo, removeServerInfo, type Config } from "./config.js";
import { Store } from "./store.js";
import { Search } from "./search.js";
import { Admin } from "./admin.js";
import { buildApp } from "./app.js";

export interface RunningServer {
  port: number;
  cfg: Config;
  close(): Promise<void>;
}

export async function startServer(opts: { home?: string; port?: number; logger?: boolean; webDist?: string } = {}): Promise<RunningServer> {
  const cfg = loadConfig(opts.home);
  if (opts.port) cfg.port = opts.port;
  const search = new Search();
  let app: ReturnType<typeof buildApp> | null = null;
  const store = new Store(cfg, {
    onChange: async (p) => {
      if (store.isLoaded(p)) search.index(await store.file(p));
      else search.remove(p);
      app?.broadcast({ type: "file.changed", path: p });
    },
  });
  const admin = new Admin(store);
  app = buildApp({ store, search, admin, logger: opts.logger, webDist: opts.webDist });
  await app.listen({ port: cfg.port, host: "127.0.0.1" });
  const address = app.server.address();
  const port = typeof address === "object" && address ? address.port : cfg.port;
  writeServerInfo(cfg.listerDir, { port, pid: process.pid });
  const close = async () => {
    removeServerInfo(cfg.listerDir);
    await store.close();
    await app!.close();
  };
  return { port, cfg, close };
}

import type { HiveAgent } from "./hive/agent.js";
import { registerHiveRoutes } from "./hive/routes.js";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { opmlToBullets, isFolderBullet, contractHome } from "@lister/core";
import type { Store } from "./store.js";
import type { Search } from "./search.js";
import type { Admin } from "./admin.js";
import { HttpError, BadRequestError } from "./errors.js";
import { completeDirs } from "./fsdirs.js";

export interface AppDeps {
  store: Store;
  search: Search;
  admin: Admin;
  /** directory holding the built web client (index.html); optional */
  webDist?: string;
  logger?: boolean;
  hive?: HiveAgent;
  onHiveEnable?: () => Promise<void>;
  beforeHiveEnable?: () => Promise<void>;
}

type Socket = { send(data: string): void; readyState: number };

export function buildApp(deps: AppDeps): FastifyInstance & { broadcast(msg: object): void } {
  const { store, search, admin } = deps;
  const app = Fastify({ logger: deps.logger ?? false, bodyLimit: 16 * 1024 * 1024 });
  if (deps.hive) registerHiveRoutes(app, deps.hive, store.rootPath, deps.onHiveEnable ?? (async () => {}), deps.beforeHiveEnable);
  const sockets = new Set<Socket>();
  const broadcast = (msg: object) => {
    const data = JSON.stringify(msg);
    for (const s of sockets) if (s.readyState === 1) s.send(data);
  };

  app.setErrorHandler((error: unknown, _req, reply) => {
    const err = error as Error & { status?: number; validation?: unknown };
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message });
    if (err.validation) return reply.status(400).send({ error: err.message });
    if (err.name === "CycleError") return reply.status(400).send({ error: err.message });
    app.log.error(err);
    return reply.status(500).send({ error: err.message ?? "internal error" });
  });

  const reindex = async (filePath: string) => {
    if (store.isLoaded(filePath)) search.index(await store.file(filePath));
    else search.remove(filePath);
  };

  app.addHook("onReady", async () => {
    // index everything reachable
    if (deps.hive?.enabled) return;
    const { files } = await admin.allFiles();
    for (const f of files) search.index(f);
  });

  // ---- websocket ----
  app.register(websocket);
  app.register(async (inst) => {
    inst.get("/ws", { websocket: true }, (socket) => {
      sockets.add(socket as unknown as Socket);
      socket.on("close", () => sockets.delete(socket as unknown as Socket));
    });
  });

  // ---- outline ----
  app.get("/api/health", async () => ({ ok: true, pid: process.pid }));

  app.get("/api/root", async () => store.root());

  app.get<{ Querystring: { path: string } }>("/api/files", async (req) => {
    const p = req.query.path;
    if (!p) throw new BadRequestError("path required");
    return store.file(p);
  });

  app.get<{ Querystring: { path: string } }>("/api/files/reload", async (req) => {
    const p = req.query.path;
    if (!p) throw new BadRequestError("path required");
    await store.externalChange(path.resolve(p));
    return store.file(p);
  });

  app.post<{ Body: { filePath: string; parentId: string | null; index: number; text: string } }>(
    "/api/bullets",
    {
      schema: {
        body: {
          type: "object",
          required: ["filePath", "text"],
          properties: {
            filePath: { type: "string" },
            parentId: { type: ["string", "null"] },
            index: { type: "number" },
            text: { type: "string" },
          },
        },
      },
    },
    async (req) => {
      const { filePath, parentId = null, index = Number.MAX_SAFE_INTEGER, text } = req.body;
      const b = await store.addBullet(filePath, parentId, index, text);
      await reindex(path.resolve(filePath));
      return b;
    },
  );

  app.get<{ Params: { id: string } }>("/api/bullets/:id", async (req) => {
    const loc = await store.locate(req.params.id);
    return { bullet: loc.bullet, filePath: loc.file.path, fileName: loc.file.name, parentId: loc.parent?.id ?? null, index: loc.index };
  });

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>("/api/bullets/:id", async (req) => {
    const allowed = ["text", "note", "date", "priority", "done"];
    const patch: Record<string, unknown> = {};
    for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
    if (typeof patch.priority === "string") patch.priority = Number(patch.priority);
    const b = await store.patchBullet(req.params.id, patch as any);
    const loc = await store.locate(req.params.id);
    await reindex(loc.file.path);
    return b;
  });

  app.post<{ Params: { id: string }; Body: { filePath: string; parentId: string | null; index: number } }>(
    "/api/bullets/:id/move",
    async (req) => {
      const from = await store.locate(req.params.id);
      const { filePath, parentId = null, index = Number.MAX_SAFE_INTEGER } = req.body;
      await store.moveBulletTo(req.params.id, filePath, parentId, index);
      await reindex(from.file.path);
      await reindex(path.resolve(filePath));
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>("/api/bullets/:id", async (req) => {
    const loc = await store.locate(req.params.id);
    await store.deleteBullet(req.params.id);
    await reindex(loc.file.path);
    return { ok: true, detached: isFolderBullet(loc.bullet) };
  });

  app.post<{ Params: { id: string }; Body: { folder: string } }>("/api/bullets/:id/to-folder", async (req) => {
    if (!req.body?.folder) throw new BadRequestError("folder required");
    const b = await store.toFolder(req.params.id, req.body.folder);
    const loc = await store.locate(req.params.id);
    await reindex(loc.file.path);
    await reindex(store.folderFile(b));
    return b;
  });

  app.post<{ Params: { id: string } }>("/api/bullets/:id/inline", async (req) => {
    const loc = await store.locate(req.params.id);
    const fp = isFolderBullet(loc.bullet) ? store.folderFile(loc.bullet) : null;
    const b = await store.inline(req.params.id);
    if (fp) search.remove(fp);
    await reindex(loc.file.path);
    return b;
  });

  // ---- search ----
  app.get<{ Querystring: { q: string } }>("/api/search", async (req) => ({ hits: search.query(req.query.q ?? "") }));

  // ---- fs ----
  app.get<{ Querystring: { path?: string } }>("/api/fs/dirs", async (req) => ({ dirs: await completeDirs(req.query.path ?? "~/") }));
  app.get("/api/fs/recent", async () => ({ recent: store.cfg.recentFolders.map(contractHome) }));

  // ---- admin ----
  app.get("/api/admin/folders", async () => admin.report());
  app.post<{ Body: { id: string; folder: string } }>("/api/admin/move", async (req) => {
    const b = await store.moveFolder(req.body.id, req.body.folder);
    const loc = await store.locate(req.body.id);
    await reindex(loc.file.path);
    return b;
  });
  app.post<{ Body: { id: string; filePath: string } }>("/api/admin/relink", async (req) => {
    const b = await store.relink(req.body.id, req.body.filePath);
    await reindex(store.folderFile(b));
    return b;
  });
  app.post<{ Body: { filePath: string; parentId?: string } }>("/api/admin/adopt", async (req) => {
    const b = await admin.adopt(req.body.filePath, req.body.parentId);
    const loc = await store.locate(b.id);
    await reindex(loc.file.path);
    await reindex(store.folderFile(b));
    return b;
  });
  app.post<{ Body: { filePath: string } }>("/api/admin/trash", async (req) => {
    const r = await admin.trash(req.body.filePath);
    search.remove(path.resolve(req.body.filePath));
    return r;
  });

  // ---- import ----
  app.addContentTypeParser(["text/xml", "application/xml", "text/x-opml"], { parseAs: "string" }, (_req, body, done) => done(null, body));
  app.post<{ Querystring: { parentId?: string; filePath?: string }; Body: string }>("/api/import/opml", async (req) => {
    const xml = typeof req.body === "string" ? req.body : String(req.body ?? "");
    const bullets = opmlToBullets(xml);
    let filePath: string;
    let parentId: string | null = null;
    if (req.query.parentId) {
      const loc = await store.locate(req.query.parentId);
      if (isFolderBullet(loc.bullet)) filePath = store.folderFile(loc.bullet);
      else {
        filePath = loc.file.path;
        parentId = loc.bullet.id;
      }
    } else {
      filePath = req.query.filePath ? path.resolve(req.query.filePath) : store.rootPath;
    }
    await store.insertBullets(filePath, parentId, bullets);
    await reindex(filePath);
    return { imported: bullets.length, filePath };
  });

  // ---- static web ----
  const webDist = deps.webDist ?? defaultWebDist();
  if (webDist && fs.existsSync(path.join(webDist, "index.html"))) {
    app.register(fastifyStatic, { root: webDist, prefix: "/" });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.status(404).send({ error: "not found" });
      return reply.sendFile("index.html");
    });
  }

  return Object.assign(app, { broadcast });
}

function defaultWebDist(): string | undefined {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [path.resolve(here, "../../web/dist"), path.resolve(here, "../web-dist")];
    return candidates.find((c) => fs.existsSync(path.join(c, "index.html")));
  } catch {
    return undefined;
  }
}

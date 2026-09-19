#!/usr/bin/env node
import { startServer } from "./server.js";

const argValue = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const port = argValue("--port") ? Number(argValue("--port")) : undefined;
const host = argValue("--host");

const srv = await startServer({ port, host, logger: process.env.LISTER_LOG === "1" });
console.log(`lister server listening on http://${srv.host}:${srv.port}`);
const shutdown = async () => {
  await srv.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

#!/usr/bin/env node
import { startServer } from "./server.js";

const portArg = process.argv.indexOf("--port");
const port = portArg >= 0 ? Number(process.argv[portArg + 1]) : undefined;

const srv = await startServer({ port, logger: process.env.LISTER_LOG === "1" });
console.log(`lister server listening on http://127.0.0.1:${srv.port}`);
const shutdown = async () => {
  await srv.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

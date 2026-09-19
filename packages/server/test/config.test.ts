import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, saveConfig, clientHost } from "../src/config.ts";

test("host defaults to loopback, persists, and clientHost maps wildcard binds to loopback", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lister-cfg-"));
  const cfg = loadConfig(home);
  assert.equal(cfg.host, "127.0.0.1");
  cfg.host = "100.101.102.103";
  saveConfig(cfg);
  assert.equal(loadConfig(home).host, "100.101.102.103");
  assert.equal(clientHost("0.0.0.0"), "127.0.0.1");
  assert.equal(clientHost(undefined), "127.0.0.1");
  assert.equal(clientHost("100.101.102.103"), "100.101.102.103");
});

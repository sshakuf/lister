// iPhone emulation (touch taps) against a running Lister server. Creates two scratch bullets and removes them.
// Usage: PLAYWRIGHT_MODULE=/path/to/node_modules/playwright node e2e/ios-toolbar.cjs [baseUrl] [rootFile] [chromium|webkit]
// Needs `npx playwright install webkit` for the webkit engine.
const pw = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const engine = process.argv[4] === "webkit" ? pw.webkit : pw.chromium;
const { devices } = pw;
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const base = process.argv[2] || "http://127.0.0.1:7433";
const rootFile = process.argv[3] || path.join(os.homedir(), ".lister", "root.lister");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const disk = () => fs.readFileSync(rootFile, "utf8");
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

(async () => {
  const browser = await engine.launch();
  console.log("engine:", process.argv[4] === "webkit" ? "webkit" : "chromium");
  const { defaultBrowserType, ...iphone } = devices["iPhone 13"];
  const ctx = await browser.newContext({ ...iphone });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("console.error:", m.text()); });
  await page.goto(base + "/#/");
  await page.waitForSelector(".rows");
  await page.evaluate(() => localStorage.setItem("lister.zoom", "null"));

  // seed two scratch bullets through the API
  const root = await (await page.request.get(base + "/api/root")).json();
  const mk = async (text, parentId = null, index = 99) => (await (await page.request.post(base + "/api/bullets", { data: { filePath: root.path, parentId, index, text } })).json()).id;
  const a = await mk("e2e-alpha");
  const b = await mk("e2e-beta");
  await sleep(700);
  await page.reload();
  await page.waitForSelector(`[data-id="${b}"]`);

  // touch-only layout must be active
  check("touch layout active (toolbar rule applies, row-actions hidden)", await page.evaluate(() => getComputedStyle(document.querySelector(".row-actions")).display === "none"));

  // tap the text of beta to start editing
  await page.tap(`[data-id="${b}"] .content`);
  await page.waitForSelector(`[data-id="${b}"] textarea`, { timeout: 3000 }).catch(() => {});
  check("tap text starts editing", await page.evaluate((id) => document.activeElement === document.querySelector(`[data-id="${id}"] textarea`), b));
  check("toolbar visible", await page.isVisible(".edit-toolbar"));

  // tap Indent → beta under alpha
  await page.tap('.edit-toolbar [aria-label="Indent"]');
  await sleep(900);
  check("toolbar Indent nests beta under alpha", new RegExp(`- e2e-alpha \\[id:${a}\\]\\n  - e2e-beta`).test(disk()), disk().split("\n").filter(l => l.includes("e2e")).join(" / "));
  check("textarea still focused after Indent", await page.evaluate((id) => document.activeElement === document.querySelector(`[data-id="${id}"] textarea`), b));

  // tap Mark done
  await page.tap('.edit-toolbar [aria-label^="Mark done"]');
  await sleep(900);
  check("toolbar Done writes [done:]", new RegExp(`e2e-beta \\[id:${b}\\] \\[done:`).test(disk()));

  // tap Outdent → back to top level
  await page.tap('.edit-toolbar [aria-label="Outdent"]');
  await sleep(900);
  check("toolbar Outdent moves beta back to top level", new RegExp(`\\n- e2e-beta \\[id:${b}\\]`).test(disk()));

  // insert @ then type a date, space converts it
  await page.tap('.edit-toolbar [aria-label^="Insert date"]');
  await page.keyboard.type("15/9/27 ");
  await sleep(900);
  check("@ button + typed date sets [date:]", new RegExp(`e2e-beta \\[id:${b}\\] \\[date:2027-09-15\\]`).test(disk()), disk().split("\n").find(l => l.includes(b)));

  // more actions sheet → Strike through
  await page.tap('.edit-toolbar [aria-label="More actions"]');
  await sleep(300);
  check("sheet opens", await page.isVisible(".menu.sheet"));
  await page.tap('.menu.sheet button:has-text("Strike through")');
  await sleep(900);
  check("sheet Strike through applies [strike:]", /\[strike:e2e-beta/.test(disk()), disk().split("\n").find(l => l.includes(b)));

  // undo → strike removed
  await page.tap('.edit-toolbar [aria-label="Undo"]');
  await sleep(900);
  check("toolbar Undo removes strike", !/\[strike:e2e-beta/.test(disk()) && disk().includes("e2e-beta"), disk().split("\n").find(l => l.includes(b)));

  // hide keyboard
  await page.tap('.edit-toolbar [aria-label="Hide keyboard"]');
  await sleep(300);
  check("hide keyboard ends editing", !(await page.isVisible(".edit-toolbar")));

  // chevron / dot on the left: tap the dot zooms in
  await page.tap(`[data-id="${a}"] .dot`);
  await sleep(500);
  check("tap dot zooms into alpha", (await page.textContent(".zoom-title").catch(() => "")).includes("e2e-alpha"));

  await page.screenshot({ path: "/tmp/lister-ios.png" });

  // cleanup scratch bullets
  for (const id of [a, b]) await page.request.delete(`${base}/api/bullets/${id}`);
  await sleep(500);
  check("cleanup removed scratch bullets", !disk().includes("e2e-"));

  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

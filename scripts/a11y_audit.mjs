// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// A11Y-LOOP-1: render every public page from the site Worker in a headless browser at phone and desktop width and run axe-core.
// Fails on any serious or critical violation, on horizontal scroll, and on tap targets under 44px for links and buttons in main.
// Needs playwright (preinstalled in cloud sessions) and axe-core (npm i --no-save axe-core@4.10.2). Usage: node scripts/a11y_audit.mjs [--json]
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
const require = createRequire(process.cwd() + "/");
const { chromium } = require("playwright");
const axeSrc = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const mod = (await import(pathToFileURL(fileURLToPath(new URL("../site/worker.js", import.meta.url))).href)).default;
const ASSET = (f) => readFileSync(new URL("../site/assets/" + f, import.meta.url));
const ENV = { ASSETS: { get: async (k) => { const b = ASSET(k); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } } };
globalThis.fetch = async () => { throw new Error("offline"); };
const SH = JSON.parse(readFileSync(new URL("../doctrine/stakeholders.json", import.meta.url), "utf8"));
const PATHS = ["/", "/for", "/showcase", "/how", "/product", "/team", "/faq", "/contact", "/pilot", "/engineers",
  ...SH.audiences.map(a => "/for/" + a.id), ...SH.showcases.map(c => "/showcase/" + c.id)];
// the owner dashboard's public page, served from an in-memory database seeded like the dashboard tests
const dash = (await import(pathToFileURL(fileURLToPath(new URL("../dashboard/worker.js", import.meta.url))).href)).route;
const { DatabaseSync } = await import("node:sqlite");
function dashEnv() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../dashboard/schema.sql", import.meta.url), "utf8")); db.exec(readFileSync(new URL("../dashboard/seed.sql", import.meta.url), "utf8"));
  const wrap = sql => { let a = []; const o = { bind: (...x) => { a = x; return o; }, first: async () => db.prepare(sql).get(...a) || null, all: async () => ({ results: db.prepare(sql).all(...a) }), run: async () => { const r = db.prepare(sql).run(...a); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } }; } }; return o; };
  return { DB: { prepare: wrap }, NO_NET: 1 };
}
const render = async (p) => p === "/dashboard-owner" ? await dash(new Request("https://dashboard.ultrastable.io/"), dashEnv()) : await mod.fetch(new Request("https://ultrastable.io" + p), ENV);
PATHS.push("/dashboard-owner");
const browser = await chromium.launch();
const findings = [];
for (const [label, width] of [["phone", 375], ["desktop", 1280]]) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: "light" });
  for (const scheme of ["light", "dark"]) {
    const page = await ctx.newPage(); await page.emulateMedia({ colorScheme: scheme });
    for (const p of PATHS) {
      const res = await render(p);
      if (res.status !== 200) { findings.push({ p, label, scheme, rule: "status", detail: String(res.status) }); continue; }
      await page.setContent(await res.text(), { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(350); // let opacity transitions settle so contrast is read on the final state
      await page.addScriptTag({ content: axeSrc });
      const r = await page.evaluate(async () => await axe.run(document, { resultTypes: ["violations"] }));
      for (const v of r.violations) if (v.impact === "serious" || v.impact === "critical") findings.push({ p, label, scheme, rule: v.id, detail: v.nodes.slice(0, 2).map(n => n.target.join(" ")).join(" | ") });
      const m = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - window.innerWidth, small: [...document.querySelectorAll("main a, main button")].filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.height < 44 && getComputedStyle(e).display !== "inline"; }).map(e => (e.textContent || "").trim().slice(0, 30)) }));
      if (m.over > 1) findings.push({ p, label, scheme, rule: "horizontal-scroll", detail: m.over + "px" });
      if (m.small.length) findings.push({ p, label, scheme, rule: "tap-target<44", detail: m.small.slice(0, 4).join(" | ") });
    }
    await page.close();
  }
  await ctx.close();
}
await browser.close();
if (process.argv.includes("--json")) console.log(JSON.stringify(findings, null, 1));
else for (const f of findings) console.log(f.p, f.label, f.scheme, f.rule, f.detail);
console.log(findings.length ? "a11y-audit FAIL " + findings.length : "a11y-audit ok " + PATHS.length + " pages x 2 widths x 2 schemes");
process.exit(findings.length ? 1 : 0);

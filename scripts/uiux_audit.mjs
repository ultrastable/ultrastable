// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// UIUX-1: the browser half of the UI/UX manager loop (foundation/uiux.py reads what this writes).
//   node scripts/uiux_audit.mjs [--write] [--out FILE] [--rebaseline] [--live] [--no-axe] [--only /path,/path]
// Offline (default): renders every user page from the site Worker in-process (no network) in Chromium at phone and desktop width and runs
//   accessibility (axe, light and dark), the user/system boundary, page structure, copy, performance budgets, a visual fingerprint against
//   ops/uiux/baseline.json, and every user path from doctrine/stakeholders.json as a real click-through flow (the happy paths).
// --live: audits the real hosts and tenant apps over the network (adds real navigation timing: TTFB, LCP, CLS); no baseline, no path clicks beyond the entry.
// --write: writes ops/uiux/audit.json; --rebaseline: records the current fingerprints as the new visual baseline (an intended redesign).
// Needs playwright (preinstalled in cloud sessions) and axe-core (npm i --no-save axe-core@4.10.2). Free tier only; no secrets.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
const require = createRequire(process.cwd() + "/");
const { chromium } = require("playwright");
const argv = process.argv.slice(2), flag = (f) => argv.includes(f);
const here = (p) => new URL("../" + p, import.meta.url);
const CFG = JSON.parse(readFileSync(here("doctrine/uiux.json"), "utf8"));
const SH = JSON.parse(readFileSync(here("doctrine/stakeholders.json"), "utf8"));
let axeSrc = "";
if (!flag("--no-axe")) { try { axeSrc = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8"); } catch (e) { console.error("axe-core missing: accessibility not measured (npm i --no-save axe-core@4.10.2)"); } }
const LIVE = flag("--live");
const ONLY = (argv[argv.indexOf("--only") + 1] || "").split(",").filter(x => x.startsWith("/"));

// ---- what to audit ----
const PAGES = ["/", "/for", "/showcase", "/how", "/product", "/team", "/faq", "/contact", "/pilot", "/engineers", "/start", "/setup", "/privacy", "/accessibility",
  ...SH.audiences.map(a => "/for/" + a.id), ...SH.showcases.map(c => "/showcase/" + c.id)];
const pages = ONLY.length ? ONLY : PAGES;
const PATHS = [
  ...SH.audiences.map(a => ({ id: "audience-" + a.id, audience: a.id, entry: "/for/" + a.id, steps: [...a.path.map(s => s.href), a.cta.href].filter((h, i, all) => h.startsWith("/") && all.indexOf(h) === i) })),
  ...CFG.paths.extra.map(p => ({ id: p.id, audience: p.audience, entry: p.entry, steps: p.steps }))];
const re = (xs) => xs.map(x => new RegExp(x, "i"));
const FORBID = re(CFG.boundary.forbidden), PLACE = re(CFG.copy.placeholders);
const exempt = (p) => Object.keys(CFG.boundary.exempt_paths).some(e => p === e || p.startsWith(e + "/"));
const findings = [];
const add = (kind, path, viewport, rule, detail) => findings.push({ kind, path, viewport, rule, detail: String(detail).slice(0, 220) });

// ---- offline origin: the site Worker, in process ----
let site = null, ASSET = null;
if (!LIVE) {
  site = (await import(pathToFileURL(fileURLToPath(here("site/worker.js"))).href)).default;
  ASSET = (f) => readFileSync(new URL("../site/assets/" + f, import.meta.url));
  globalThis.fetch = async () => { throw new Error("offline"); };
}
const ENV = LIVE ? null : { ASSETS: { get: async (k) => { const b = ASSET(k); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } } };
const ORIGIN = "https://ultrastable.io";
async function wire(ctx) {
  if (LIVE) return;
  await ctx.route("**/*", async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname !== "ultrastable.io") return route.abort();
    try {
      const res = await site.fetch(new Request(u.href, { method: route.request().method(), headers: route.request().headers() }), ENV, { waitUntil() {} });
      const headers = {}; res.headers.forEach((v, k) => { headers[k] = v; });
      await route.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) });
    } catch (e) { await route.fulfill({ status: 500, body: String(e) }); }
  });
}

// ---- in-page measurements ----
const MEASURE = ({ tol, maxEl }) => {
  const q = (s) => [...document.querySelectorAll(s)];
  const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const named = (e) => (e.textContent || "").trim() || e.getAttribute("aria-label") || e.getAttribute("title") || (e.querySelector("img[alt]") || {}).alt || (e.querySelector("svg title") || {}).textContent || "";
  const fp = q("h1,h2,h3,a,button,input,textarea,nav,main,header,footer").filter(vis).slice(0, maxEl).map((e) => {
    const b = e.getBoundingClientRect(), c = getComputedStyle(e);
    return [e.tagName, Math.round(b.x / tol), Math.round(b.width / tol), Math.round(b.height / tol), c.color, c.backgroundColor, c.fontSize, c.fontWeight, (c.fontFamily.split(",")[0] || "").trim()].join("|");
  });
  return {
    text: document.body ? document.body.innerText : "",
    h1: q("h1").map((e) => (e.textContent || "").trim()),
    lang: document.documentElement.lang, viewport: !!document.querySelector("meta[name=viewport]"), title: document.title.trim(),
    emptyLinks: q("a,button").filter((e) => vis(e) && !named(e)).length,
    primary: q("main .btn-primary, .main .btn-primary").filter(vis).length,
    over: document.documentElement.scrollWidth - window.innerWidth,
    nodes: document.getElementsByTagName("*").length,
    inlineScript: q("script:not([src])").reduce((n, s) => n + s.textContent.length, 0),
    fp,
  };
};
const hash = (s) => createHash("sha1").update(s).digest("hex").slice(0, 6);

async function auditOne(page, host, path, vp, scheme, fingerprints, perf) {
  const label = vp[0], url = (host || ORIGIN) + path;
  await page.setViewportSize({ width: vp[1], height: 800 }); await page.emulateMedia({ colorScheme: scheme });
  let res; try { res = await page.goto(url, { waitUntil: LIVE ? "load" : "domcontentloaded", timeout: 30000 }); } catch (e) { add("structure", path, label, "unreachable", url + " " + e.message); return; }
  const where = LIVE ? new URL(page.url()).host + path : path;
  if (!res || res.status() !== 200) { add("structure", where, label, "status", res ? res.status() : "none"); return; }
  await page.waitForTimeout(LIVE ? 800 : 300);
  const m = await page.evaluate(MEASURE, { tol: CFG.visual.tolerance_px, maxEl: CFG.visual.max_elements });
  const bytes = LIVE ? 0 : Buffer.byteLength(await page.content()); // measured before axe is injected, so the budget sees the page and not the audit
  if (axeSrc) {
    await page.addScriptTag({ content: axeSrc });
    const r = await page.evaluate(async () => await axe.run(document, { resultTypes: ["violations"] }));
    for (const v of r.violations) if (v.impact === "serious" || v.impact === "critical") add("a11y", where, label + "/" + scheme, v.id, v.nodes.slice(0, 2).map(n => n.target.join(" ")).join(" | "));
  }
  if (scheme !== "light") return;
  if (m.over > 1) add("structure", where, label, "horizontal-scroll", m.over + "px");
  const S = CFG.structure;
  if (S.single_h1 && m.h1.length !== 1) add("structure", where, label, "h1-count", m.h1.length + " h1 elements");
  if (!m.lang) add("structure", where, label, "html-lang", "missing lang attribute");
  if (!m.viewport) add("structure", where, label, "viewport-meta", "missing viewport meta");
  if (!m.title) add("structure", where, label, "title", "empty title");
  if (m.emptyLinks) add("structure", where, label, "unnamed-control", m.emptyLinks + " links or buttons with no name");
  if (!S.exempt_primary.includes(path) && m.primary > S.max_primary_actions) add("structure", where, label, "primary-actions", m.primary + " primary actions");
  if (!exempt(path)) { for (const r of FORBID) { const hit = r.exec(m.text); if (hit) add("boundary", where, label, "backend-detail", `"${hit[0]}" is visible to users`); } }
  for (const r of PLACE) { const hit = r.exec(m.text); if (hit) add("copy", where, label, "placeholder", `"${hit[0]}"`); }
  if (m.h1[0] && m.h1[0].split(/\s+/).length > CFG.copy.max_h1_words) add("copy", where, label, "long-h1", m.h1[0].split(/\s+/).length + " words");
  const P = CFG.performance;
  if (!LIVE) {
    if (bytes > P.html_bytes) add("performance", where, label, "html-bytes", bytes + " > " + P.html_bytes);
    if (m.nodes > P.dom_nodes) add("performance", where, label, "dom-nodes", m.nodes + " > " + P.dom_nodes);
    if (m.inlineScript > P.inline_script_bytes) add("performance", where, label, "inline-script", m.inlineScript + " > " + P.inline_script_bytes);
    perf[path + "@" + label] = { html_bytes: bytes, dom_nodes: m.nodes, inline_script_bytes: m.inlineScript };
    fingerprints[path + "@" + label] = [...new Set(m.fp.map(hash))].sort();
  } else {
    const t = await page.evaluate(() => new Promise((ok) => {
      const n = performance.getEntriesByType("navigation")[0] || {}; let lcp = 0, cls = 0;
      try { new PerformanceObserver((l) => { for (const e of l.getEntries()) lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
        new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value; }).observe({ type: "layout-shift", buffered: true }); } catch (e) { /* unsupported: unmeasured */ }
      setTimeout(() => ok({ ttfb: Math.round(n.responseStart || 0), lcp: Math.round(lcp), cls: Math.round(cls * 1000) / 1000 }), 600);
    }));
    perf[where + "@" + label] = t;
    if (t.ttfb > P.live.ttfb_ms) add("performance", where, label, "ttfb", t.ttfb + "ms > " + P.live.ttfb_ms);
    if (t.lcp > P.live.lcp_ms) add("performance", where, label, "lcp", t.lcp + "ms > " + P.live.lcp_ms);
    if (t.cls > P.live.cls) add("performance", where, label, "cls", t.cls + " > " + P.live.cls);
  }
}

// ---- happy paths as real click-through flows ----
async function walk(ctx, p, results) {
  const page = await ctx.newPage(); page.setDefaultTimeout(10000); await page.setViewportSize({ width: 375, height: 800 });
  let ok = 0; const bad = [];
  for (const href of p.steps) {
    try {
      const r0 = await page.goto(ORIGIN + p.entry, { waitUntil: "domcontentloaded" });
      if (!r0 || r0.status() !== 200) { bad.push(`entry ${p.entry} ${r0 ? r0.status() : "none"}`); continue; }
      const link = page.locator(`a[href="${href}"]:visible`).first(); // the visible one: a nav link hidden at phone width is not a path step
      if (!(await link.count())) { bad.push(`${p.entry} has no link to ${href}`); continue; }
      await link.scrollIntoViewIfNeeded({ timeout: 8000 });
      const box = await link.boundingBox();
      if (box && box.height < 44) bad.push(`link to ${href} is ${Math.round(box.height)}px tall (tap target under 44)`);
      const [resp] = await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null), link.click()]);
      const status = resp ? resp.status() : 0;
      const h1 = await page.locator("h1").count();
      if (status !== 200) bad.push(`${href} answered ${status}`); else if (h1 !== 1) bad.push(`${href} has ${h1} h1`); else ok++;
    } catch (e) { bad.push(`${href}: ${e.message.split("\n")[0]}`); }
  }
  await page.close();
  results.push({ id: p.id, audience: p.audience, entry: p.entry, steps_total: p.steps.length, steps_ok: ok, ok: ok === p.steps.length && p.steps.length > 0, detail: bad.slice(0, 4) });
  if (!(ok === p.steps.length && p.steps.length > 0)) add("happy-path", p.entry, "phone", p.id, bad.join("; ") || "no steps");
}

// ---- run ----
const browser = await chromium.launch();
const fingerprints = {}, perf = {}, pathResults = [];
let hosts = [""], audited = 0;
if (LIVE) {
  hosts = CFG.surfaces.hosts.map(h => "https://" + h);
  // UIUX-RETIRED-1: a retired app answers 410 by design and is not a page a person lands on. Retirement is read from the registry the spinoffs
  // Worker serves (spinoffs/registry.json `retired`, written by `ideas --retire`) and from any retire row; the ledger's last row (often a promote)
  // never re-opens it. Hosts are deduplicated so one app is audited once per viewport.
  let retired = new Set();
  try { retired = new Set(JSON.parse(readFileSync(here("spinoffs/registry.json"), "utf8")).retired || []); } catch (e) { console.error("spinoffs/registry.json unreadable: retired apps not excluded:", e.message); }
  try { const led = readFileSync(here(CFG.surfaces.tenants_from), "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)); const by = {}; for (const r of led) if (r.slug) { by[r.slug] = { ...by[r.slug], ...r }; if (r.event === "retire") retired.add(r.slug); } for (const a of Object.values(by)) if (a.url && !retired.has(a.slug)) hosts.push(a.url.replace(/\/$/, "")); } catch (e) { console.error("no tenant ledger: tenant apps not audited"); }
  hosts = [...new Set(hosts)];
}
for (const host of hosts) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } }); await wire(ctx);
  const list = LIVE ? ["/"] : pages;
  for (const scheme of CFG.surfaces.schemes) {
    const page = await ctx.newPage();
    for (const p of list) for (const vp of CFG.surfaces.viewports) { await auditOne(page, host, p, vp, scheme, fingerprints, perf); if (scheme === "light" && vp[0] === "phone") audited++; }
    await page.close();
  }
  if (!LIVE && !ONLY.length) for (const p of PATHS) await walk(ctx, p, pathResults);
  await ctx.close();
}
await browser.close();

// ---- visual regression against the stored fingerprints (no images stored) ----
const BASE = here(CFG.baseline), basePath = fileURLToPath(BASE);
if (!LIVE) {
  if (flag("--rebaseline")) { mkdirSync(fileURLToPath(here("ops/uiux")), { recursive: true }); writeFileSync(basePath, JSON.stringify({ at: new Date().toISOString(), fingerprints }, null, 0) + "\n"); console.log("baseline written for", Object.keys(fingerprints).length, "page views"); }
  else if (existsSync(basePath)) {
    const old = JSON.parse(readFileSync(basePath, "utf8")).fingerprints;
    for (const [k, now] of Object.entries(fingerprints)) {
      const was = old[k]; if (!was) { add("visual-drift", k.split("@")[0], k.split("@")[1], "no-baseline", "page has no baseline yet"); continue; }
      const a = new Set(was), b = new Set(now), inter = [...a].filter(x => b.has(x)).length, sim = inter / (a.size + b.size - inter || 1);
      if (sim < CFG.visual.min_similarity) add("visual-drift", k.split("@")[0], k.split("@")[1], "layout-or-style-changed", `similarity ${sim.toFixed(2)} < ${CFG.visual.min_similarity}`);
    }
  } else console.error("no visual baseline yet: run with --rebaseline once");
}

const report = { at: new Date().toISOString(), mode: LIVE ? "live" : "offline", pages: audited, hosts: LIVE ? hosts : [ORIGIN], axe: !!axeSrc, findings, paths: pathResults, perf };
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : null;
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 1) + "\n");
if (flag("--write")) { mkdirSync(fileURLToPath(here("ops/uiux")), { recursive: true }); writeFileSync(fileURLToPath(here(LIVE ? "ops/uiux/audit-live.json" : CFG.audit_report)), JSON.stringify(report, null, 1) + "\n"); }
for (const f of findings) console.log(f.kind.padEnd(12), f.path, f.viewport, f.rule, "-", f.detail);
for (const r of pathResults) console.log("path", r.ok ? "ok  " : "FAIL", r.id, `${r.steps_ok}/${r.steps_total}`);
const blocking = findings.filter(f => CFG.audits[f.kind] === "blocking").length;
console.log(`uiux-audit ${report.mode}: ${audited} pages, ${findings.length} findings (${blocking} blocking), ${pathResults.filter(r => r.ok).length}/${pathResults.length} paths ok, axe ${axeSrc ? "on" : "off"}`);
process.exit(blocking ? 1 : 0);

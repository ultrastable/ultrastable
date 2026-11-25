// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// SEED-DEPLOY-1: deploys every seed listed in doctrine/seed-deploys.json into the Ultrastable Cloudflare account through the same OIDC route as the platform
// workers (deploy-oidc.mjs): no stored Cloudflare credential. Each seed is generated and admitted by SEED-ADMIT-1 first; a held seed is never deployed.
//   node deploy/deploy-seed.mjs            generate, create its database and migrate (site /__internal/seed-d1), upload, probe /health, record the row
//   node deploy/deploy-seed.mjs --verify   probe only
// Worker and database are named ultrastable-seed-<slug>; the database call can reach nothing else (site/deployer.js seedD1). Rows go to ops/deploys.jsonl; detector `seed-live` reads them.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, rmSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { collectModules } from "../seed/worker/src/handoff.js";
const SITE = process.env.TARGET_SITE || "https://ultrastable-site.ultrastable.workers.dev";
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const verifyOnly = process.argv.includes("--verify"), dryRun = process.argv.includes("--dry-run");  // --dry-run: generate, bootstrap and bundle, never call the site
const OUT = process.env.SEED_DEPLOY_OUT || "/tmp/seed-deploy";
const cfg = JSON.parse(readFileSync(new URL("../doctrine/seed-deploys.json", import.meta.url), "utf8"));
// BOOT-ACCEPT-1: the repository each standing seed declares (doctrine/full-stack.json), named in its discovery manifest from the first deploy.
const stackOf = (() => { try { const j = JSON.parse(readFileSync(new URL("../doctrine/full-stack.json", import.meta.url), "utf8")); return j.systems || j.declared || {}; } catch (e) { console.log("::warning::full-stack.json unreadable: " + e.message); return {}; } })();
const DIRECTORY = process.env.DIRECTORY_URL || "https://ultrastable.io";
// DISCOVER-1 from minute one: the seed's own heartbeat registers once a day at 03:00 UTC, so a new system would wait up to a day to be findable.
// The deploy registers it at once; the directory reads the system's own manifest before listing it, so this cannot list anything untrue.
async function registerDirectory(url) {
  try { const r = await fetch(DIRECTORY + "/api/directory/register", { method: "POST", headers: { "content-type": "application/json", "user-agent": "ultrastable-seed-deploy/1" }, body: JSON.stringify({ url }) }); const j = await r.json().catch(() => ({})); return { status: r.status, listed: Boolean(j.listed), why: j.why || j.error || null }; }
  catch (e) { return { status: 0, listed: false, why: String(e.message || e).slice(0, 160) }; }
}
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", ...opts });
async function oidc() {
  const u = process.env.ACTIONS_ID_TOKEN_REQUEST_URL, t = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!u || !t) throw new Error("no OIDC request URL: the job needs permissions id-token: write");
  const r = await fetch(u + "&audience=ultrastable-deploy", { headers: { authorization: "bearer " + t } });
  const j = await r.json(); if (!j.value) throw new Error("OIDC token request HTTP " + r.status); return j.value;
}
async function site(path, body) {
  let err;
  for (let a = 1; a <= 4; a++) {  // the site worker may have just replaced itself: retry with backoff
    try {
      const r = await fetch(SITE + path, { method: "POST", headers: { authorization: "Bearer " + await oidc(), "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({})); if (r.ok && j.ok) return j;
      err = new Error(`${path}: ${j.error || "HTTP " + r.status}`); if (r.status < 500 && r.status !== 404) break;
    } catch (e) { err = e; }
    await new Promise(z => setTimeout(z, 8000 * a));
  }
  throw err;
}
async function probe(url) {
  // A fresh seed answers /health with 503 until its first cron tick completes; start that tick (the route runs one only when none is recent), then accept a JSON answer that names the org: the worker is up and running its own code.
  try { await fetch(url + "/pulse/watch", { method: "POST" }); } catch { /* not up yet */ }
  let last = "no response";  // keep what the worker answered so a failed launch says why
  for (let i = 0; i < 12; i++) {
    try { const r = await fetch(url + "/health"); const t = await r.text(); last = `${r.status} ${t.slice(0, 200)}`; try { const j = JSON.parse(t); if (r.ok || (j && j.org && r.status === 503)) return { ok: true, status: r.status }; } catch { /* not JSON yet */ } } catch (e) { last = String(e.message || e).slice(0, 200); }
    await new Promise(r => setTimeout(r, 5000));
  }
  return { ok: false, last };
}
const repoOf = (slug, hostRepo) => { const r = hostRepo || (stackOf[slug] && stackOf[slug].repo) || ""; return /^[\w.-]+\/[\w.-]+$/.test(r) ? r : null; };
const gitsha = process.env.GITHUB_SHA || sh("git", ["rev-parse", "HEAD"], { cwd: ROOT }).trim();
const rows = [];
// LAUNCH-PATH-1: a visitor's app is deployed by the same route. deploy/launch-apps.mjs passes its manifest in SEED_EXTRA ([{slug, instance, ai}]);
// with SEED_ONLY_EXTRA=1 the standing seeds are left alone, and SEED_RESULT names a file that receives the rows (nothing is appended to the ledger).
const extra = JSON.parse(process.env.SEED_EXTRA || "[]"), onlyExtra = process.env.SEED_ONLY_EXTRA === "1";
const todo = (onlyExtra ? [] : cfg.seeds.map(slug => ({ slug, instance: `instances/${slug}/instance.json` }))).concat(extra);
for (const { slug, instance, ai, host_repo } of todo) {
  if (!/^[a-z0-9-]{1,35}$/.test(slug)) throw new Error("seed slug not allowed: " + slug);
  const name = `ultrastable-seed-${slug}`, url = SITE.replace("ultrastable-site", name);
  let row = { at: new Date().toISOString(), kind: "seed", worker: name, slug, url, sha: gitsha };
  try {
    if (!verifyOnly) {
      const out = `${OUT}/${slug}`; rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
      const raw = sh("python3", ["-m", "foundation", "seedadmit", "--onboard", instance, "--out", out], { cwd: ROOT });
      const rep = JSON.parse(raw.slice(raw.indexOf("{")));
      if (rep.admission !== "admitted") throw new Error(`not admitted: ${(rep.reasons || []).join("; ")}`);
      row.admission = rep.admission; row.year_p10 = rep.year && rep.year.p10;
      const dir = `${out}/worker/migrations`;
      const sqlRow = (file, sql) => ({ file, sha256: createHash("sha256").update(sql).digest("hex"), sql });
      const migrations = readdirSync(dir).filter(f => f.endsWith(".sql")).sort().map(f => sqlRow(f, readFileSync(`${dir}/${f}`, "utf8")));
      // The generated system writes its own worker/src/config.js when its bootstrap runs. Drop any copy the kernel copy carried in (a stale generated file in a checkout hid this gap once)
      // so the Worker is built only from what the system itself generates.
      rmSync(`${out}/worker/src/config.js`, { force: true });
      sh("python3", ["bootstrap/bootstrap.py", "--root", ".", "--dry-run"], { cwd: out });
      if (existsSync(`${out}/org/seed.sql`)) migrations.push(sqlRow("zz-seed.sql", readFileSync(`${out}/org/seed.sql`, "utf8")));  // org, roles and metrics rows
      const mods = await collectModules(async p => readFileSync(`${out}/${p}`, "utf8"), "worker/src/index.js");
      if (dryRun) { console.log(`PREPARED ${slug}: ${mods.length} modules, ${migrations.length} migrations`); rows.push({ ...row, prepared: true, modules: mods.length, live_ok: true }); continue; }
      const db = await site("/__internal/seed-d1", { name, migrations });
      const up = await site("/__internal/deploy", {
        name, main: mods[0].name, modules: mods.map(({ name: n, src, type }) => ({ name: n, src, type })), compatibility_date: "2026-11-12", workers_dev: true, crons: ["*/10 * * * *"], ...(host_repo ? { host_repo } : {}),
        bindings: [{ type: "d1", name: "DB", id: db.uuid }, { type: "plain_text", name: "PUBLIC_HEALTH_ONLY", text: "1" }, { type: "plain_text", name: "PUBLIC_URL", text: url }].concat(repoOf(slug, host_repo) ? [{ type: "plain_text", name: "PUBLIC_REPO", text: repoOf(slug, host_repo) }] : []).concat(ai ? [{ type: "ai", name: "AI" }] : []),  // a visitor's app gets the account's own models: no key for anyone to mint
      });
      row.version = up.version || ""; row.migrations_applied = db.applied.length;
    }
    const p = await probe(url);
    row = { ...row, uploaded: !verifyOnly, live_ok: p.ok, live_matches_commit: !verifyOnly && p.ok, status: p.status || 0, ...(p.ok ? {} : { error: "health: " + p.last }) };
    if (p.ok && !dryRun) row.directory = await registerDirectory(url);  // recorded, read by foundation/bootaccept.py; a refusal says why
  } catch (e) { row = { ...row, live_ok: false, error: String(e.message).slice(0, 300) }; }
  console.log(row.live_ok ? "OK    " : "FAIL  ", name, row.live_ok ? url + "/health" : row.error || "no health");
  rows.push(row);
  if (!verifyOnly && !onlyExtra) appendFileSync(new URL("../ops/deploys.jsonl", import.meta.url), JSON.stringify(row) + "\n");
}
if (process.env.SEED_RESULT) writeFileSync(process.env.SEED_RESULT, JSON.stringify(rows));
process.exit(rows.every(r => r.live_ok) ? 0 : 1);

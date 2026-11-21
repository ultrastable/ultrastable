// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// SEED-DEPLOY-1: deploys every seed listed in doctrine/seed-deploys.json to the Ultrastable Cloudflare account, from this repository alone.
//   node deploy/deploy-seed.mjs            generate and admit each seed, create its D1, migrate, deploy, probe /health, record the row
//   node deploy/deploy-seed.mjs --verify   probe only (no deploy)
// A seed deploys only when SEED-ADMIT-1 admits it (python3 -m foundation seedadmit --onboard). Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
// (the secrets deploy-workers already uses); no credential is minted. Rows go to ops/deploys.jsonl; the detector `seed-live` reads them.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const T = process.env.CLOUDFLARE_API_TOKEN, A = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!T || !A) { console.error("set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID"); process.exit(1); }
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const verifyOnly = process.argv.includes("--verify");
const cfg = JSON.parse(readFileSync(new URL("../doctrine/seed-deploys.json", import.meta.url), "utf8"));
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", env: { ...process.env }, ...opts });
async function cf(method, path, body) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${A}${path}`, { method, headers: { authorization: "Bearer " + T, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({})); if (!j.success) throw new Error(`${method} ${path}: ${JSON.stringify(j.errors || r.status)}`); return j.result;
}
async function probe(url) {
  for (let i = 0; i < 12; i++) {
    try { const r = await fetch(url + "/health"); const t = await r.text(); if (r.ok) { try { JSON.parse(t); return { ok: true, status: r.status }; } catch { /* not JSON yet */ } } } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 5000));
  }
  return { ok: false };
}
const sub = (await cf("GET", "/workers/subdomain")).subdomain;
const gitsha = process.env.GITHUB_SHA || sh("git", ["rev-parse", "HEAD"], { cwd: ROOT }).trim();
const rows = [];
for (const slug of cfg.seeds) {
  const name = `${slug}-ultrastable`, url = `https://${name}.${sub}.workers.dev`;
  let row = { at: new Date().toISOString(), kind: "seed", worker: name, slug, url, sha: gitsha };
  try {
    if (!verifyOnly) {
      const out = `/tmp/seed-deploy/${slug}`; rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
      const raw = sh("python3", ["-m", "foundation", "seedadmit", "--onboard", `instances/${slug}/instance.json`, "--out", out], { cwd: ROOT });
      const rep = JSON.parse(raw.slice(raw.indexOf("{")));
      if (rep.admission !== "admitted") throw new Error(`not admitted: ${(rep.reasons || []).join("; ")}`);
      row.admission = rep.admission; row.year_p10 = rep.year && rep.year.p10;
      const wdir = `${out}/worker`, dbName = name;
      const dbs = await cf("GET", `/d1/database?name=${dbName}`);
      const db = dbs.find(d => d.name === dbName) || await cf("POST", "/d1/database", { name: dbName });
      const wr = `${wdir}/wrangler.jsonc`;
      let txt = readFileSync(wr, "utf8").replace(/"name":\s*"[^"]*"/, `"name": "${name}"`).replace(/"database_name":\s*"[^"]*"/, `"database_name": "${dbName}"`)
        .replace("{d1_database_id}", db.uuid).replace(/"workers_dev":\s*(false|true)/, '"workers_dev": true').replace(/"PUBLIC_HEALTH_ONLY":\s*"[01]"/, '"PUBLIC_HEALTH_ONLY": "1"');
      writeFileSync(wr, txt);
      sh("npx", ["-y", "wrangler@4", "d1", "migrations", "apply", dbName, "--remote"], { cwd: wdir });
      sh("npx", ["-y", "wrangler@4", "deploy", "--tag", gitsha.slice(0, 12), "--message", "deploy-seed-" + gitsha], { cwd: wdir });
    }
    const p = await probe(url);
    row = { ...row, uploaded: !verifyOnly, live_ok: p.ok, status: p.status || 0 };
  } catch (e) { row = { ...row, live_ok: false, error: String(e.message).slice(0, 300) }; }
  console.log(row.live_ok ? "OK    " : "FAIL  ", name, row.live_ok ? url + "/health" : row.error || "no health");
  rows.push(row);
  if (!verifyOnly) appendFileSync(new URL("../ops/deploys.jsonl", import.meta.url), JSON.stringify(row) + "\n");
}
process.exit(rows.every(r => r.live_ok) ? 0 : 1);

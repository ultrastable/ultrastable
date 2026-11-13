// D1-MIGRATE-1: applies seed/worker/migrations/*.sql to the org D1 through the Cloudflare API, once each (ledger table _migrations: file, sha256).
// Root cause it closes: 0004/0005 were never applied live, so the tick's `measure` and `criticality` steps failed every run and k was never measured.
// Usage: node deploy/apply-d1-migrations.mjs   (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID; database id from doctrine/topology.json key "org")
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
const T = process.env.CLOUDFLARE_API_TOKEN, A = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!T || !A) { console.error("set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID"); process.exit(1); }
const topo = JSON.parse(readFileSync(new URL("../doctrine/topology.json", import.meta.url), "utf8"));
const db = topo.stores.d1.find(d => d.key === "org").id;
async function q(sql, params = []) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${A}/d1/database/${db}/query`, { method: "POST", headers: { authorization: "Bearer " + T, "content-type": "application/json" }, body: JSON.stringify({ sql, params }) });
  const j = await r.json(); if (!j.success) throw new Error("D1 " + JSON.stringify(j.errors)); return j.result[0].results;
}
await q("CREATE TABLE IF NOT EXISTS _migrations (file TEXT PRIMARY KEY, sha256 TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')))");
const dir = new URL("../seed/worker/migrations/", import.meta.url);
let failed = 0;
for (const f of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) {
  const sql = readFileSync(new URL(f, dir), "utf8"), h = createHash("sha256").update(sql).digest("hex");
  const seen = await q("SELECT sha256 FROM _migrations WHERE file = ?", [f]);
  if (seen.length) { console.log("skip   ", f); continue; }
  try { await q(sql); await q("INSERT INTO _migrations (file, sha256) VALUES (?, ?)", [f, h]); console.log("applied", f); }
  catch (e) { failed++; console.error("FAILED ", f, e.message); }  // migrations are idempotent (IF NOT EXISTS); a failure fails the deploy loudly
}
process.exit(failed ? 1 : 0);

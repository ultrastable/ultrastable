// D1-MIGRATE-1: applies seed/worker/migrations/*.sql to the org D1 through the Cloudflare API, once each (ledger table _migrations: file, sha256).
// Root cause it closes: 0004/0005 were never applied live, so the tick's `measure` and `criticality` steps failed every run and k was never measured.
// Usage: node deploy/apply-d1-migrations.mjs   (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID; database id from doctrine/topology.json key "org")
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { planMigrations } from "./migration-plan.mjs";
const T = process.env.CLOUDFLARE_API_TOKEN, A = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!T || !A) { console.error("set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID"); process.exit(1); }
// ACCOUNT-SPLIT-2: never upload to a retired account (deploy/cloudflare-accounts.json retired_account_ids); deploy-ultrastable.yml owns deploys.
{ const acc = JSON.parse(readFileSync(new URL("./cloudflare-accounts.json", import.meta.url), "utf8")); if ((acc.retired_account_ids || []).includes(A)) { console.log("skip: account " + A + " is retired; deploy-ultrastable.yml deploys the ultrastable account"); process.exit(0); } }
const topo = JSON.parse(readFileSync(new URL("../doctrine/topology.json", import.meta.url), "utf8"));
const db = topo.stores.d1.find(d => d.key === "org").id;
async function q(sql, params = []) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${A}/d1/database/${db}/query`, { method: "POST", headers: { authorization: "Bearer " + T, "content-type": "application/json" }, body: JSON.stringify({ sql, params }) });
  const j = await r.json(); if (!j.success) throw new Error("D1 " + JSON.stringify(j.errors)); return j.result[0].results;
}
await q("CREATE TABLE IF NOT EXISTS _migrations (file TEXT PRIMARY KEY, sha256 TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')))");
const dir = new URL("../seed/worker/migrations/", import.meta.url);
let failed = 0, drift = 0;
const files = readdirSync(dir).filter(f => f.endsWith(".sql")).map(f => { const sql = readFileSync(new URL(f, dir), "utf8"); return { file: f, sql, sha256: createHash("sha256").update(sql).digest("hex") }; });
const ledger = new Map((await q("SELECT file, sha256 FROM _migrations")).map(r => [r.file, r.sha256]));
const src = new Map(files.map(x => [x.file, x.sql]));
for (const m of planMigrations(files, ledger)) {
  if (m.action === "skip") { console.log("skip   ", m.file); continue; }
  // MIGRATION-DRIFT-1: an applied file was edited; never run it again. Restore the file and put the change in a new migration.
  if (m.action === "drift") { drift++; console.log(`::warning::DRIFT   ${m.file}: applied as sha256 ${m.was.slice(0, 12)}, file is now ${m.sha256.slice(0, 12)}; not re-applied`); continue; }
  try { await q(src.get(m.file)); await q("INSERT INTO _migrations (file, sha256) VALUES (?, ?)", [m.file, m.sha256]); console.log("applied", m.file); }
  catch (e) { failed++; console.error("FAILED ", m.file, e.message); }  // migrations are idempotent (IF NOT EXISTS); a failure fails the deploy loudly
}
if (drift) console.log(`drift: ${drift} applied migration file(s) changed since they ran; not re-applied`);
process.exit(failed ? 1 : 0);

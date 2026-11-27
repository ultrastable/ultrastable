// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// SEED-DEPLOY-1: the OIDC deploy route may create and migrate only a database named ultrastable-seed-<slug>.
import assert from "node:assert/strict";
import { internalDeploy, seedD1, SEED_DB } from "./deployer.js";
const sha = "a".repeat(64);
function fake(existing) {
  const calls = [], ledger = new Set(); let made = !!existing;
  const api = async (m, p, body) => {
    calls.push([m, p, body]);
    if (m === "GET") return { success: true, result: made ? [{ name: "ultrastable-seed-x", uuid: "u2" }] : [] };
    if (p.endsWith("/d1/database")) { made = true; return { success: true, result: { uuid: "u2" } }; }
    const sql = JSON.parse(body).sql;
    if (/^SELECT file/.test(sql)) return { success: true, result: [{ results: [...ledger].map(file => ({ file })) }] };
    const ins = /INSERT INTO _migrations \(file, sha256\) VALUES \('([^']+)'/.exec(sql); if (ins) ledger.add(ins[1]);
    return { success: true, result: [{ results: [] }] };
  };
  return { api, calls, ledger };
}
const ms = [{ file: "0001_init.sql", sha256: sha, sql: "CREATE TABLE a (x)" }, { file: "0002_more.sql", sha256: sha, sql: "CREATE TABLE b (x)" }];
// names: only the seed prefix; a platform database name is refused before any call
for (const bad of ["ultrastable-org", "ultrastable-seed-", "ultrastable-seed-X", "ultrastable-seed-a_b", "ultrastable-unlearn", "../x"]) {
  const f = fake(true); const r = await seedD1({ name: bad, migrations: [] }, f.api, "A");
  assert.equal(r.status, 400, bad); assert.equal(f.calls.length, 0, "no Cloudflare call for " + bad);
}
assert.ok(SEED_DB.test("ultrastable-seed-second-tenant"));
// creates when missing, applies every file once, and a second run applies none
{ const f = fake(false); const j = await (await seedD1({ name: "ultrastable-seed-x", migrations: ms }, f.api, "A")).json();
  assert.deepEqual([j.ok, j.created, j.uuid, j.applied], [true, true, "u2", ["0001_init.sql", "0002_more.sql"]]);
  const j2 = await (await seedD1({ name: "ultrastable-seed-x", migrations: ms }, f.api, "A")).json();
  assert.deepEqual([j2.created, j2.uuid, j2.applied], [false, "u2", []]); }
// MIGRATE-IDEMPOTENT-1: a file whose ADD COLUMN meets an existing column still applies, statement by statement; another error still fails it
{ const f = fake(false); const inner = f.api;
  const api = async (m, p, body) => { const sql = body ? JSON.parse(body).sql : ""; if (/ADD COLUMN x INTEGER;\nALTER/.test(sql)) return { success: false, errors: [{ message: "duplicate column name: x: SQLITE_ERROR" }] };
    if (/^ALTER TABLE a ADD COLUMN x/.test(sql)) return { success: false, errors: [{ message: "duplicate column name: x" }] }; return inner(m, p, body); };
  const dup = [{ file: "0003_cols.sql", sha256: sha, sql: "ALTER TABLE a ADD COLUMN x INTEGER;\nALTER TABLE a ADD COLUMN y INTEGER;" }];
  const j = await (await seedD1({ name: "ultrastable-seed-x", migrations: dup }, api, "A")).json();
  assert.deepEqual([j.ok, j.applied], [true, ["0003_cols.sql"]]); }
// malformed migrations are refused
for (const m of [[{ file: "../x.sql", sha256: sha, sql: "x" }], [{ file: "a.sql", sha256: "zz", sql: "x" }], [{ file: "a.sql", sha256: sha }]])
  assert.equal((await seedD1({ name: "ultrastable-seed-x", migrations: m }, fake(true).api, "A")).status, 400);
// the route needs a credential: without the key it answers 404 like any unknown page
const env = { CF_DEPLOY_TOKEN: "cf", CF_ACCOUNT_ID: "A", INTERNAL_DEPLOY_KEY: "k" };
const call = (h) => internalDeploy(new Request("https://site/__internal/seed-d1", { method: "POST", headers: h, body: JSON.stringify({ name: "ultrastable-seed-x", migrations: [] }) }), env, async () => new Response(JSON.stringify({ success: true, result: [{ name: "ultrastable-seed-x", uuid: "u1" }] })));
assert.equal((await call({})).status, 404);
assert.equal((await call({ "x-internal-key": "k" })).status, 200);
console.log("seed d1: ok");

// AUTHZEN-1: decisions come from the trust ledger and fail closed.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL, fileURLToPath } from "node:url";
const az = await import(pathToFileURL(fileURLToPath(new URL("./authzen.js", import.meta.url))).href);
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE trust_ledger (surface TEXT, action_class TEXT, ok INT, fail INT, trust_score REAL, ladder_position TEXT, evidence TEXT, refreshed_at TEXT, PRIMARY KEY(surface, action_class));
INSERT INTO trust_ledger VALUES ('site','deploy',9,0,0.8,'autonomous','e','t'),('site','modify',9,0,0.8,'autonomous','e','t'),('docs','execute',1,0,0.6,'assisted','e','t'),('repo','merge_pr_green',1,0,0.5,'delegated','e','t'),('repo','delete_repo',1,0,0.5,'delegated','e','t'),('money','spend',1,0,0.99,'self-extending','e','t');`);
const ORG = { prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st; }, first: async () => db.prepare(sql).get(...a) || null }; return st; } };
const E = { ORG };
const ask = async (path, body, env = E, method = "POST") => { const r = await az.authzen(new Request("https://ultrastable.io" + path, { method, body: body && method === "POST" ? JSON.stringify(body) : undefined }), env); return { status: r.status, body: await r.json() }; };
const q = (surface, action, type = "surface") => ({ subject: { type: "agent", id: "claude-code" }, resource: { type, id: surface }, action: { name: action } });
assert.equal((await ask("/.well-known/authzen-configuration", null, E, "GET")).body.access_evaluation_endpoint, "https://ultrastable.io/access/v1/evaluation");
assert.equal((await ask("/access/v1/evaluation", q("site", "deploy"))).body.decision, true, "rung autonomous covers deploy");
assert.equal((await ask("/access/v1/evaluation", q("site", "modify"))).body.decision, false, "autonomous is below self-modifying");
assert.equal((await ask("/access/v1/evaluation", q("docs", "execute"))).body.decision, false, "assisted is below delegated");
assert.equal((await ask("/access/v1/evaluation", q("nowhere", "deploy"))).body.decision, false, "no row fails closed");
assert.equal((await ask("/access/v1/evaluation", q("repo", "merge_pr_green"))).body.decision, true, "live class merge_pr_green at delegated");
assert.equal((await ask("/access/v1/evaluation", q("repo", "delete_repo"))).body.decision, false, "gated even at delegated");
assert.equal((await ask("/access/v1/evaluation", q("money", "spend"))).body.decision, false, "gated even at the top rung");
assert.equal((await ask("/access/v1/evaluation", q("kv", "read", "secret"))).body.decision, false, "secrets are outside every rung");
assert.equal((await ask("/access/v1/evaluation", { subject: {} })).status, 400);
assert.equal((await ask("/access/v1/evaluation", q("site", "deploy"), { ORG: { prepare() { throw new Error("x"); } } })).body.decision, false, "unreadable ledger fails closed");
const batch = await ask("/access/v1/evaluations", { subject: q("a", "b").subject, evaluations: [{ resource: q("site", "x").resource, action: { name: "deploy" } }, { resource: q("zzz", "x").resource, action: { name: "deploy" } }] });
assert.deepEqual(batch.body.evaluations.map(e => e.decision), [true, false]);
assert.equal((await ask("/access/v1/evaluation", null, E, "GET")).status, 405);
assert.equal(await az.authzen(new Request("https://example.com/access/v1/evaluation", { method: "POST" }), E), null);
console.log("authzen: ledger decides and fails closed ok");
// routed through the real worker entry point, not only the module
{
  const mod = (await import(pathToFileURL(fileURLToPath(new URL("./worker.js", import.meta.url))).href)).default;
  const r = await mod.fetch(new Request("https://ultrastable.io/access/v1/evaluation", { method: "POST", body: JSON.stringify(q("site", "deploy")) }), { ORG, ASSETS: { get: async () => null, list: async () => ({ keys: [] }) } });
  assert.equal((await r.json()).decision, true, "worker routes /access/v1/evaluation");
  const w = await mod.fetch(new Request("https://ultrastable.io/.well-known/authzen-configuration"), { ORG, ASSETS: { get: async () => null, list: async () => ({ keys: [] }) } });
  assert.equal(w.status, 200);
  console.log("authzen routed ok");
}

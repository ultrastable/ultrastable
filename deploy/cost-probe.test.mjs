// Q-COST-PROOF-1 tests: injected fetch, temp output directory; no network, no token.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { run, diff } from "./cost-probe.mjs";

const thresholds = { window_days: 7, rows_read_max: 1000, rows_read_override: { "big-ok": 1e9 }, neurons_max: 500, file_prefixes: ["ultrastable-"], file_foreign: false, item_labels: ["p1"], item_milestone: "Now", item_workstream: "w" };
const topo = { account_id: "acct", workers: [{ id: "ultrastable-tick", state: "live" }], stores: { d1: [{ name: "ultrastable-org", state: "live" }], kv: [], r2: [] } };
const TOKEN = "secret-token-value";

function fakeFetch(url, init) {
  const ok = (result, extra = {}) => ({ ok: true, status: 200, json: async () => ({ success: true, errors: [], result, ...extra }) });
  if (url.endsWith("/graphql")) {
    const q = JSON.parse(init.body).query;
    const data = q.includes("d1AnalyticsAdaptiveGroups")
      ? { d1AnalyticsAdaptiveGroups: [{ dimensions: { databaseId: "1" }, sum: { rowsRead: 5000, rowsWritten: 1, readQueries: 2, writeQueries: 1 } }, { dimensions: { databaseId: "2" }, sum: { rowsRead: 5000, rowsWritten: 0, readQueries: 1, writeQueries: 0 } }] }
      : { aiInferenceAdaptiveGroups: [{ dimensions: { modelId: "m" }, sum: { totalNeurons: 900.4 } }] };
    return { ok: true, status: 200, json: async () => ({ data: { viewer: { accounts: [data] } }, errors: null }) };
  }
  if (url.includes("/d1/database")) return ok([{ name: "ultrastable-org", uuid: "1" }, { name: "big-ok", uuid: "2" }, { name: "ultrastable-stray", uuid: "3" }], { result_info: { total_pages: 1 } });
  if (url.includes("/workers/scripts")) return ok([{ id: "ultrastable-tick" }, { id: "qnfo-ops" }]);
  if (url.includes("/kv/namespaces")) return ok([]);
  if (url.includes("/r2/buckets")) return ok({ buckets: [] });
  throw new Error("unexpected " + url);
}

test("over-threshold database, AI neurons and undeclared resource each file one item; overrides and foreign names do not", async () => {
  const out = pathToFileURL(mkdtempSync(join(tmpdir(), "cost-")) + "/");
  mkdirSync(new URL("ops", out)); mkdirSync(new URL("docs/issues", out), { recursive: true });
  const r = await run({ fetchFn: fakeFetch, token: TOKEN, out, topo, thresholds, now: new Date("2026-11-13T00:00:00Z") });
  assert.deepEqual(r.items.sort(), ["Q-COST-NEURONS", "Q-COST-ROWS-ULTRASTABLE-ORG", "Q-TOPO-D1-ULTRASTABLE-STRAY"]);
  assert.equal(r.cost.ai.neurons, 900);
  assert.equal(r.cost.drift.foreign, 2);
  const line = readFileSync(new URL("ops/cost.jsonl", out), "utf8");
  assert.equal(line.trim().split("\n").length, 1);
  assert.ok(!line.includes(TOKEN));
  assert.ok(existsSync(new URL("docs/issues/Q-COST-ROWS-ULTRASTABLE-ORG.json", out)));
  // idempotent: a second run appends a line and files nothing new
  const r2 = await run({ fetchFn: fakeFetch, token: TOKEN, out, topo, thresholds });
  assert.deepEqual(r2.filed, []);
});

test("dry run writes nothing; a failed API call never leaks the token", async () => {
  const out = pathToFileURL(mkdtempSync(join(tmpdir(), "cost-")) + "/");
  const r = await run({ fetchFn: fakeFetch, token: TOKEN, out, topo, thresholds, dry: true });
  assert.deepEqual(r.filed, []);
  const bad = async () => ({ ok: false, status: 403, json: async () => ({ success: false, errors: [{ message: "denied " + TOKEN }] }) });
  await assert.rejects(run({ fetchFn: bad, token: TOKEN, out, topo, thresholds, dry: true }), (e) => !e.message.includes(TOKEN));
});

test("diff reports a declared live resource that is missing", () => {
  const d = diff({ workers: [], d1: ["ultrastable-org"], kv: [], r2: [] }, topo, thresholds);
  assert.deepEqual(d.missing, [{ kind: "workers", name: "ultrastable-tick" }]);
});

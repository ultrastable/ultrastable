// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// ZONE-CUTOVER-1 tests: run with `node --test site/zonecutover.test.mjs`.
import test from "node:test";
import assert from "node:assert/strict";
import { zoneCutover, PLAN } from "./zonecutover.js";

const env = { CF_DEPLOY_TOKEN: "t", CF_ACCOUNT_ID: "acct" };
function fake(zones, { domains = [], routes = [], email = false, fail = null } = {}) {
  const calls = [];
  const f = async (url, init) => {
    const u = new URL(url), m = init.method, p = u.pathname.replace("/client/v4", "");
    calls.push(m + " " + p);
    const ok = (result) => ({ ok: true, status: 200, json: async () => ({ success: true, result }) });
    if (fail && p.includes(fail)) return { ok: false, status: 403, json: async () => ({ success: false, errors: [{ message: "denied" }] }) };
    if (m === "GET" && p === "/zones") { const n = u.searchParams.get("name"); return ok(zones[n] ? [{ id: "z-" + n, status: zones[n] }] : []); }
    if (m === "GET" && p.endsWith("/workers/domains")) return ok(domains.map(hostname => ({ hostname })));
    if (m === "GET" && p.endsWith("/workers/routes")) return ok(routes.map(pattern => ({ pattern })));
    if (m === "GET" && p.endsWith("/email/routing")) return ok({ enabled: email });
    return ok({});
  };
  return { f, calls };
}

test("no credential is unmeasured, never ok", async () => {
  assert.equal((await zoneCutover({}, async () => { throw new Error("no call"); })).status, "unmeasured");
});

test("pending zones attach nothing", async () => {
  const { f, calls } = fake({ "ultrastable.io": "pending", "ultrastable.app": "pending", "ultrastable.net": "pending", "ultrastable.org": "pending" });
  const r = await zoneCutover(env, f);
  assert.equal(r.status, "pending");
  assert.ok(calls.every(c => c.startsWith("GET")));
});

test("an active zone gets its domains, routes and email routing; existing ones are kept", async () => {
  const io = PLAN.filter(p => p.zone === "ultrastable.io");
  const { f, calls } = fake({ "ultrastable.io": "active" }, { domains: ["www.ultrastable.io"] });
  const r = await zoneCutover(env, f, io);
  assert.equal(r.status, "ok");
  assert.deepEqual(r.zones["ultrastable.io"].attached, ["ultrastable.io", "*.ultrastable.io/*", "mail:hello@ultrastable.io", "mail:pilot@ultrastable.io", "mail:catch-all"]);
  assert.deepEqual(r.zones["ultrastable.io"].kept, ["www.ultrastable.io"]);
  assert.equal(r.zones["ultrastable.io"].email, "enabled");
  assert.equal(calls.filter(c => c.startsWith("PUT")).length, 2);  // one custom domain, the catch-all rule
  assert.ok(!calls.some(c => c.startsWith("DELETE")));
});

test("mail rules that already exist are kept, not duplicated (MAIL-RULES-1)", async () => {
  const io = PLAN.filter(p => p.zone === "ultrastable.io");
  const { f, calls } = fake({ "ultrastable.io": "active" }, { domains: ["ultrastable.io", "www.ultrastable.io"], routes: ["*.ultrastable.io/*"], email: true });
  const f2 = async (url, init) => {
    const p = new URL(url).pathname;
    if (init.method === "GET" && p.endsWith("/email/routing/rules")) return { ok: true, status: 200, json: async () => ({ success: true, result: [{ matchers: [{ type: "literal", value: "hello@ultrastable.io" }, ] }, { matchers: [{ type: "literal", value: "pilot@ultrastable.io" }] }] }) };
    if (init.method === "GET" && p.endsWith("/catch_all")) return { ok: true, status: 200, json: async () => ({ success: true, result: { enabled: true, actions: [{ type: "worker", value: ["ultrastable-mail-in"] }] } }) };
    return f(url, init);
  };
  const r = await zoneCutover(env, f2, io);
  assert.equal(r.status, "ok");
  assert.deepEqual(r.zones["ultrastable.io"].attached, []);
  assert.ok(!calls.some(c => c.startsWith("POST") || c.startsWith("PUT")));
});

test("a refused step is reported as error and stays error", async () => {
  const plan = PLAN.filter(p => p.zone === "ultrastable.io" || p.zone === "ultrastable.net");
  const { f } = fake({ "ultrastable.io": "active", "ultrastable.net": "pending" }, { fail: "/workers/domains" });
  const r = await zoneCutover(env, f, plan);
  assert.equal(r.status, "error");
  assert.match(r.zones["ultrastable.io"].error, /403 denied/);
});

test("the plan never routes an ultrastable hostname to an originating-fleet worker", () => {
  for (const p of PLAN) for (const [, svc] of [...p.domains, ...p.routes]) assert.ok(!/^qnfo-/.test(svc), svc);
});

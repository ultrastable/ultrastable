// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from "node:test";
import assert from "node:assert/strict";
import { originOf, inspect, register, recheck, CORE } from "./directory.js";

function fakeDb() {
  const rows = new Map();
  const prep = (sql) => ({ bind: (...a) => ({
    first: async () => (sql.startsWith("SELECT checked") ? rows.get(a[0]) || null : null),
    all: async () => ({ results: [...rows.values()].filter(r => r.checked < a[0]).slice(0, a[1]) }),
    run: async () => {
      if (sql.startsWith("INSERT")) rows.set(a[0], { origin: a[0], name: a[1], repo: a[2], license: a[3], added: a[4], checked: a[4], fails: 0 });
      else if (sql.startsWith("DELETE")) rows.delete(a[0]);
      else if (sql.includes("fails = fails + 1")) { const r = rows.get(a[0]); r.fails++; r.checked = a[1]; }
      else if (sql.startsWith("UPDATE")) Object.assign(rows.get(a[0]), { name: a[1], checked: a[4], fails: 0 });
    } }) });
  return { rows, prepare: prep, batch: async () => [] };
}
const site = (man, page = "<html>hi</html>", hdr = {}) => async (u) => u.endsWith("/.well-known/ultrastable.json")
  ? { status: man ? 200 : 404, json: async () => man }
  : { ok: true, status: 200, headers: new Map(Object.entries(hdr)), text: async () => page };
const good = { ultrastable: 1, name: "Acme", url: "https://acme.example.org", repo: "https://github.com/acme/app", discoverable: true };
const req = (url) => new Request("https://ultrastable.io/api/directory/register", { method: "POST", body: JSON.stringify({ url }) });

test("core lists the platform and every live tenant", () => {
  assert.ok(CORE.find(c => c.id === "ultrastable"));
  assert.ok(CORE.filter(c => c.kind === "tenant").length >= 2);
});
test("only public https origins are accepted", () => {
  assert.equal(originOf("http://a.org"), null);
  assert.equal(originOf("https://localhost"), null);
  assert.equal(originOf("https://10.0.0.1"), null);
  assert.equal(originOf("https://a.org/x?y"), "https://a.org");
});
test("a site is listed only after its own manifest says so", async () => {
  assert.equal((await inspect("https://acme.example.org", site(null))).ok, false);
  assert.equal((await inspect("https://acme.example.org", site({ ...good, discoverable: false }))).optout, true);
  assert.equal((await inspect("https://acme.example.org", site({ ...good, url: "https://other.org" }))).ok, false);
  assert.equal((await inspect("https://acme.example.org", site(good, '<meta name="robots" content="noindex">'))).why, "noindex");
  assert.equal((await inspect("https://acme.example.org", site(good, "", { "x-robots-tag": "noindex" }))).why, "noindex");
  assert.equal((await inspect("https://acme.example.org", site(good))).entry.name, "Acme");
});
test("register then recheck drops a dead site after three days", async () => {
  const env = { DB: fakeDb() };
  assert.equal((await register(req("https://acme.example.org"), env, site(good))).status, 202);
  assert.equal(env.DB.rows.size, 1);
  const dead = async () => { throw new Error("down"); };
  let t = Date.now();
  for (let i = 1; i <= 3; i++) await recheck(env, dead, new Date(t + i * 21 * 3600e3));
  assert.equal(env.DB.rows.size, 0);
});
test("opt-out removes a listed site at once", async () => {
  const env = { DB: fakeDb() };
  await register(req("https://acme.example.org"), env, site(good));
  await recheck(env, site({ ...good, discoverable: false }), new Date(Date.now() + 21 * 3600e3));
  assert.equal(env.DB.rows.size, 0);
});

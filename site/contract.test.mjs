// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// FLEET-CONTRACT-1: the platform's own site serves the contract it reads from every tenant, and the /claims page shows every statement.
import test from "node:test";
import assert from "node:assert/strict";
import { specProblems, shows } from "../seed/worker/src/contract.js";
import { SPEC, contractRoutes } from "./contract.js";
const mod = (await import("./worker.js")).default;
const get = (p, env) => mod.fetch(new Request("https://ultrastable.io" + p), env, { waitUntil() {} });

test("the declaration is whole, and the manifest and the statements are served", async () => {
  assert.deepEqual(specProblems(SPEC), []);
  const m = await (await get("/.well-known/ultrastable.json")).json();
  assert.equal(m.ultrastable, 1); assert.equal(m.url, "https://ultrastable.io"); assert.equal(m.surfaces.health, "/health");
  const c = await (await get("/claims.json")).json();
  assert.deepEqual(c.statements.map(s => s.id), SPEC.statements.map(s => s.id));
});

test("back to front: the /claims page shows every statement's sentence; front to back: every statement's endpoint is routed", async () => {
  const page = await (await get("/claims")).text();
  for (const s of SPEC.statements) assert.ok(shows(page, s.text), s.id + " is on the page");
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("offline"); };
  try {
    for (const s of SPEC.statements) {
      const r = await get(s.api, {});
      assert.notEqual(r.status, 404, s.api + " is a route");
      assert.match(r.headers.get("content-type") || "", /json/, s.api + " answers with JSON even when its source is away");
    }
  } finally { globalThis.fetch = real; }
});

test("the social queue is the public calendar; an unreadable calendar is a 503 with the reason, never an empty queue", async () => {
  const u = new URL("https://ultrastable.io/social-queue.json");
  const ok = await contractRoutes(u, {}, async () => Response.json({ posts: [{ id: "a", date: "2026-11-25", text: "t", texts: { bluesky: "x" } }] }));
  assert.deepEqual((await ok.json()).posts, [{ id: "a", date: "2026-11-25", text: "t", url: null, kind: null }]);
  const bad = await contractRoutes(u, {}, async () => new Response("no", { status: 404 }));
  assert.equal(bad.status, 503); assert.equal((await bad.json()).error, "calendar_unreadable");
});

test("the audit chain's head is reachable on the site through the tick binding", async () => {
  const env = { TICK: { fetch: async r => Response.json({ seq: 7, path: new URL(r.url).pathname }) } };
  assert.deepEqual(await (await contractRoutes(new URL("https://ultrastable.io/api/audit/head"), env)).json(), { seq: 7, path: "/api/audit/head" });
  assert.equal((await contractRoutes(new URL("https://ultrastable.io/api/audit/head"), {})).status, 503);
  assert.equal(await contractRoutes(new URL("https://ultrastable.io/api/other"), {}), null);
});

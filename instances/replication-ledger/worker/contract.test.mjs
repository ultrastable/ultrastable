// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// FLEET-CONTRACT-1: the ledger serves the fleet contract, and every statement holds front to back and back to front against the real router.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { verify, routesIn } from "../vendor/ultrastable/contract.js";
import { guard } from "../vendor/ultrastable/promoqueue.js";
import { route } from "./index.js";
import { SPEC, HOOK, socialQueue } from "./contract.js";

const ledger = JSON.parse(readFileSync(new URL("./data/findings.json", import.meta.url), "utf8"));
const now = new Date().toISOString();
// a ledger whose loop ran a minute ago, as in production; the graph endpoint needs D1 and is read live by the platform (graph.test.mjs covers its logic)
const live = { checks: {}, beats: [{ started_at: now, ended_at: now, checked: 1, attempts: 0, leads: 0, findings: 0, errors: "[]" }], beat: { ended_at: now }, changes: [], cites: {} };
const site = async path => path.startsWith("/api/graph") ? new Response('{"ok":true}', { headers: { "content-type": "application/json" } }) : route("https://x.test" + path, ledger, live);

test("every surface answers and every statement is backed, both ways; every public endpoint is named by a statement", async () => {
  const apis = [...routesIn(readFileSync(new URL("./index.js", import.meta.url), "utf8")), "/api/graph"];
  assert.ok(apis.includes("/api/findings") && apis.includes("/api/citations"), "the router's endpoints were read");
  const r = await verify(site, SPEC, { apis });
  assert.deepEqual(r.failures, []);
});

test("a statement whose endpoint is removed fails the reading", async () => {
  const broken = async path => path === "/api/rubric" ? new Response("gone", { status: 404 }) : site(path);
  const r = await verify(broken, SPEC);
  assert.deepEqual(r.failures.map(f => [f.id, f.direction]), [["rubric", "front-to-back"], ["/api/rubric", "front-to-back"]]);  // the statement, and the footer link to it
});

test("the social queue is in the ledger's voice, never states the verdict and passes the shared guard", async () => {
  const q = socialQueue(ledger.findings, Date.parse("2026-12-10T00:00:00Z"));
  assert.ok(q.posts.length > 5 && q.refused.length === 0);
  for (const p of q.posts) {
    assert.deepEqual(guard(p.text, { hook: HOOK, link: p.url }), []);
    assert.ok(!/\b(failed|holds|held up\.|did not replicate)\b/i.test(p.text.split("\n")[0].replace("Did it hold up", "")), p.text);
  }
  const fields = q.posts.slice(0, 4).map(p => ledger.findings.find(f => p.url.endsWith("/f/" + f.id)).field);
  assert.ok(new Set(fields).size >= 3, "consecutive posts are about different fields");
});

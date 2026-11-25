// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// TENANT-PROMO-1 / ADMIT-1: the ledger promotes itself (a social queue the core publisher drains) and links its live siblings from every page.
import test from "node:test";
import assert from "node:assert/strict";
import { socialQueue, order, SIBLINGS, HOOK, SITE } from "./promote.js";
import { guard } from "../../../seed/worker/src/promoqueue.js";
import { route } from "./index.js";
import seed from "./data/findings.json" with { type: "json" };

test("the queue holds guarded posts with the hook and a link to the finding", () => {
  const q = socialQueue(Date.parse("2026-12-01T12:00:00Z"));
  assert.equal(q.tenant, "replication-ledger");
  assert.ok(q.posts.length > 0, "posts are due inside the window");
  for (const p of q.posts) {
    assert.ok(p.text.includes(HOOK), p.text);
    assert.ok(p.text.includes(SITE + "/f/"), p.text);
    assert.deepEqual(guard(p.text, { hook: HOOK, limit: 300 }), []);
  }
});

test("consecutive posts rotate across fields and every finding is queued once per cycle", () => {
  const o = order();
  assert.equal(o.length, seed.findings.length);
  assert.equal(new Set(o.map(f => f.id)).size, o.length);
  if (new Set(seed.findings.map(f => f.field)).size > 1) assert.notEqual(o[0].field, o[1].field);
});

test("/social-queue.json is served and pages link the live siblings, never the ledger itself", async () => {
  const r = route("https://x.test/social-queue.json");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).tenant, "replication-ledger");
  assert.ok(!SIBLINGS.some(c => c.id === "replication-ledger"));
  const page = await route("https://x.test/rubric").text();
  for (const c of SIBLINGS) assert.ok(page.includes(c.home), c.home);
});

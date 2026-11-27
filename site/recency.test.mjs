// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// RECENCY-1: a page or API with no recency stamp, or one past its schedule at build time, fails the site gate (scripts/site_tests.sh).
import test from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.js";

const env = {};
const get = (p) => worker.fetch(new Request("https://ultrastable.io" + p), env, { waitUntil() {} });

for (const p of ["/", "/roadmap", "/how", "/claims", "/product"]) {
  test(p + " shows when it was last updated and its schedule, and says so in headers", async () => {
    const r = await get(p);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("x-updated-at") || "", /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    assert.ok(r.headers.get("x-update-schedule"));
    assert.ok(r.headers.get("last-modified"));
    assert.match(await r.text(), /id="recency">Last updated \d\d:\d\d UTC on \d{4}-\d\d-\d\d\. Rebuilt after every merge/);
  });
}
test("/roadmap.json carries a recency field", async () => {
  const j = await (await get("/roadmap.json")).json();
  assert.ok(j.recency.updated_at); assert.equal(j.recency.max_age_s, 26 * 3600); assert.equal(typeof j.recency.stale, "boolean");
});

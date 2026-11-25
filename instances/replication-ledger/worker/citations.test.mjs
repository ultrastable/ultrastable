// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// /api/citations is a probe (fm-unverified-citations): after CITE_GRACE_BEATS beats, a seed DOI never checked at Crossref, or one that
// failed, answers 503, so "never verified" cannot read as verified.
import { test } from "node:test";
import assert from "node:assert/strict";
import { route, citations, CITE_GRACE_BEATS } from "./index.js";
import { seedCites } from "./store.js";
import { doiKey } from "./ledger.js";

const all = seedCites().map(c => doiKey(c.doi));
const rows = (keys, bad = []) => Object.fromEntries(keys.map(k => [k, { doi: k, ok: bad.includes(k) ? 0 : 1, issues: JSON.stringify(bad.includes(k) ? ["title differs"] : []) }]));
const live = (beatN, cites) => ({ checks: {}, beats: [], changes: [], cites, beat: beatN ? { n: beatN, ended_at: new Date().toISOString() } : null });

test("citations count every seed DOI once: total, checked, unchecked", () => {
  assert.ok(all.length > 10);
  assert.equal(new Set(all).size, all.length);
  const c = citations(live(3, rows(all.slice(0, 5))));
  assert.equal(c.total, all.length); assert.equal(c.checked, 5); assert.equal(c.unchecked, all.length - 5);
  assert.equal(c.ok, true, "inside the grace beats an unchecked DOI is not yet a failure");
});

test("after 24 beats an unchecked seed DOI makes /api/citations answer 503", async () => {
  assert.equal(CITE_GRACE_BEATS, 24);
  const res = route("https://x/api/citations", undefined, live(24, rows(all.slice(1))));
  assert.equal(res.status, 503);
  const j = await res.json();
  assert.equal(j.ok, false); assert.equal(j.verified, false); assert.equal(j.unchecked, 1); assert.deepEqual(j.unchecked_dois, [all[0]]);
});

test("after 24 beats a failed seed DOI makes /api/citations answer 503", async () => {
  const res = route("https://x/api/citations", undefined, live(30, rows(all, [all[2]])));
  assert.equal(res.status, 503);
  const j = await res.json();
  assert.equal(j.failed.length, 1); assert.equal(j.failed[0].doi, all[2]); assert.deepEqual(j.failed[0].issues, ["title differs"]);
});

test("every seed DOI checked and none failed answers 200 and verified", async () => {
  const res = route("https://x/api/citations", undefined, live(40, rows(all)));
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.verified, true); assert.equal(j.unchecked, 0); assert.equal(j.checked, j.total);
  assert.equal(route("https://x/api/citations").status, 200, "a Worker with no beats yet is inside the grace beats");
});

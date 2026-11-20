// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// Q-CRIT-PUBLIC-STAGE: the public stage reading comes from the tick Worker at request time, and a stopped tick cannot show its last stage.
import test from "node:test";
import assert from "node:assert/strict";
import { ignitionReading, ignitionResponse, TICK_INTERVAL_S } from "./live.js";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const live = at => ({ ok: true, k_eff: 0.5, k_self: 0.1, self_regime: "subcritical", open_ignition_gaps: 2, self_sustaining: false, pulse: { at },
  ignition: { stage: "ticking", since: "2026-11-15 19:40:16", at, bootstrapped: false, blocking: { stage: "looping", why: "no loop closed twice" }, log: [] } });
const tick = j => ({ fetch: async req => { assert.equal(new URL(req.url).pathname, "/live"); return new Response(JSON.stringify(j)); } });

test("a fresh reading returns the stage, the block and the time of the reading", async () => {
  const b = await ignitionReading({ TICK: tick(live("2026-11-20 11:55:00")) }, NOW);
  assert.equal(b.ok, true); assert.equal(b.stage, "ticking"); assert.equal(b.blocking.stage, "looping");
  assert.equal(b.age_s, 300); assert.equal(b.reading_at, "2026-11-20 11:55:00"); assert.equal(b.k_self, 0.1);
  assert.equal((await ignitionResponse({ TICK: tick(live("2026-11-20 11:55:00")) }, NOW)).status, 200);
});

test("a reading older than two tick intervals answers 503 stale_reading and shows no stage", async () => {
  const old = new Date(NOW - (2 * TICK_INTERVAL_S + 60) * 1000).toISOString().replace("T", " ").slice(0, 19);
  const r = await ignitionResponse({ TICK: tick(live(old)) }, NOW), b = await r.json();
  assert.equal(r.status, 503); assert.equal(b.code, "stale_reading"); assert.equal(b.stage, null); assert.equal(b.reading_at, old);
});

test("no binding, an unreachable tick and a tick with no reading are each a 503 with a code", async () => {
  assert.equal((await ignitionReading({}, NOW)).code, "no_binding");
  assert.equal((await ignitionReading({ TICK: { fetch: async () => { throw new Error("down"); } } }, NOW)).code, "tick_unreachable");
  assert.equal((await ignitionReading({ TICK: tick({ ok: true, ignition: null }) }, NOW)).code, "stale_reading");
});

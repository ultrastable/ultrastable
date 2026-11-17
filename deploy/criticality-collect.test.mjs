// Q-CRIT-COLLECTORS: the sample is computed from the repository's own records; nothing is sent without both the URL and the token.
import test from "node:test";
import assert from "node:assert/strict";
import { buildSample, main } from "./criticality-collect.mjs";

const NOW = Date.parse("2026-11-14T12:00:00Z");

test("sample counts verified and failed deploys in 24 h, spend from the criticality cost, and carries ignition gaps", () => {
  const s = buildSample({
    deploys: [{ at: "2026-11-14T08:00:00Z", uploaded: true, live_matches_commit: true }, { at: "2026-11-14T09:00:00Z", uploaded: true, live_matches_commit: false },
      { at: "2026-11-12T09:00:00Z", uploaded: true, live_matches_commit: true }],
    crit: [{ cost: 0.4 }, { cost: 1.25 }], ignition: { gaps: [{ link: "family Q-X grows", owner: "operations", closing_probe: "p", source: "throughput" }] }, touches: 2, now: NOW,
  });
  assert.equal(s.deploys_ok, 1); assert.equal(s.deploys_fail, 1); assert.equal(s.spend_units, 12.5); assert.equal(s.cap_breached, true);
  assert.equal(s.human_touches, 2); assert.deepEqual(s.ignition_gaps, [{ link: "family Q-X grows", owner: "operations", closing_probe: "p" }]);
});

test("without CRITICALITY_URL and CRITICALITY_TOKEN nothing is sent", async () => {
  let called = 0;
  const code = await main([], {}, async () => { called++; return { ok: false }; }, NOW);
  assert.equal(code, 0); assert.equal(called, 0);
});

test("posts the sample with the bearer and mirrors the live reading into the main repo", async () => {
  const calls = [];
  const fake = async (url, init = {}) => {
    calls.push([url, init.method || "GET", init.headers?.authorization]);
    if (url.endsWith("/api/criticality/sample")) return { status: 202, ok: true };
    if (url.endsWith("/metrics/criticality.json")) return { ok: true, json: async () => ({ k_eff: 1.5, open_ignition_gaps: 0 }) };
    if (url.includes("/contents/")) return init.method === "PUT" ? { status: 200, ok: true } : { ok: true, json: async () => ({ sha: "abc" }) };
    return { ok: false, json: async () => ({}) };
  };
  const code = await main([], { CRITICALITY_URL: "https://tick.example", CRITICALITY_TOKEN: "t0k", GH_TOKEN: "g" }, fake, NOW);
  assert.equal(code, 0);
  assert.ok(calls.some(([u, m, a]) => u === "https://tick.example/api/criticality/sample" && m === "POST" && a === "Bearer t0k"));
  assert.ok(calls.some(([u, m]) => u.endsWith("ultrastable/ultrastable/contents/metrics/criticality.json") && m === "PUT"));
});

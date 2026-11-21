// INTENT-YIELD-1: /yield renders from the generated data and scores no person.
import test from "node:test";
import assert from "node:assert/strict";
import { yieldPage, yieldRoutes } from "./intentyield.js";

const shell = (meta, body) => "<title>" + meta.title + "</title>" + body;
const Y = { at: "2026-11-21T00:00:00Z", settle_days: 30, target_kept_share: 0.8, error: null,
  summary: { intents: 2, measured: 1, kept_share: null, holding_share: 1, restated_share: 0.5 },
  intents: [{ id: "A-1", title: "Do <it>", date: "2026-11-20", verdict: "holding", restatements: 1, restates: null, item: null }] };

test("page renders every directive, escapes, and says no person is scored", () => {
  const h = yieldPage(shell, Y);
  assert.match(h, /A-1/);
  assert.match(h, /Do &lt;it&gt;/);
  assert.match(h, /no person is scored/);
  assert.match(h, /not settled yet/);
});

test("routes answer /yield and /yield.json only", async () => {
  const u = p => new URL("https://ultrastable.io" + p);
  assert.equal(await yieldRoutes(u("/other"), {}, shell, {}), null);
  const j = await yieldRoutes(u("/yield.json"), {}, shell, {});
  assert.equal(j.headers.get("Content-Type"), "application/json");
  const h = await yieldRoutes(u("/yield"), {}, shell, { "Content-Type": "text/html" });
  assert.match(await h.text(), /Intent yield/);
});

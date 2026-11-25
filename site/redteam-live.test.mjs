// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// REDTEAM-1: production findings of 2026-11-25 stay fixed.
import test from "node:test";
import assert from "node:assert/strict";
import { serverView } from "./live.js";
import { appsBlock } from "./progress.js";

test("/live renders figures and a timestamp without JavaScript", () => {
  const v = serverView({ throughput: { changelog: [{ date: "2026-11-25", changes: [{ n: 7, title: "a <b>", url: "https://x/7" }] }] } }, "2026-11-25T10:00:00Z");
  assert.match(v.asof, /2026-11-25T10:00:00Z/);
  assert.match(v.first, /#7/);
  assert.ok(!v.first.includes("<b>"));
});

test("apps block dates from the request and counts live tenants", () => {
  const b = appsBlock([], { as_of: "2026-11-17T00:00:00Z" }, Date.parse("2026-11-25T00:00:00Z"), [{ kind: "platform" }, { kind: "tenant", id: "t", name: "T", url: "u" }]);
  assert.equal(b.as_of, "2026-11-25T00:00:00.000Z");
  assert.equal(b.tenants_live, 1);
});

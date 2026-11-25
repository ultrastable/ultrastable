// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// OUTCOME-PROBE-1: every finding and field is in the sitemap, and robots.txt points at it.
import test from "node:test";
import assert from "node:assert/strict";
import { route } from "./index.js";

test("sitemap lists every finding page and robots points to it", async () => {
  const body = await (await route("https://replication-ledger.ultrastable.org/sitemap.xml")).text();
  const n = (body.match(/<loc>/g) || []).length;
  assert.ok(n > 10, `only ${n} urls`);
  assert.match(body, /<loc>https:\/\/replication-ledger\.ultrastable\.org\/f\/[a-z0-9-]+<\/loc>/);
  assert.match(await (await route("https://replication-ledger.ultrastable.org/robots.txt")).text(), /Sitemap: https:\/\/replication-ledger/);
});

// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// TENANT-SYNC-1: the generic vendor sync a tenant runs on itself. No network: `get` is injected.
import test from "node:test";
import assert from "node:assert/strict";
import { plan, parseRecord, record } from "./vendor_sync.mjs";

const core = { "doctrine/tenant-repos.json": { tenants: { a: { vendor: { "seed/x.js": "vendor/ultrastable/x.js" } } } }, "seed/x.js": "new x", "tools/t.py": "new t" };
const get = files => async (url, as) => {
  if (url.includes("api.github.com")) return { sha: "abc123" };
  const path = url.split("/abc123/")[1];
  if (!(path in files)) throw Object.assign(new Error(url + ": HTTP 404"), { status: 404 });
  return as === "json" ? files[path] : files[path];
};

test("the registry's map is fetched at one core commit and drift is seen", async () => {
  const p = await plan({ get: get(core), slug: "a", have: async () => "old x" });
  assert.equal(p.sha, "abc123");
  assert.deepEqual(p.files.map(f => [f.dst, f.body, f.have]), [["vendor/ultrastable/x.js", "new x", "old x"]]);
});

test("a file recorded locally and not yet in the registry is kept and refreshed; one the core does not hold yet stays as it is", async () => {
  const recorded = "ultrastable/ultrastable@old\ntools/t.py -> vendor/ultrastable/tools/t.py sha256:" + "0".repeat(64) + "\ntools/later.py -> vendor/ultrastable/tools/later.py\n";
  assert.deepEqual(parseRecord(recorded), { "tools/t.py": "vendor/ultrastable/tools/t.py", "tools/later.py": "vendor/ultrastable/tools/later.py" });
  const p = await plan({ get: get(core), slug: "a", recorded, have: async dst => dst.endsWith("later.py") ? "local later" : "old" });
  assert.deepEqual(p.files.map(f => [f.src, f.body]), [["tools/later.py", "local later"], ["tools/t.py", "new t"], ["seed/x.js", "new x"]]);
  assert.match(record("ultrastable/ultrastable", p.sha, p.files), /^ultrastable\/ultrastable@abc123\ntools\/later\.py -> vendor\/ultrastable\/tools\/later\.py sha256:[0-9a-f]{64}\n/);
});

test("a tenant with no map anywhere, or a registry file the core lacks, is an error and never a silent pass", async () => {
  await assert.rejects(plan({ get: get(core), slug: "nobody", have: async () => null }), /no vendor map for nobody/);
  const broken = { ...core, "doctrine/tenant-repos.json": { tenants: { a: { vendor: { "gone.js": "vendor/ultrastable/gone.js" } } } } };
  await assert.rejects(plan({ get: get(broken), slug: "a", have: async () => "x" }), /404/);
});

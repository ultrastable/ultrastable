// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// ACCOUNT-SPLIT-2: the old account's site forwards to the primary account's site and never to itself.
import assert from "node:assert/strict";
import mod, { forwardTo } from "./worker.js";
const seen = [];
globalThis.fetch = async (req) => { seen.push({ url: req.url, host: req.headers.get("x-forwarded-host"), method: req.method }); return new Response("upstream", { status: 200 }); };
const r = await mod.fetch(new Request("https://ultrastable.io/ops?x=1"), { UPSTREAM_ORIGIN: "https://ultrastable-site.ultrastable.workers.dev" }, {});
assert.equal(await r.text(), "upstream");
assert.deepEqual(seen[0], { url: "https://ultrastable-site.ultrastable.workers.dev/ops?x=1", host: "ultrastable.io", method: "GET" });
assert.equal(forwardTo(new Request("https://ultrastable-site.ultrastable.workers.dev/ops"), "https://ultrastable-site.ultrastable.workers.dev"), null, "never forwards to itself");
let ran = false; await mod.scheduled({}, { UPSTREAM_ORIGIN: "https://x" }, { waitUntil: () => { ran = true; } });
assert.equal(ran, false, "a forwarding site runs no cron");
console.log("forward ok");

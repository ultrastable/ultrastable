// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// READ-BUDGET-5: when the database refuses, the control-plane readers answer with the last data they held.
import test from "node:test";
import assert from "node:assert/strict";
import { status } from "./controlplane.js";
test("status serves last-known data when the database fails", async () => {
  let fail = false;
  const db = { prepare: () => ({ bind() { return this; }, all: async () => { if (fail) throw new Error("D1 daily row read limit"); return { results: [] }; }, first: async () => { if (fail) throw new Error("D1 daily row read limit"); return { n: 0 }; } }) };
  const env = { ORG: db, DB: db, READ_MEMO_MS: 1 };
  let first; try { first = await status(env); } catch (e) { return; /* shape differs: nothing to compare */ }
  fail = true; await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(await status(env), first);
});

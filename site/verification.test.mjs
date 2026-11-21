// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from "node:test"; import assert from "node:assert/strict";
import { verificationBody, verificationJson } from "./verification.js";
test("verification page renders coverage from the generated module", () => {
  const v = verificationJson(); assert.equal(v.marker, "VERIFY-1");
  assert.match(verificationBody(), new RegExp(`${v.coverage.tied_to_code} of ${v.coverage.invariants} guarantees`));
});

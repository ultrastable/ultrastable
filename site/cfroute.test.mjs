// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// AI-OIDC-1: the /__internal/cf allow-list forwards Workers AI inference for @cf models only, and nothing else new.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cfAllowed } from "./deployer.js";

test("Workers AI inference on @cf models is allowed", () => {
  for (const m of ["@cf/qwen/qwen2.5-coder-32b-instruct", "@cf/zai-org/glm-4.7-flash", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"]) assert.ok(cfAllowed("POST", "ai/run/" + m), m);
});

test("other AI paths, methods and traversal stay refused", () => {
  assert.ok(!cfAllowed("GET", "ai/run/@cf/zai-org/glm-4.7-flash"));
  assert.ok(!cfAllowed("POST", "ai/run/@hf/some/model"));
  assert.ok(!cfAllowed("POST", "ai/run/@cf/../workers/scripts/x"));
  assert.ok(!cfAllowed("POST", "ai/finetunes"));
  assert.ok(!cfAllowed("PUT", "workers/scripts/ultrastable-site"));
});

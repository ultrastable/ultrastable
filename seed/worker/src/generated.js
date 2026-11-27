// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// MERGE-NOW-1: files only a generator writes (scripts/regen_generated.py OUTPUTS, minus the hand-written READMEs whose claim blocks are handled
// separately). A PR's copy of these never matters: main regenerates them after every merge, so a conflict on them is resolved to main's side.
// seed/worker/test/mergenow.test.js fails when this list and OUTPUTS drift.
export const GENERATED = [
  "doctrine/decision-ledger.json",
  "ops/provenance.jsonl",
  "ops/research/prs.json",
  "site/claims-data.js",
  "site/dashboard-data.js",
  "site/self-data.js",
  "site/trajectory-data.js",
  "ops/trajectory.json",
  "ops/trajectory.jsonl",
  "site/ultrastability-data.js",
  "site/decisions-data.js",
  "site/research-data.js",
  "research/papers/chen-stratton-2026.md",
  "research/papers/open-loops-2026.md",
  "research/papers/safety-by-limits-2026.md",
  "ops/thought/log.jsonl",
  "research/papers/ashby-1952.md",
  "ops/decisions/outcomes.jsonl",
  "ops/decisions/rescore.jsonl",
  "ops/executor-log.jsonl",
  "instances/ultrastable/own-database.json",
  "docs/security/multi-tenant-controls.json",
  "core-contract.json",
  "doctrine/triggers.json",
  "seed/self/SELF.md",
  "seed/self/self.json",
  "seed/SYSTEM.md",
  "seed/docs/claims.json",
];
// GENERATED-BY-PATTERN-1 (2026-11-27): the list above names files one by one, so a paper added after it was written (second-loop-2026,
// perez-lopez-1974) and every ledger a generator appends to were read as hand-written code. A conflict on one was reported as code-conflict,
// nothing resolved it, and the closer shut the pull request (#2664 after 35 minutes, #2615 three times). A class of generator-owned files is
// a pattern: every paper, every site data module, every append-only ledger under ops/ and the snapshots the loops rewrite there.
export const GENERATED_PATTERNS = [/^research\/papers\/[^/]+\.md$/, /^site\/[^/]+-data\.js$/, /^ops\/.+\.jsonl$/, /^ops\/(?:transparency|trajectory|runway|saydo|yearsim|balance)\.json$/];
export const isGenerated = (p, list = GENERATED) => list.includes(p) || GENERATED_PATTERNS.some(r => r.test(p));

import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGaps, parseOwnerTable, html, collect } from "../repo-live.mjs";

const GAPS = `# t\n## BG-1: portal down (2026-11-10, closed)\nSymptom x. Closing probe y.\n## BG-2: deploy blocked (open)\nSymptom z.\n## Owner card: brand items (BG-23, identity-bound)\nDefault in effect. Closing probe: a.\n`;
test("parseGaps reads id, state and probe", () => {
  const g = parseGaps(GAPS);
  assert.deepEqual(g.map((x) => [x.id, x.state, x.hasProbe]), [["BG-1", "closed", true], ["BG-2", "open", false], ["BG-23", "open", true]]);
});
test("parseOwnerTable reads item, default and probe", () => {
  const md = "## 4. Owner-only items\n\n| Item | Default in effect | Closing probe |\n|---|---|---|\n| File it | Not filed | Receipt |\n\n## 5. Next\n";
  assert.deepEqual(parseOwnerTable(md), [{ item: "File it", default: "Not filed", probe: "Receipt" }]);
});
test("html escapes content", () => {
  const out = html({ generated: "t", gaps: [{ id: "BG-1", title: "<script>x</script>", state: "open", hasProbe: true }], ownerQueue: [], commits: [], lint: { findings: [] } });
  assert.ok(!out.includes("<script>x"));
});
test("collect runs against this repository", () => {
  const d = collect(fileURLToPath(new URL("../../", import.meta.url)));
  assert.ok(d.gaps.length >= 5); assert.ok(d.ownerQueue.length >= 3); assert.ok(d.commits.length >= 1); assert.ok(Array.isArray(d.lint.findings));
});

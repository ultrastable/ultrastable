# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SILENT-FAIL-1: bundle, overlap, live-citation, action_required and class checks, with injected I/O."""
import json, shutil, sys, tempfile, unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import silentfail as S  # noqa: E402


def scratch(files: dict) -> Path:
    d = Path(tempfile.mkdtemp(prefix="ultrastable-test-sf-"))
    for k, v in files.items():
        (d / k).parent.mkdir(parents=True, exist_ok=True); (d / k).write_text(v, encoding="utf-8")
    return d


class Silent(unittest.TestCase):
    def test_repository_is_clean(self):
        self.assertEqual(S.bundle_findings(), [])
        self.assertEqual(S.class_findings(), [])

    def test_bundle_finds_node_import_and_missing_file(self):
        cfg = json.loads((ROOT / S.CFG).read_text())
        cfg["bundle"] = {"groups": [{"wrangler": "w.jsonc", "source_globs": ["src/*.js"]}], "exclude_suffix": [".test.js"], "exclude_contains": [], "generated": ["src/gen.js"]}
        d = scratch({S.CFG: json.dumps(cfg), "w.jsonc": "{}", "src/a.js": "import fs from 'node:fs';\nimport './nope.js';\nimport './gen.js';\nimport './b.js';\n", "src/b.js": "export const x=1;"})
        self.addCleanup(shutil.rmtree, d, True)
        r = S.bundle_findings(d)
        self.assertEqual(sorted((x["kind"], x["import"]) for x in r), [("node-builtin", "node:fs"), ("unresolved", "./nope.js")])
        (d / "w.jsonc").write_text('{"compatibility_flags":["nodejs_compat"]}')
        self.assertEqual([x["kind"] for x in S.bundle_findings(d)], ["unresolved"])

    def test_overlap_catches_the_knowledge_datagraph_duplicate(self):
        cfg = json.loads((ROOT / S.CFG).read_text())
        cfg["overlap"]["module_globs"] = ["core/*/index.js"]
        d = scratch({S.CFG: json.dumps(cfg), "core/datagraph/index.js": "// graph of every row\n", "core/knowledge/index.js": "// a thing\n", "core/billing/index.js": "// invoices payments\n"})
        self.addCleanup(shutil.rmtree, d, True)
        self.assertEqual([x["existing"] for x in S.overlap_findings(["core/knowledge/index.js"], d)], ["core/datagraph/index.js"])
        self.assertEqual(S.overlap_findings(["core/billing/index.js"], d), [])

    def test_done_claim_must_cite_a_true_live_reading(self):
        ok = lambda u: (200, '{"changes":[1]}')
        self.assertEqual(S.cite_findings("fixed the thing", fetch=ok), [])  # no explicit claim, no requirement
        self.assertEqual(len(S.cite_findings("Status: done", fetch=ok)), 1)
        self.assertEqual(S.cite_findings('Status: done\nLive: GET https://ultrastable.io/api/live/changes expect "changes"', fetch=ok), [])
        self.assertTrue(S.cite_findings('Status: done\nLive: GET https://ultrastable.io/x expect "nope"', fetch=ok))
        self.assertTrue(S.cite_findings('Status: done\nLive: GET https://evil.example/x expect "changes"', fetch=ok))
        self.assertTrue(S.cite_findings('Status: done\nLive: GET https://ultrastable.io/x expect "a"', fetch=lambda u: (0, "timeout")))
        self.assertEqual(S.cite_findings("Status: done\nLive: n/a docs only, nothing deployed", fetch=ok), [])

    def test_live_run_rejects_empty_changes_and_the_wrong_claim(self):
        rows = S.live_run(fetch=lambda u: (200, '{"changes":[]}' if "changes" in u else "0 problems with no solution ok problem"))
        bad = {r["id"] for r in rows if not r["ok"]}
        self.assertEqual(bad, {"changes-nonzero", "ps-home-claim"})

    def test_actions_pass_approves_else_dispatches_and_finds_untaken_ideas(self):
        calls = []
        def api(m, p, d=None):
            calls.append((m, p))
            if p.startswith("/repos/o/r/actions/runs?"): return 200, {"workflow_runs": [{"id": 1, "workflow_id": 9, "name": "checks", "head_branch": "b", "actor": {"login": "github-actions[bot]"}}]}
            if "/approve" in p: return 403, {}
            if p.startswith("/repos/o/r/issues"): return 200, [{"number": 204, "created_at": "2026-11-22T10:00:00Z", "title": "idea", "comments": 0}]
            return 204, {}
        r = S.actions_pass(api, "o/r", now=datetime(2026, 11, 25, 12, tzinfo=timezone.utc), apply=True)
        self.assertEqual(r["remedied"], [1]); self.assertEqual(r["idea_issues"][0]["number"], 204)
        self.assertIn(("POST", "/repos/o/r/actions/workflows/9/dispatches"), calls)
        self.assertIn(("POST", "/repos/o/r/actions/workflows/issueloop.yml/dispatches"), calls)

    def test_stale_ledger(self):
        d = scratch({S.CFG: json.dumps({"ledgers": [{"path": "ops/a.jsonl", "max_age_hours": 24}, {"path": "ops/b.jsonl", "max_age_hours": 24}]}),
                     "ops/a.jsonl": json.dumps({"at": "2026-11-20T00:00:00Z"}) + "\n", "ops/b.jsonl": json.dumps({"at": "2026-11-25T11:00:00Z"}) + "\n"})
        self.addCleanup(shutil.rmtree, d, True)
        r = S.stale_findings(d, datetime(2026, 11, 25, 12, tzinfo=timezone.utc))
        self.assertEqual([x["ledger"] for x in r], ["ops/a.jsonl"])

    def test_classes_have_detectors(self):
        d = scratch({S.CFG: json.dumps({"classes": [{"id": "x", "detector": "nope", "failure_mode": "nope", "example": "e", "signatures": ["zzz"]}]}),
                     "doctrine/detectors.json": json.dumps({"detectors": []}), "doctrine/registers.json": json.dumps({"failure_modes": []}),
                     "docs/failures/2026-01-01-new-thing.md": "something never seen before"})
        self.addCleanup(shutil.rmtree, d, True)
        why = " | ".join(x["why"] for x in S.class_findings(d))
        self.assertIn("detector nope is not registered", why); self.assertIn("matches no silent-failure class", why)

    def test_wired_into_checks_and_audit(self):
        self.assertIn("foundation silentfail --check", (ROOT / ".github/workflows/checks.yml").read_text())
        ids = {x["id"] for x in json.loads((ROOT / "doctrine/detectors.json").read_text())["detectors"]}
        self.assertTrue({"actions-stuck", "worker-bundle", "module-overlap", "live-verify", "ledger-stale", "classes-complete", "model-routes"} <= ids)


if __name__ == "__main__":
    unittest.main()

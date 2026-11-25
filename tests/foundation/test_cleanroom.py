"""CLEANROOM-1 and COHERENCE-1: the sandbox boots from the seed alone and every surface agrees with its one source."""
import json
import tempfile
import unittest
from pathlib import Path

from foundation import cleanroom, coherence

ROOT = Path(__file__).resolve().parents[2]


class CleanRoom(unittest.TestCase):
    def test_wiring(self):
        self.assertEqual(cleanroom.check(), [])

    def test_sandbox_boots_runs_and_tears_down(self):
        rec = cleanroom.run(ticks=6)
        bad = {r["id"]: r["evidence"] for r in rec["results"] if not r["ok"]}
        self.assertEqual(bad, {})
        self.assertTrue(next(r for r in rec["results"] if r["id"] == "teardown")["ok"])

    def test_finding_is_filed_then_closed(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "docs/issues").mkdir(parents=True)
            fail = {"at": "t1", "passed": False, "findings": ["day"], "results": [{"id": "day", "what": "a day", "ok": False, "evidence": "tick 3 failed"}]}
            self.assertEqual(cleanroom.apply(fail, root), ["Q-CLEANROOM-day.json"])
            self.assertIn("**Status:** open", json.loads((root / "docs/issues/Q-CLEANROOM-day.json").read_text())["body"])
            self.assertEqual(cleanroom.apply(fail, root), [])  # an open item is not filed twice
            ok = dict(fail, passed=True, findings=[], results=[dict(fail["results"][0], ok=True, evidence="144 of 144")])
            cleanroom.apply(ok, root)
            body = json.loads((root / "docs/issues/Q-CLEANROOM-day.json").read_text())["body"]
            self.assertIn("**Status:** closed", body)
            self.assertIn("144 of 144", body)


class Coherence(unittest.TestCase):
    def test_repository_is_coherent(self):
        f = coherence.findings()
        self.assertEqual({k: v for k, v in f.items() if v}, {})

    def test_contradiction_is_caught_and_negation_is_not(self):
        spec = coherence.load()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            for rel in ["workers/tools/sync_agent_files.py", "workers/agents/CONTRACT.md"]:
                (root / rel).parent.mkdir(parents=True, exist_ok=True)
                (root / rel).write_text((ROOT / rel).read_text())
            (root / "agents").mkdir()
            (root / "agents/AGENTS.md").write_text("- **A.** Changing it needs a human reviewer.\n- **B.** Never report a PR as waiting for review.\n")
            spec = dict(spec, instruction_surfaces=["agents/AGENTS.md"])
            hits = coherence._contradictions(root, spec)
            self.assertEqual(len(hits), 1, hits)
            self.assertIn("needs a human reviewer", hits[0])

    def test_rule_ids_and_enforcement(self):
        text = "- **Do X (ABC-1, Rowan).** Code: `foundation/coherence.py`.\n- **Do Y (XYZ-2).** Nothing named.\n"
        self.assertEqual(sorted(coherence.rules(text)), ["ABC-1", "XYZ-2"])

    def test_org_settings_cover_every_tenant_repository(self):
        want = coherence.org_settings()
        tenants = json.loads((ROOT / "doctrine/tenant-repos.json").read_text())["tenants"]
        for t in tenants.values():
            if t.get("state") in coherence.load()["tenant_repo_states"]:
                e = want["repos"][t["repo"]]
                self.assertTrue(e["settings"]["delete_branch_on_merge"])
                self.assertFalse(e["branch_protection"]["allow_force_pushes"])


if __name__ == "__main__":
    unittest.main()

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SEED-SHIP-1: every seed is built, deployed and runs a year unattended; a proposal alone fails."""
import json, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path

from foundation import seedship

ROOT = Path(__file__).resolve().parents[2]


def _tree(t: Path):
    for f in ("doctrine/seed-ship.json", "doctrine/credwatch.json", "doctrine/topology.json", ".github/dependabot.yml",
              "seed/autonomy/yearsim.json", "seed/autonomy/goals.json"):
        (t / f).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / f, t / f)
    (t / ".github/workflows").mkdir(parents=True, exist_ok=True)
    (t / ".github/workflows/heal.yml").write_text("on: workflow_dispatch\n")
    (t / "instances/ultrastable").mkdir(parents=True)
    c = json.loads((t / "doctrine/seed-ship.json").read_text())
    c["baseline"]["seeds"] = []
    (t / "doctrine/seed-ship.json").write_text(json.dumps(c))
    (t / "instances/ultrastable/progress.json").write_text(json.dumps({"systems": [
        {"id": "ultrastable", "repo": "ultrastable/ultrastable", "expect_hours": 24, "heal": ["heal.yml"]},
        {"id": "demo", "repo": "ultrastable/ultrastable", "url": "https://demo.example", "expect_hours": 24, "heal": ["heal.yml"]}]}))
    (t / "instances/demo").mkdir()
    (t / "instances/demo/IDEA.md").write_text("# Idea\n\nA proposal.\n")


def _ship(t: Path, worker="ultrastable-tenants", **u):
    (t / "apps/demo/src").mkdir(parents=True, exist_ok=True)
    (t / "apps/demo/src/index.js").write_text("export default {}\n")
    (t / "apps/demo/test.mjs").write_text("// test\n")
    un = {"heartbeat_hours": 1, "credentials": [], "budget_usd_month": 0, "dependencies": ["/"]}
    un.update(u)
    (t / "instances/demo/ship.json").write_text(json.dumps({
        "build": {"paths": ["apps/demo/src/index.js"], "tests": ["apps/demo/test.mjs"]},
        "deploy": {"worker": worker, "url": "https://demo.example", "health": "https://demo.example/health"},
        "unattended": un}))


def _deployed(t: Path, worker="ultrastable-tenants"):
    (t / "ops").mkdir(exist_ok=True)
    (t / "ops/deploys.jsonl").write_text(json.dumps({"worker": worker, "uploaded": True, "live_matches_commit": True}) + "\n")


class SeedShip(unittest.TestCase):
    def test_repository_passes_its_own_check(self):
        self.assertEqual(seedship.check(ROOT), [])

    def test_target_is_autonomous_for_a_year(self):
        c = seedship.cfg(ROOT)
        self.assertEqual(c["target"]["stage"], "autonomous")
        self.assertGreaterEqual(c["target"]["unattended_days"], 365)

    def test_proposal_alone_fails_the_check(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t); _tree(t)
            bad = seedship.check(t)
            self.assertTrue(any("demo has no instances/demo/ship.json" in b for b in bad), bad)
            self.assertEqual(seedship.assess("demo", t)["stage"], "proposed")

    def test_stages_advance_only_on_evidence(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t); _tree(t); _ship(t)
            self.assertEqual(seedship.assess("demo", t)["stage"], "built")      # code, no deploy
            _deployed(t)
            r = seedship.assess("demo", t)
            self.assertEqual(r["stage"], "autonomous", r["missing"])
            self.assertEqual(seedship.probe("demo", t), 0)

    def test_unwatched_credential_keeps_it_short_of_autonomous(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t); _tree(t); _ship(t, credentials=["SOME_UNWATCHED_TOKEN"]); _deployed(t)
            r = seedship.assess("demo", t)
            self.assertEqual(r["stage"], "deployed")
            self.assertIs(r["readiness"]["credentials"], False)

    def test_undeclared_budget_is_unmeasured_never_a_pass(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t); _tree(t); _ship(t, budget_usd_month=None); _deployed(t)
            r = seedship.assess("demo", t)
            self.assertEqual(r["stage"], "deployed")
            self.assertIsInstance(r["readiness"]["cost"], str)

    def test_run_files_then_closes_the_item(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t); _tree(t)
            seedship.run(t, apply=True)
            it = json.loads((t / "docs/issues/Q-SEED-demo.json").read_text())
            self.assertIn("seedship --probe demo", it["body"])
            self.assertIn("**Status:** open", it["body"])
            _ship(t); _deployed(t)
            seedship.run(t, apply=True)
            it = json.loads((t / "docs/issues/Q-SEED-demo.json").read_text())
            self.assertIn("**Status:** closed", it["body"])
            self.assertEqual(json.loads((t / "ops/seedship.json").read_text())["autonomous"], ["demo"])

    def test_bootstrap_dry_run_is_not_a_shipped_seed(self):
        with tempfile.TemporaryDirectory() as t:
            root = Path(t) / "seed"  # a copy: the bootstrap writes funding/registry.json into its root
            shutil.copytree(ROOT / "seed", root, ignore=shutil.ignore_patterns("node_modules", "__pycache__", ".wrangler"))
            out = root / "org"
            subprocess.run([sys.executable, str(root / "bootstrap/bootstrap.py"), "--root", str(root), "--out", str(out)], capture_output=True, text=True)
            u = json.loads((out / "unattended.json").read_text())
            self.assertFalse(u["ready"])
            self.assertFalse(u["checks"]["deployed"])
            self.assertTrue(u["checks"]["dependencies"] and u["checks"]["self_repair"] and u["checks"]["year_model"], u)
            ids = {i["id"] for i in json.loads((out / "backlog.json").read_text())}
            self.assertIn("SHIP-DEPLOYED", ids)


if __name__ == "__main__":
    unittest.main()

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SEED-LIFECYCLE-1: a seed cannot be reported done while it is undeployed, and is autonomous only with every one-year survival class answered."""
import datetime as dt, json, shutil, unittest
from pathlib import Path

import _repo
from foundation import seedlife

REPO = Path(__file__).resolve().parents[2]
NOW = dt.datetime(2026, 11, 21, 12, tzinfo=dt.timezone.utc)
IDEA = "---\nslug: s1\n---\n\n# Idea\n\nA tracker that keeps running.\n\n# System test\n\n- Loop: x\n- Measure: y\n- Upkeep: z\n- Run cost: 5 USD\n"


def w(root, rel, obj):
    p = Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(obj if isinstance(obj, str) else json.dumps(obj), encoding="utf-8")


class Fixture(unittest.TestCase):
    def setUp(self):
        self.root = _repo.scratch()
        shutil.copytree(REPO / "seed/scripts", self.root / "seed/scripts")
        w(self.root, "doctrine/seed-lifecycle.json", (REPO / "doctrine/seed-lifecycle.json").read_text(encoding="utf-8"))
        c = json.loads((self.root / "doctrine/seed-lifecycle.json").read_text(encoding="utf-8"))
        c["not_seeds"], c["fixtures"] = {}, {}
        w(self.root, "doctrine/seed-lifecycle.json", c)
        self.core = {x["default_inherit"]: {"id": x["default_inherit"], "status": "closed"} for x in c["survival"] if x.get("default_inherit")}
        w(self.root, "doctrine/unattended.json", {"dependencies": list(self.core.values())})
        w(self.root, "instances/s1/IDEA.md", IDEA)
        w(self.root, "instances/s1/instance.json", {"slug": "s1"})
        w(self.root, "app/worker.js", "export default {}")
        w(self.root, "app/worker.test.js", "")
        w(self.root, "site/legalpages.js", "export const PRIVACY = ''")
        w(self.root, "foundation/seedlife.py", "")
        lc = seedlife.scaffold(self.root, "s1")
        lc["survival"]["privacy"] = {"status": "closed", "probe": "file:site/legalpages.js"}
        self.lc = lc
        self.save()

    def save(self):
        w(self.root, "instances/s1/lifecycle.json", self.lc)

    def built(self):
        self.lc["build"] = {"paths": ["app/worker.js"], "tests": ["app/worker.test.js"]}
        self.save()

    def deployed(self):
        self.built()
        self.lc["deploy"] = {"worker": "s1-app"}
        self.save()
        w(self.root, "ops/deploys.jsonl", json.dumps({"worker": "s1-app", "uploaded": True, "live_matches_commit": True}) + "\n")

    def live(self):
        self.deployed()
        self.lc["verify"] = {"url": "https://s1.example/health", "expect": "ok"}
        self.save()
        seedlife.verify(self.root, apply=True, fetch=lambda u: (200, '{"ok":true}'), now=NOW)

    def autonomous(self):
        self.live()
        self.lc["loops"] = ["watchdog"]
        self.save()
        w(self.root, "doctrine/topology.json", {"workers": [{"id": "s1-app", "state": "live"}]})
        w(self.root, "doctrine/clocks.json", {"clocks": [{"id": "watchdog"}]})
        w(self.root, "instances/ultrastable/progress.json", {"systems": [{"id": "s1"}]})

    def stage(self):
        return seedlife.status(self.root, "s1", NOW)[0]


class Stages(Fixture):
    def test_plan_only_seed_is_planned_and_cannot_claim_done(self):
        self.assertEqual(self.stage()["stage"], "planned")
        self.lc["claim"] = "autonomous"; self.save()
        self.assertTrue(any("claims autonomous" in b for b in seedlife.check(self.root, NOW)))

    def test_manifest_status_launched_while_undeployed_fails(self):
        self.built()
        w(self.root, "instances/s1/instance.json", {"slug": "s1", "status": "launched"})
        self.assertEqual(self.stage()["stage"], "built")
        self.assertTrue(any("only an autonomous seed is done" in b for b in seedlife.check(self.root, NOW)))

    def test_progress_listing_needs_a_deploy(self):
        self.built()
        w(self.root, "instances/ultrastable/progress.json", {"systems": [{"id": "s1"}]})
        self.assertTrue(any("nothing of it is deployed" in b for b in seedlife.check(self.root, NOW)))

    def test_closed_item_while_not_autonomous_fails(self):
        it = seedlife.item(self.stage()); it["body"] = it["body"].replace("**Status:** open", "**Status:** closed")
        w(self.root, "docs/issues/Q-SEED-s1.json", it)
        self.assertTrue(any("closed while the seed is planned" in b for b in seedlife.check(self.root, NOW)))

    def test_closed_item_with_a_recorded_disposition_is_a_final_record(self):
        it = seedlife.item(self.stage()); it["body"] = it["body"].replace("**Status:** open", "**Status:** closed") + "\n\n**Disposition:** shelved (ttl, 2026-11-22T00:00:00Z, DISPOSE-1)\n"
        w(self.root, "docs/issues/Q-SEED-s1.json", it)
        self.assertFalse(any("closed while the seed" in b for b in seedlife.check(self.root, NOW)))

    def test_stages_advance_only_with_evidence(self):
        self.deployed(); self.assertEqual(self.stage()["stage"], "deployed")
        self.live(); self.assertEqual(self.stage()["stage"], "live")
        self.autonomous(); r = self.stage()
        self.assertEqual(r["stage"], "autonomous", r["need"])
        self.assertEqual(seedlife.probe("s1", self.root, NOW), 0)  # fixed clock: the 48 h verify window made this test fail from 2026-11-23 on wall-clock time

    def test_seed_deploy_list_counts_as_the_lane_owning_the_worker(self):
        self.autonomous()
        w(self.root, "doctrine/topology.json", {"workers": []})
        self.assertEqual(self.stage()["stage"], "live")
        w(self.root, "doctrine/seed-deploys.json", {"seeds": ["s1"]})
        self.assertEqual(self.stage()["stage"], "autonomous", self.stage()["need"])

    def test_failed_or_stale_verify_is_not_live(self):
        self.deployed()
        self.lc["verify"] = {"url": "https://s1.example/health", "expect": "ok"}; self.save()
        seedlife.verify(self.root, apply=True, fetch=lambda u: (503, "down"), now=NOW)
        self.assertEqual(self.stage()["stage"], "deployed")
        seedlife.verify(self.root, apply=True, fetch=lambda u: (200, "ok"), now=NOW - dt.timedelta(days=5))
        self.assertEqual(self.stage()["stage"], "deployed")

    def test_open_core_input_holds_every_seed_below_autonomous(self):
        self.autonomous()
        self.core["offsite-backup"]["status"] = "open"
        w(self.root, "doctrine/unattended.json", {"dependencies": list(self.core.values())})
        r = self.stage()
        self.assertEqual(r["stage"], "live"); self.assertIn("backups", r["open"])

    def test_gate_is_an_honest_limit_unless_it_lapses_inside_the_year(self):
        self.autonomous()
        self.core["payment-method"].update(status="gate")
        w(self.root, "doctrine/unattended.json", {"dependencies": list(self.core.values())})
        r = self.stage(); self.assertEqual(r["stage"], "autonomous"); self.assertEqual(r["gates"], ["payment"])
        self.core["payment-method"]["expires"] = "2027-03-01"
        w(self.root, "doctrine/unattended.json", {"dependencies": list(self.core.values())})
        r = self.stage(); self.assertEqual(r["stage"], "live"); self.assertEqual(r["horizon_days"], 100)

    def test_run_files_one_item_and_closes_it_when_autonomous(self):
        seedlife.run(self.root, apply=True, now=NOW, live=False)
        it = json.loads((self.root / "docs/issues/Q-SEED-s1.json").read_text(encoding="utf-8"))
        self.assertIn("**Status:** open", it["body"]); self.assertIn("seedlife --probe s1", it["body"])
        self.autonomous()
        seedlife.run(self.root, apply=True, now=NOW, live=False)
        self.assertIn("**Status:** closed", json.loads((self.root / "docs/issues/Q-SEED-s1.json").read_text(encoding="utf-8"))["body"])
        self.assertIn("**Evidence:**", json.loads((self.root / "docs/issues/Q-SEED-s1.json").read_text(encoding="utf-8"))["body"])  # queue --check: closed needs evidence
        self.assertEqual(seedlife.check(self.root, NOW), [])

    def test_malformed_answers_fail(self):
        self.lc["survival"]["privacy"] = {"status": "gate"}
        self.lc["survival"]["health"] = {"status": "closed", "probe": "file:nope.js"}
        self.save()
        bad = seedlife.check(self.root, NOW)
        self.assertTrue(any("privacy is a gate" in b for b in bad)); self.assertTrue(any("health is closed" in b for b in bad))


class Repo(unittest.TestCase):
    def test_repository_passes_and_target_is_a_year(self):
        self.assertEqual(seedlife.check(), [])
        self.assertGreaterEqual(seedlife.cfg()["target_days"], 365)

    def test_every_seed_is_judged_and_would_be_tracked(self):
        # A seed merged to main gets its Q-SEED item on the next watchdog pass (seedlife --run --apply); requiring the file here made every
        # open PR fail whenever another PR added a seed (Unlearn, intent-yield on 2026-11-21). Filing itself is proven in the fixture tests.
        rs = seedlife.status()
        self.assertEqual(sorted(r["slug"] for r in rs), seedlife.seeds())
        for r in rs:
            if r.get("stage") != "autonomous":
                it = seedlife.item(r)
                self.assertIn(f"seedlife --probe {r['slug']}", it["body"]); self.assertIn("**Status:** open", it["body"])

    def test_seed_template_carries_the_engine(self):
        self.assertTrue((REPO / "seed/scripts/seedlife.py").is_file())
        rules = json.loads((REPO / "seed/autonomy/seed-lifecycle.json").read_text(encoding="utf-8"))
        self.assertEqual([c["id"] for c in rules["survival"]], [c["id"] for c in seedlife.cfg()["survival"]])


if __name__ == "__main__":
    unittest.main()

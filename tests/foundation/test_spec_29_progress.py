# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-SPEC-29 (visible progress, content stickiness and substantive change): the platform check `python3 -m foundation progress`.

US-29-R70 the declaration of the systems and the wiring of the loop, US-29-R71 the live reading of the deployed record, US-29-R72 the launch cadence of apps."""
import datetime as dt
import json, sys, tempfile, unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import progress  # noqa: E402

REAL_WIRED = dict(progress.WIRED)  # the wiring as declared, before a test replaces it

GOOD = {"stall": 2, "cooldown_hours": 6, "systems": [
    {"id": "core", "name": "Core", "repo": "ultrastable/ultrastable", "url": "https://c", "expect_hours": 24, "heal": ["executor.yml"]},
    {"id": "tenant", "name": "Tenant", "repo": "ultrastable/t", "url": "https://t", "expect_hours": 168, "heal": ["agent.yml"]}]}


class Declaration(unittest.TestCase):
    def setUp(self):
        td = tempfile.TemporaryDirectory(prefix="ultrastable-test-spec29-"); self.addCleanup(td.cleanup)
        self.d = Path(td.name)
        (self.d / ".github/workflows").mkdir(parents=True)
        (self.d / ".github/workflows/executor.yml").write_text("on:\n  workflow_dispatch:\n")
        (self.d / progress.CONFIG).parent.mkdir(parents=True)
        self.patch = mock.patch.object(progress, "WIRED", {})
        self.patch.start(); self.addCleanup(self.patch.stop)

    def put(self, cfg):
        (self.d / progress.CONFIG).write_text(json.dumps(cfg), encoding="utf-8")

    def check(self, cfg):
        self.put(cfg)
        return progress.check(self.d)

    def test_us_29_r70_a_well_formed_declaration_passes_and_the_repository_declaration_is_clean(self):
        self.assertEqual(self.check(GOOD), [])
        self.assertEqual(progress.check(ROOT), [])
        cfg = json.loads((ROOT / progress.CONFIG).read_text(encoding="utf-8"))
        self.assertEqual(cfg["marker"], progress.RULE)
        self.assertTrue(all(s["expect_hours"] <= 168 and s["heal"] for s in cfg["systems"]), "every listed system declares a cadence inside a week and a repair")

    def test_us_29_r70_each_system_needs_its_identity_a_cadence_inside_a_week_and_a_repair_that_can_be_dispatched(self):
        c = json.loads(json.dumps(GOOD))
        c["systems"][1].update({"expect_hours": 169, "heal": []})
        c["systems"][0]["heal"] = ["nope.yml"]
        del c["systems"][0]["url"]
        bad = self.check(c)
        self.assertTrue(any("system core: missing url" in b for b in bad))
        self.assertTrue(any("tenant" in b and "longer than a week" in b for b in bad))
        self.assertTrue(any("tenant" in b and "no heal workflow" in b for b in bad))
        self.assertTrue(any("heal workflow nope.yml does not exist" in b for b in bad))
        (self.d / ".github/workflows/nope.yml").write_text("on: push\n")
        self.assertTrue(any("heal workflow nope.yml cannot be dispatched" in b for b in self.check(c)))
        c2 = json.loads(json.dumps(GOOD)); c2["systems"][1]["expect_hours"] = 0
        self.assertTrue(any("expect_hours must be a positive number" in b for b in self.check(c2)))
        c3 = json.loads(json.dumps(GOOD)); c3["systems"].append(dict(c3["systems"][0]))
        self.assertTrue(any("listed twice" in b for b in self.check(c3)))

    def test_us_29_r70_the_file_needs_systems_a_stall_factor_and_a_cooldown_and_an_unreadable_file_is_a_finding(self):
        self.assertTrue(any("no systems listed" in b for b in self.check({"stall": 2, "cooldown_hours": 6, "systems": []})))
        bad = self.check({"systems": GOOD["systems"], "stall": 0})
        self.assertEqual(sorted(b.split(":")[1].split()[0] for b in bad if "must be a positive number" in b), ["cooldown_hours", "stall"])
        (self.d / progress.CONFIG).write_text("{not json")
        self.assertTrue(progress.check(self.d)[0].startswith(f"{progress.CONFIG}: unreadable"))
        (self.d / progress.CONFIG).unlink()
        self.assertTrue(progress.check(self.d)[0].startswith(f"{progress.CONFIG}: unreadable"))

    def test_us_29_r70_a_wired_file_that_is_missing_or_no_longer_carries_its_marker_is_a_finding(self):
        self.put(GOOD)
        with mock.patch.object(progress, "WIRED", {"a.js": ["export function cadence("], "b.js": ["x"]}):
            (self.d / "a.js").write_text("// gone")
            bad = progress.check(self.d)
        self.assertIn("a.js: no longer carries `export function cadence(`", bad)
        self.assertIn("b.js: missing", bad)
        for rel in ("seed/worker/src/index.js", "site/progress.js", "workers/core/progress/index.js", "agents/AGENTS.md", "seed/agents/AGENTS.md", "deploy/deploy-workers.mjs"):
            self.assertIn(rel, REAL_WIRED)


class Live(unittest.TestCase):
    OK = {"systems": [{"id": "a", "state": "moving"}, {"id": "b", "state": "slow"}], "digests": {"weekly": {"substantive": 3}}}

    def test_us_29_r71_the_deployed_record_passes_when_every_system_is_measured_and_something_substantive_shipped_in_seven_days(self):
        self.assertEqual(progress.live(fetch=lambda u: self.OK), [])
        seen = []
        progress.live("https://example.test/progress.json", fetch=lambda u: seen.append(u) or self.OK)
        self.assertEqual(seen, ["https://example.test/progress.json"])

    def test_us_29_r71_a_stalled_or_unmeasured_system_an_empty_record_a_quiet_week_and_an_unreadable_record_are_each_a_finding(self):
        bad = progress.live(fetch=lambda u: {"systems": [{"id": "a", "state": "stalled", "last_at": "2026-11-01"}, {"id": "b", "state": "unmeasured"}], "digests": {"weekly": {"substantive": 0}}})
        self.assertEqual(len(bad), 3)
        self.assertIn("system a: stalled, last change 2026-11-01", bad); self.assertIn("system b: unmeasured", bad)
        self.assertIn("nothing substantive shipped fleetwide in 7 days", bad)
        self.assertIn("no systems reported", progress.live(fetch=lambda u: {"systems": [], "digests": {"weekly": {"substantive": 1}}}))
        self.assertIn("nothing substantive shipped fleetwide in 7 days", progress.live(fetch=lambda u: {"systems": [{"id": "a", "state": "moving"}]}), "a record with no digest is not a pass")

        def down(u):
            raise OSError("connection refused")
        out = progress.live(fetch=down)
        self.assertEqual(len(out), 1); self.assertIn("unreadable (connection refused)", out[0])


class Apps(unittest.TestCase):
    def setUp(self):
        td = tempfile.TemporaryDirectory(prefix="ultrastable-test-spec29-"); self.addCleanup(td.cleanup)
        self.d = Path(td.name)
        (self.d / progress.CONFIG).parent.mkdir(parents=True)
        (self.d / progress.CONFIG).write_text(json.dumps({**GOOD, "apps": {"expect_days": 21}}))
        self.t0 = dt.datetime(2026, 11, 20, tzinfo=dt.timezone.utc)

    def launch(self, slug, when):
        p = self.d / "instances/spinoffs" / slug / "app.json"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"launched": when}))

    def test_us_29_r72_a_launch_inside_the_declared_days_passes_and_a_later_one_than_that_means_the_loop_has_run_dry(self):
        self.assertEqual(progress.apps(self.d, now=self.t0), ["no app has ever been launched"])
        self.launch("a", "2026-11-01T00:00:00Z"); self.launch("b", "2026-10-01T00:00:00Z"); (self.d / "instances/spinoffs/c").mkdir(); (self.d / "instances/spinoffs/c/app.json").write_text("{}")
        self.assertEqual(progress.apps(self.d, now=self.t0), [], "the newest launch counts, an app with no launch time does not")
        self.assertEqual(progress.apps(self.d, now=dt.datetime(2026, 11, 22, tzinfo=dt.timezone.utc)), [], "exactly 21 days is inside")
        late = progress.apps(self.d, now=dt.datetime(2026, 11, 23, tzinfo=dt.timezone.utc))
        self.assertEqual(len(late), 1); self.assertIn("no app launched for 22 days", late[0]); self.assertIn("run dry", late[0])
        self.assertIn("the loop declares one at least every 21", late[0])

    def test_us_29_r72_the_days_and_the_registry_are_the_declarations_own(self):
        (self.d / progress.CONFIG).write_text(json.dumps({**GOOD, "apps": {"expect_days": 3, "registry": "reg"}}))
        p = self.d / "reg/x/app.json"; p.parent.mkdir(parents=True); p.write_text(json.dumps({"launched": "2026-11-10T00:00:00Z"}))
        self.assertEqual(len(progress.apps(self.d, now=self.t0)), 1)
        self.assertEqual(progress.apps(self.d, now=dt.datetime(2026, 11, 12, tzinfo=dt.timezone.utc)), [])


if __name__ == "__main__":
    unittest.main()

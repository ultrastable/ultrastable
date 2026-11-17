# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""UIUX-1: the UI/UX manager loop. Synthetic hits and audit reports drive the real functions: user paths from the stakeholder doctrine, funnels and drop detection,
A/B tallies and the pre-registered decision, auto-promotion into the served data, the filed fix items and their probe, and the two essential variables the slow loop reads."""
import json, shutil, sys, unittest
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import scratch  # removed when the test ends
from foundation import uiux as U, design, ultrastability

REPO = Path(__file__).resolve().parents[2]
NOW = datetime(2026, 11, 17, 12, 0, tzinfo=timezone.utc).timestamp()
D = 86400


def hit(vid, path, t, name="pageview"):
    return {"vid": vid, "at": t, "path": path, "name": name, "bot": 0}


class Declaration(unittest.TestCase):
    def test_repo_check(self):
        self.assertEqual(U.check(REPO), [])

    def test_paths_follow_the_stakeholder_doctrine(self):
        ids = {p["id"]: p for p in U.user_paths(REPO)}
        self.assertEqual(ids["audience-founders"]["entry"], "/for/founders")
        self.assertEqual(ids["audience-founders"]["steps"], ["/product", "/showcase", "/start"])
        self.assertIn("home-to-setup", ids)
        self.assertTrue(all(p["steps"] for p in ids.values()))

    def test_essential_variables_are_declared_for_the_slow_loop(self):
        v = {x["id"]: x for x in ultrastability.load(REPO)["scopes"]["platform"]["variables"]}
        self.assertEqual((v["ui_findings"]["min"], v["ui_findings"]["max"]), (0, 0))
        self.assertEqual((v["happy_paths"]["min"], v["happy_paths"]["max"]), (1.0, 1.0))
        self.assertTrue({"uiux.findings", "uiux.happy_paths"} <= set(ultrastability.readings_keys()))


class Funnels(unittest.TestCase):
    def test_completion_is_ordered_within_a_day(self):
        rows = [hit("a", "/for/founders", NOW - 100), hit("a", "/product", NOW - 90), hit("a", "/start", NOW - 80),
                hit("b", "/for/founders", NOW - 100), hit("b", "/product", NOW - 90),
                hit("c", "/for/founders", NOW - 100), hit("c", "/start", NOW - 90),            # skipped a step: the order is the path
                hit("d", "/product", NOW - 100), hit("d", "/for/founders", NOW - 90)]            # wrong order
        f = U.funnel(rows, "/for/founders", ["/product", "/start"], NOW, 7)
        self.assertEqual(f["reached"], [4, 2, 1])
        self.assertEqual(f["completion"], 0.25)

    def test_bots_and_old_rows_do_not_count_and_visitor_days_do_not_join(self):
        rows = [{**hit("a", "/for/founders", NOW - 10), "bot": 1}, hit("z", "/for/founders", NOW - 9 * D), hit("y", "/for/founders", NOW - D), hit("y", "/start", NOW - 3 * D)]
        f = U.funnel(rows, "/for/founders", ["/start"], NOW, 7)
        self.assertEqual(f["entries"], 1)
        self.assertEqual(f["completion"], 0.0)

    def test_drop_needs_a_baseline_and_a_sample(self):
        p = U.load(REPO)["paths"]
        hist = [{"day": f"d{i}", "entries": 80, "completion": 0.30} for i in range(5)]
        self.assertEqual(U.judge_drop(hist, {"entries": 90, "completion": 0.10}, p)["median"], 0.30)
        self.assertIsNone(U.judge_drop(hist, {"entries": 90, "completion": 0.25}, p), "a small dip is noise")
        self.assertIsNone(U.judge_drop(hist, {"entries": 5, "completion": 0.0}, p), "too few entries to mean it")
        self.assertIsNone(U.judge_drop(hist[:2], {"entries": 90, "completion": 0.0}, p), "no baseline yet")


def arm_rows(exp, n_a, c_a, n_b, c_b, bounce_b=0):
    rows = []
    for arm, n, c, bnc in (("control", n_a, c_a, 0), ("start-mine", n_b, c_b, bounce_b)):
        for i in range(n):
            vid = f"{arm}-{i}"
            rows += [hit(vid, "/", NOW - 500, f"exp:{exp['id']}:{arm}"), hit(vid, "/", NOW - 500)]
            if i < c:
                rows.append(hit(vid, "/setup", NOW - 400))
            elif i >= n - bnc:
                pass
            else:
                rows.append(hit(vid, "/proof", NOW - 400))
    return rows


class Experiments(unittest.TestCase):
    def setUp(self):
        self.d = Path(scratch())
        for f in ("doctrine/uiux.json", "doctrine/design-experiments.json", "doctrine/ultrastability.json", "doctrine/design.json"):
            (self.d / f).parent.mkdir(exist_ok=True)
            shutil.copy(REPO / f, self.d / f)
        (self.d / "site").mkdir()
        self.exp = next(e for e in json.loads((REPO / "doctrine/design-experiments.json").read_text())["experiments"] if e["id"] == "UX-001-home-setup-label")

    def test_the_declared_experiment_is_valid_and_served(self):
        self.assertEqual(design.experiments_check(REPO), [])
        s = U.served(REPO)
        self.assertEqual([r["id"] for r in s["running"]], ["UX-001-home-setup-label"])
        self.assertEqual(s["running"][0]["arms"][1]["overrides"], {"primary_label": "Start my own system"})

    def test_tally_counts_exposure_conversion_and_bounce(self):
        t = U.tally(arm_rows(self.exp, 10, 2, 10, 5, bounce_b=3), self.exp)
        self.assertEqual((t["control"]["n"], t["control"]["conv"]), (10, 2))
        self.assertEqual((t["start-mine"]["n"], t["start-mine"]["conv"], t["start-mine"]["bounce"]), (10, 5, 3))

    def test_no_peeking_before_the_planned_sample(self):
        r = U.settle_experiments(self.d, arm_rows(self.exp, 50, 5, 50, 30), NOW, apply=True)
        self.assertEqual(r[0]["verdict"], "continue")
        self.assertEqual(json.loads((self.d / "doctrine/design-experiments.json").read_text())["experiments"][-1]["status"], "running")

    def test_a_winner_is_promoted_into_the_served_default(self):
        r = U.settle_experiments(self.d, arm_rows(self.exp, 400, 20, 400, 60), NOW, apply=True)
        self.assertEqual(r[0]["verdict"], "kept")
        self.assertEqual(json.loads((self.d / "doctrine/uiux.json").read_text())["experiments"]["defaults"]["home.setup_label"], {"primary_label": "Start my own system"})
        self.assertEqual(U.served(self.d)["running"], [], "a decided experiment is no longer served as a test")
        self.assertIn("Start my own system", (self.d / "site/uiux-data.js").read_text())
        self.assertEqual(json.loads((self.d / "doctrine/design-experiments.json").read_text())["experiments"][-1]["status"], "kept")

    def test_a_guard_breach_keeps_the_control(self):
        r = U.settle_experiments(self.d, arm_rows(self.exp, 400, 20, 400, 60, bounce_b=200), NOW, apply=True)
        self.assertEqual(r[0]["verdict"], "replaced")
        self.assertEqual(json.loads((self.d / "doctrine/uiux.json").read_text())["experiments"]["defaults"], {})

    def test_no_effect_is_recorded_not_promoted(self):
        r = U.settle_experiments(self.d, arm_rows(self.exp, 400, 40, 400, 41), NOW, apply=True)
        self.assertEqual(r[0]["verdict"], "no-effect")


class Loop(unittest.TestCase):
    def setUp(self):
        self.d = Path(scratch())
        for f in ("doctrine/uiux.json", "doctrine/design-experiments.json", "doctrine/ultrastability.json", "doctrine/design.json", "doctrine/stakeholders.json"):
            (self.d / f).parent.mkdir(exist_ok=True)
            shutil.copy(REPO / f, self.d / f)
        (self.d / "docs/issues").mkdir(parents=True)
        (self.d / "site").mkdir()
        self.at = datetime.fromtimestamp(NOW - 3600, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    def report(self, findings, paths=None):
        return {"at": self.at, "mode": "offline", "pages": 22, "findings": findings, "paths": paths or [{"id": "audience-founders", "ok": True}]}

    def test_findings_become_one_item_per_rule_with_a_probe_and_no_duplicates(self):
        f = [{"kind": "a11y", "path": p, "viewport": "phone/light", "rule": "label", "detail": "#x"} for p in ("/setup", "/start")] + [{"kind": "boundary", "path": "/faq", "viewport": "phone", "rule": "backend-detail", "detail": '"D1" is visible'}]
        r = U.tick(self.d, True, now=NOW, rows=[], report=self.report(f), static=False)
        self.assertEqual(sorted(r["filed"]), ["Q-UIUX-a11y-label", "Q-UIUX-boundary-backend-detail"])
        item = json.loads((self.d / "docs/issues/Q-UIUX-a11y-label.json").read_text())
        self.assertIn("**Done check:** cmd:python3 -m foundation uiux --probe a11y-label", item["body"])
        self.assertIn("/setup (phone/light)", item["body"])
        self.assertIn("agent-ready", item["labels"])
        self.assertEqual(U.tick(self.d, True, now=NOW, rows=[], report=self.report(f), static=False)["filed"], [], "an open item is never refiled")

    def test_status_carries_the_two_essential_variables(self):
        f = [{"kind": "a11y", "path": "/setup", "viewport": "phone/light", "rule": "label", "detail": "x"}, {"kind": "performance", "path": "/", "viewport": "phone", "rule": "dom-nodes", "detail": "x"}]
        paths = [{"id": "a", "ok": True}, {"id": "b", "ok": False}]
        st = U.tick(self.d, True, now=NOW, rows=[], report=self.report(f, paths), static=False)["status"]
        self.assertEqual(st["findings_blocking"], 1, "a warning does not count against the viability variable")
        self.assertEqual(st["happy_path_pass_share"], 0.5)
        self.assertEqual(U.status_reading(self.d, "findings_blocking"), 1)

    def test_a_stale_or_missing_audit_is_unmeasured_never_in_bounds(self):
        st = U.tick(self.d, True, now=NOW, rows=[], report=None, static=False)["status"]
        self.assertIsNone(st["findings_blocking"]); self.assertIsNone(st["happy_path_pass_share"])
        self.assertTrue(any("audit" in u for u in st["unmeasured"]))
        self.assertIsNone(U.status_reading(self.d, "findings_blocking"))
        old = self.report([]); old["at"] = "2026-10-01T00:00:00Z"
        self.assertIsNone(U.tick(self.d, True, now=NOW, rows=[], report=old, static=False)["status"]["findings_blocking"])

    def test_a_fallen_path_is_a_finding_and_an_item(self):
        rows = []
        for day in range(1, 6):          # five earlier days at 50 percent
            for i in range(60):
                t = NOW - day * D - i
                rows += [hit(f"{day}-{i}", "/for/founders", t), hit(f"{day}-{i}", "/product", t + 1), hit(f"{day}-{i}", "/showcase", t + 2)] + ([hit(f"{day}-{i}", "/start", t + 3)] if i < 30 else [])
        for day in range(1, 6):          # persist history the way daily runs do
            U.funnels_run(self.d, U.load(self.d), [r for r in rows if NOW - day * D - 100 <= r["at"] <= NOW - day * D], NOW - day * D, apply=True)
        for i in range(60):              # today nobody completes
            t = NOW - 100 - i
            rows += [hit(f"t-{i}", "/for/founders", t), hit(f"t-{i}", "/product", t + 1)]
        today = [r for r in rows if r["vid"].startswith("t-")]
        r = U.tick(self.d, True, now=NOW, rows=today, report=self.report([]), static=False)
        self.assertEqual(r["status"]["paths"]["audience-founders"]["drop"]["now"], 0.0)
        self.assertIn("Q-UIUX-path-drop-audience-founders", r["filed"])

    def test_unreadable_analytics_is_unmeasured_not_a_crash(self):
        class Broken:
            def visits(self, since):
                raise OSError("network down")
        st = U.tick(self.d, False, now=NOW, source=Broken(), report=self.report([]), static=False)["status"]
        self.assertTrue(any(u.startswith("analytics:") for u in st["unmeasured"]))

    def test_the_probe_passes_when_nothing_is_recorded_for_the_slug(self):
        (self.d / "ops/uiux").mkdir(parents=True)
        (self.d / "ops/uiux/audit.json").write_text(json.dumps(self.report([])))
        self.assertEqual(U.probe("a11y-label", self.d), 0)
        self.assertEqual(U.probe("nonsense", self.d), 2)


if __name__ == "__main__":
    unittest.main()

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""TEMPORAL-1: a real git history and real ledgers drive the real functions: windows, hotspot, neglect, stopped loop, repeated failure, stale entries,
the finding lifecycle, queue items, attention weights and the pathfinder's view of a stopped loop. Nothing is stubbed except the clock."""
import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import temporal as T, pathfinder as P  # noqa: E402
from tests.foundation import _repo  # noqa: E402

NOW = 1_800_000_000.0 + 40 * 86400
D = 86400
CFG = {"history_days": 90, "recent_days": 3, "baseline_days": 14, "min_baseline_days": 5, "spark_days": 28, "publish_areas": 14, "history_rows": 50,
       "hot_ratio": 3.0, "hot_floor_rate": 1.0, "hot_min_recent": 12, "file_churn_min": 8, "max_file_hotspots": 3,
       "decay_ratio": 0.2, "neglect_min_base": 12, "revive_ratio": 0.5, "stop_factor": 4, "stop_min_events": 4, "min_gap_s": 3600, "fail_streak": 3, "fail_min": 3,
       "settle_days": 7, "escalate_runs": 2, "max_items_per_run": 5, "attention_step": 0.25, "attention_min": 0.5, "attention_max": 2.0, "default_advocate": "operations",
       "auto_areas": True, "noise": ["ops/", "docs/issues/"], "tenant": "ultrastable",
       "areas": [{"id": "site", "paths": ["site/"], "advocate": "uiux-manager"}, {"id": "docs", "paths": ["docs/"], "advocate": "project-manager"}, {"id": "core", "paths": ["core/"], "advocate": "operations"}],
       "ledgers": [{"id": "deploys", "file": "ops/deploys.jsonl", "time": "at", "key": ["worker"], "ok_field": "ok", "ok_values": [True], "area": "workflows", "advocate": "infrastructure-manager", "files": ["deploy.mjs"]}],
       "entries": [{"id": "open-items", "glob": "docs/issues/Q-*.json", "open_only": "**Status:** open", "stale_days": 10, "min_count": 2, "batch": 2, "area": "docs", "advocate": "project-manager"}]}


def commit(root, path, days_ago, text="x"):
    f = Path(root) / path
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(f.read_text() + text + "\n" if f.exists() else text + "\n")
    t = int(NOW - days_ago * D)
    env = {**os.environ, "GIT_AUTHOR_DATE": f"{t} +0000", "GIT_COMMITTER_DATE": f"{t} +0000"}
    subprocess.run(["git", "-C", str(root), "add", "-A"], check=True)
    subprocess.run(["git", "-C", str(root), "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", f"c {path} {t}"], check=True, env=env)


def ledger(root, name, rows):
    p = Path(root) / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("".join(json.dumps(r) + "\n" for r in rows))


def iso(days_ago):
    import datetime as dt
    return dt.datetime.fromtimestamp(NOW - days_ago * D, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class World(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        r = cls.root = Path(cls.tmp.name)
        subprocess.run(["git", "init", "-q", str(r)], check=True)
        for d in range(30, 3, -1):                      # steady for four weeks: 2 site, 2 docs commits a day
            for k in range(2):
                commit(r, f"site/p{k}.txt", d); commit(r, f"docs/n{k}.txt", d)
        for d in range(20, 3, -1):                      # core: steady one a day
            commit(r, "core/a.txt", d)
        for _ in range(40):                             # site: a burst in the last three days, and one file edited again and again
            commit(r, "site/hot.txt", 1)
        for d in (1,):                                  # docs: almost nothing in the last days (decay), core: nothing (untouched)
            commit(r, "docs/n0.txt", d)
        ledger(r, "ops/deploys.jsonl", [{"at": iso(d + 0.5), "worker": "tick", "ok": True} for d in range(20, 8, -1)]                         # stopped: nothing for 8 days
               + [{"at": iso(d), "worker": "site", "ok": d > 2} for d in range(10, 0, -1)] + [{"at": iso(0.5), "worker": "site", "ok": False}])  # repeated failure
        for i in range(3):
            (r / "docs/issues").mkdir(parents=True, exist_ok=True)
        for i in range(4):
            commit(r, f"docs/issues/Q-OLD-{i}.json", 25, json.dumps({"id": f"Q-OLD-{i}", "body": "**Status:** open"}))
        cls.found, cls.summary = T.diagnose(r, CFG, NOW)
        cls.by = {(f["kind"], f["subject"]): f for f in cls.found}

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_windows_shrink_to_history(self):
        rec, base, span = T.windows({10: 5, 11: 5, 12: 5}, 13, 3, 14, 11)
        self.assertEqual((rec, base, span), (15, 0, 0))            # a young series has no baseline to be judged against

    def test_hotspot_area_and_file(self):
        self.assertIn(("hotspot", "area:site"), self.by)
        self.assertIn(("hotspot", "file:site/hot.txt"), self.by)
        self.assertEqual(self.by[("hotspot", "area:site")]["advocate"], "uiux-manager")

    def test_neglect_decay_and_untouched(self):
        self.assertIn("decay", self.by[("neglect", "area:docs")]["evidence"])
        self.assertIn("untouched", self.by[("neglect", "area:core")]["evidence"])
        self.assertEqual(self.by[("neglect", "area:core")]["severity"], "act")

    def test_stopped_loop_and_repeated_failure(self):
        s = self.by[("stopped_loop", "ledger:deploys:tick")]
        self.assertEqual(s["files"], ["deploy.mjs"])
        self.assertTrue(s["last_good"])                             # the commit the loop last worked at, where a regression diff starts
        self.assertIn(("repeated_failure", "ledger:deploys:site"), self.by)

    def test_stale_entries(self):
        self.assertIn("4 of 4 open-items untouched", self.by[("stale_entry", "entries:open-items")]["evidence"])

    def test_quiet_series_files_nothing(self):
        quiet = {**CFG, "areas": [], "ledgers": [], "entries": []}
        r = _repo.scratch()
        subprocess.run(["git", "init", "-q", str(r)], check=True)
        for d in range(30, 1, -1):
            commit(r, "a/x.txt", d)
        self.assertEqual(T.diagnose(r, quiet, NOW)[0], [])

    def test_lifecycle_items_and_settling(self):
        st = T.advance({"findings": {}, "settled": []}, self.found, NOW)
        self.assertTrue(all(s["status"] == "open" and s["runs"] == 1 for s in st["findings"].values()))
        out = _repo.scratch()
        (out / "docs/issues").mkdir(parents=True)
        filed = T.file_items(out, CFG, st, NOW)
        self.assertEqual(len(filed), 5)                             # act findings first, capped
        self.assertTrue(all((out / "docs/issues" / f"{i}.json").exists() for i in filed))
        item = json.loads((out / "docs/issues" / f"{filed[0]}.json").read_text())
        self.assertIn("cmd:python3 -m foundation temporal --settled", item["body"])
        self.assertIn("Prediction:", item["body"])
        st2 = T.advance(st, self.found, NOW + D)                    # seen again: a run is counted, not a duplicate
        self.assertEqual({s["runs"] for s in st2["findings"].values()}, {2})
        st3 = T.advance(st2, [], NOW + 2 * D)                       # gone: settled with a record, never dropped
        self.assertTrue(all(s["status"] == "settled" for s in st3["findings"].values()))
        self.assertEqual(len(st3["settled"]), len(self.found))

    def test_attention_by_advocate(self):
        w = T.attention(self.summary, self.found, CFG)
        self.assertGreater(w["project-manager"], 1.0)               # docs decayed: its advocate's items rise
        self.assertLess(w["uiux-manager"], 1.0)                      # site is hot: its advocate's items fall

    def test_pathfinder_sees_a_stopped_loop(self):
        r = self.root
        st = T.advance({"findings": {}, "settled": []}, self.found, NOW)
        (r / "ops/temporal").mkdir(parents=True, exist_ok=True)
        (r / "ops/temporal/findings.json").write_text(json.dumps(st))
        (r / "doctrine").mkdir(exist_ok=True)
        base = json.loads((Path(__file__).resolve().parents[2] / "doctrine/pathfinder.json").read_text())
        (r / "doctrine/pathfinder.json").write_text(json.dumps(base))
        (r / "foundation/data").mkdir(parents=True, exist_ok=True)
        (r / "foundation/data/credential-routes.json").write_text(json.dumps({"credentials": {}}))
        ints = {i["id"]: i for i in P._cfg(r)["integrations"]}
        self.assertEqual(ints["ledger:deploys:tick"]["probe"], "temporal:" + self.by[("stopped_loop", "ledger:deploys:tick")]["id"])
        self.assertEqual(ints["ledger:deploys:tick"]["files"], ["deploy.mjs"])


class Repo(unittest.TestCase):
    def test_check_and_real_history(self):
        self.assertEqual(T.check(), [])
        found, summary = T.diagnose(T.REPO, T.load(), __import__("time").time())
        self.assertTrue(summary["areas"])                           # this repository has a history to read

    def test_failure_mode_has_its_detector(self):
        det = json.loads((T.REPO / "doctrine/detectors.json").read_text())["detectors"]
        self.assertTrue(any(d["id"] == "temporal-drift" and d["failure_mode"] == "fm-temporal-drift" for d in det))


if __name__ == "__main__":
    unittest.main()


class GeneratedOutputs(unittest.TestCase):
    def test_generator_outputs_are_read_from_the_generators_own_list(self):
        r = _repo.scratch()
        (r / "scripts").mkdir()
        (r / "scripts/regen_generated.py").write_text('OUTPUTS = ["site/x-data.js", "README.md"]\n')
        self.assertEqual(T.generated_outputs(r), ("site/x-data.js", "README.md"))
        self.assertEqual(T.generated_outputs(_repo.scratch()), ())  # a tenant with no generators contributes nothing

    def test_the_real_list_covers_the_files_that_were_flagged(self):
        out = T.generated_outputs(Path(__file__).resolve().parents[2])
        for f in ("site/decisions-data.js", "README.md", "doctrine/decision-ledger.json"):
            self.assertIn(f, out)

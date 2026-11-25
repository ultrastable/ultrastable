# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import json, subprocess, unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile, shutil
from foundation import improve

REPO = Path(__file__).resolve().parents[2]


def sandbox():
    d = Path(tempfile.mkdtemp())
    (d / "doctrine").mkdir(); (d / "docs/issues").mkdir(parents=True); (d / "ops/reach").mkdir(parents=True)
    shutil.copy(REPO / improve.CFG, d / improve.CFG)
    subprocess.run(["git", "init", "-q", "-b", "main", str(d)], check=True)
    return d


class Improve(unittest.TestCase):
    def test_config(self):
        self.assertEqual(improve.check(REPO), [])

    def test_always_has_work_with_no_signals(self):
        d = sandbox()
        p = improve.plan(d)
        self.assertGreaterEqual(len(p["filed"]), improve.load(d)["min_items_per_cycle"])
        self.assertTrue(any(i.startswith("Q-IMPROVE-SIGNAL-") for i in p["filed"]), "missing signals are defects, not a quiet week")
        self.assertTrue(any(i.startswith("Q-IMPROVE-STALL-") for i in p["filed"]), "no merges stalls every tier")
        self.assertTrue(any("plus" in it["labels"] for it in p["items"]), "the plus budget is spent every pass")
        for it in p["items"]:
            self.assertIn("**Prediction:**", it["body"]); self.assertIn("**Owner:**", it["body"])

    def test_frontend_and_backend_lanes_every_pass(self):
        d = sandbox(); items = improve.plan(d)["items"]
        kinds = {l for it in items for l in it["labels"]}
        self.assertIn("frontend", kinds); self.assertIn("backend", kinds)
        fe = next(it for it in items if "frontend" in it["labels"])
        for gate in ("uiux", "Core Web Vitals", "human-voice"):
            self.assertIn(gate, fe["body"])
        self.assertIn("role:uiux-manager", fe["labels"])

    def test_lower_is_better_settles(self):
        d = sandbox(); now = datetime.now(timezone.utc)
        (d / "ops/uiux").mkdir(parents=True); (d / "ops/uiux/status.json").write_text(json.dumps({"findings_total": 3}))
        (d / "ops/improve").mkdir()
        old = (now - timedelta(days=8)).isoformat()
        (d / improve.LEDGER).write_text(json.dumps({"at": old, "event": "filed", "id": "Q-IMPROVE-fe", "metric": "uiux:findings_total", "baseline": 5, "better": "down"}) + "\n")
        (d / "docs/issues/Q-IMPROVE-fe.json").write_text(json.dumps({"id": "Q-IMPROVE-fe", "body": "**Status:** closed"}))
        self.assertEqual(improve.plan(d, now)["settle"][0]["verdict"], "kept")

    def test_seed_carries_the_engine(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("s", REPO / "seed/scripts/improve.py"); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
        self.assertEqual(m.check(REPO / "seed"), [])

    def test_defects_bypass_the_cap(self):
        d = sandbox(); cfg = improve.load(d)
        for i in range(cfg["max_open_from_loop"]):
            (d / f"docs/issues/Q-IMPROVE-x{i}.json").write_text(json.dumps({"id": f"Q-IMPROVE-x{i}", "body": "**Status:** open"}))
        filed = improve.plan(d)["filed"]
        self.assertTrue(any(i.startswith("Q-IMPROVE-SIGNAL-") for i in filed))
        self.assertFalse(any(i.startswith("Q-IMPROVE-fe-") for i in filed))

    def test_idempotent(self):
        d = sandbox(); p = improve.plan(d); improve.apply(d, p)
        self.assertTrue(set(p["filed"]).isdisjoint(improve.plan(d)["filed"]))

    def test_settle_keeps_or_replaces(self):
        d = sandbox(); now = datetime.now(timezone.utc)
        (d / "ops/reach/metrics.jsonl").write_text(json.dumps({"at": now.isoformat(), "external_referrals_7d": 50}) + "\n")
        old = (now - timedelta(days=8)).isoformat()
        (d / "ops/improve").mkdir()
        (d / improve.LEDGER).write_text("".join(json.dumps({"at": old, "event": "filed", "id": i, "metric": "external_referrals_7d", "baseline": b}) + "\n" for i, b in (("Q-IMPROVE-a", 10), ("Q-IMPROVE-b", 90))))
        for i in ("Q-IMPROVE-a", "Q-IMPROVE-b"):
            (d / f"docs/issues/{i}.json").write_text(json.dumps({"id": i, "body": "**Status:** closed"}))
        v = {s["id"]: s["verdict"] for s in improve.plan(d, now)["settle"]}
        self.assertEqual(v, {"Q-IMPROVE-a": "kept", "Q-IMPROVE-b": "replace"})


if __name__ == "__main__":
    unittest.main()

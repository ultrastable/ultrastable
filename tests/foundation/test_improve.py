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

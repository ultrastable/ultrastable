"""SCOUT-1: the research loop baselines, diffs, files findings, and refuses adoption without code."""
import datetime as dt, json, shutil, unittest
from pathlib import Path
from foundation import scout, queue
import sys as _sys; _sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import scratch  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
T0 = dt.datetime(2026, 11, 12, tzinfo=dt.timezone.utc)


def _copy():
    t = Path(scratch())
    for rel in ("doctrine", "docs/issues"):
        shutil.copytree(REPO / rel, t / rel, ignore=shutil.ignore_patterns("__pycache__"))
    (t / "doctrine/scout-state.json").unlink(missing_ok=True)
    return t


PAGE1 = "<p>Agents can run on a schedule in the cloud today.</p><p>Pricing information is available on the plans page.</p>"
PAGE2 = PAGE1 + "<p>New: agents now trigger from a webhook with an authenticated API call.</p>"


class Scout(unittest.TestCase):
    def test_repo_is_clean(self):
        self.assertEqual(scout.check(REPO), [])

    def test_baseline_then_finding_then_item_then_disposition(self):
        t = _copy()
        r = scout.run(t, http=lambda u: (200, PAGE1), now=T0, apply=True)
        self.assertEqual(r["findings"], []); self.assertTrue(r["baseline"])
        r = scout.run(t, http=lambda u: (200, PAGE2), now=T0 + dt.timedelta(days=40), apply=True)
        self.assertTrue(r["findings"]); fid = r["findings"][0]
        self.assertIn("Q-SCOUT-" + fid, {i["id"] for i in queue.items(t)})
        self.assertEqual(scout.check(t), [])
        self.assertIn("adoption without code", scout.disposition(t, fid, "adopt", "good", "no-such-gap"))
        self.assertEqual(scout.disposition(t, fid, "reject", "out of lane"), "")
        self.assertEqual(scout.load_state(t)["findings"][fid]["disposition"]["how"], "reject")

    def test_fetch_failure_is_counted_and_files_after_three(self):
        t = _copy()
        for i in range(3):
            r = scout.run(t, http=lambda u: (503, ""), now=T0 + dt.timedelta(days=40 * i), apply=True)
        self.assertTrue(r["failed"])
        self.assertTrue(any(i["id"].startswith("Q-SCOUT-FETCH-") for i in queue.items(t)))

    def test_not_due_sources_are_skipped(self):
        t = _copy(); scout.run(t, http=lambda u: (200, PAGE1), now=T0, apply=True)
        r = scout.run(t, http=lambda u: (200, PAGE2), now=T0 + dt.timedelta(days=1), apply=True)
        self.assertEqual(r["read"], [])


if __name__ == "__main__":
    unittest.main()

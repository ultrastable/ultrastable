"""THROUGHPUT-1: lifecycle events per item, net inflow per family, a growing family with no doer becomes one build-the-doer item."""
import json, shutil, subprocess, sys, unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import throughput as T  # noqa: E402
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import scratch  # noqa: E402

T0 = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)


def item(d, iid, status="open"):
    body = f"**Owner:** operations\n**Trigger:** t\n**Done check:** file:x\n**Status:** {status}\n" + ("\n**Evidence:** e\n" if status != "open" else "")
    (d / "docs/issues" / f"{iid}.json").write_text(json.dumps({"id": iid, "title": iid, "body": body, "labels": []}))


def repo():
    d = scratch()
    (d / "docs/issues").mkdir(parents=True); (d / "doctrine").mkdir()
    shutil.copy(ROOT / "doctrine/qnfo-port.json", d / "doctrine/qnfo-port.json")
    return d


class Throughput(unittest.TestCase):
    def test_family(self):
        self.assertEqual([T.family(i) for i in ("Q-CRIT-IGNITION", "OL-20261112-3", "OL-ROLE-data-analyst", "Q-10", "OL-PR-297", "Q-GAP-x", "AUDIT")],
                         ["Q-CRIT", "OL", "OL-ROLE", "Q", "OL-PR", "Q-GAP", "AUDIT"])

    def test_first_seen_is_baseline_then_events_count(self):
        d = repo(); item(d, "Q-ZED-1"); item(d, "Q-ZED-2")
        r = T.tick(d, apply=True, now=T0, takeable=[])
        self.assertEqual(r["net_inflow_total"], 0, "items the ledger first sees without history are the baseline, not inflow")
        item(d, "Q-ZED-3"); item(d, "Q-ZED-4")
        r = T.tick(d, apply=True, now=T0 + timedelta(hours=1), takeable=[])
        z = next(f for f in r["families"] if f["family"] == "Q-ZED")
        self.assertEqual((z["opened"], z["closed"], z["open"], z["net_inflow"], z["doer"]), (2, 0, 4, 2, None))
        self.assertEqual(r["without_doer"], ["Q-ZED"])
        self.assertEqual(r["filed"], ["Q-DOER-Q-ZED"])
        b = json.loads((d / "docs/issues/Q-DOER-Q-ZED.json").read_text())["body"]
        self.assertIn("Done check:** cmd:python3 -m foundation throughput --doer Q-ZED", b)
        r = T.tick(d, apply=True, now=T0 + timedelta(hours=2), takeable=[])
        self.assertEqual(r["filed"], [], "one doer item per family, never duplicated")

    def test_executor_reach_or_a_close_is_a_doer(self):
        d = repo(); item(d, "Q-OLD-1"); T.tick(d, apply=True, now=T0, takeable=["Q-OLD-1"])  # the ledger starts with history
        item(d, "Q-ZED-1"); item(d, "Q-YAK-1"); item(d, "Q-YAK-2")
        r = T.tick(d, apply=True, now=T0 + timedelta(hours=1), takeable=["Q-ZED-1"])
        self.assertEqual(r["without_doer"], ["Q-YAK"])
        item(d, "Q-YAK-1", status="closed")
        r = T.tick(d, apply=True, now=T0 + timedelta(hours=2), takeable=["Q-ZED-1"])
        self.assertEqual(r["without_doer"], [], "something closed a Q-YAK item in the window")

    def test_reopen_and_silent_drop(self):
        d = repo(); item(d, "Q-ZED-1"); item(d, "Q-ZED-2", status="closed")
        T.tick(d, apply=True, now=T0, takeable=[])
        item(d, "Q-ZED-2"); (d / "docs/issues/Q-ZED-1.json").unlink()
        r = T.tick(d, apply=True, now=T0 + timedelta(hours=1), takeable=[])
        rows = [json.loads(l) for l in (d / T.LEDGER).read_text().splitlines()]
        self.assertEqual(sorted(x["event"] for x in rows if x["at"] > "2026-11-14T12:00:00Z"), ["deleted", "reopened"])
        self.assertEqual(r["silent_drops"], 1, "an item that vanished while open is a silent drop")

    def test_git_seed_measures_from_history(self):
        d = repo()
        g = lambda *a: subprocess.run(["git", "-C", str(d), *a], check=True, capture_output=True)
        g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t")
        item(d, "Q-ZED-1"); g("add", "."); g("commit", "-qm", "a")
        item(d, "Q-ZED-1", status="closed"); item(d, "Q-ZED-2"); g("add", "."); g("commit", "-qm", "b")
        r = T.tick(d, apply=True, takeable=[])
        z = next(f for f in r["families"] if f["family"] == "Q-ZED")
        self.assertEqual((z["opened"], z["closed"]), (2, 1))


if __name__ == "__main__":
    unittest.main()

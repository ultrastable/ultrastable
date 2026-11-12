"""SESSION-CLOSE-1 / STRANGE-LOOP-1: zombies are found, each gets a disposition, and the loop tunes itself with a graded prediction."""
import json, shutil, sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import sessions  # noqa: E402

H = 3600
POL = {"idle_ttl_hours": 4, "ttl_floor_hours": 1, "backlog_owner": "operations"}


def item(name, age_h, ahead=1, pr=None, checks="unknown", now=1_000_000):
    return {"name": name, "last_activity": now - age_h * H, "sha": "a" * 40, "ahead": ahead, "pr": pr, "draft": True, "checks": checks}


class Classify(unittest.TestCase):
    def test_every_session_is_live_or_has_a_disposition(self):
        now = 1_000_000
        r = sessions.classify([item("agent/a", 1), item("agent/b", 9, ahead=0), item("agent/c", 9, pr=5, checks="pass"), item("agent/d", 9)], now, POL)
        self.assertEqual(r["live"], ["agent/a"])
        self.assertEqual({z["name"]: z["action"] for z in r["zombies"]}, {"agent/b": "close-superseded", "agent/c": "lane-merge", "agent/d": "backlog"})
        self.assertEqual(r["entered"], len(r["live"]) + len(r["zombies"]), "accounting invariant: nothing silently dropped")

    def test_backlog_item_has_owner_trigger_and_probe(self):
        z = {**item("agent/d", 9), "age_hours": 9.0}
        b = sessions.backlog_item(z, POL)
        for need in ("**Owner:** operations", "**Trigger:**", "Closing probe"):
            self.assertIn(need, b["body"])


class Meta(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        (self.tmp / "doctrine").mkdir(); (self.tmp / "ops").mkdir()
        sessions._write_policy(self.tmp, dict(POL, idle_ttl_hours=4))

    def scan(self, z):
        with (self.tmp / sessions.LEDGER).open("a") as f:
            f.write(json.dumps({"at": 1, "entered": z, "live": 0, "zombies": z, "dispositions": [], "invariant": True}) + "\n")

    def test_persistent_zombies_tighten_ttl_with_a_prediction_then_grade_it(self):
        self.scan(2); self.scan(1)
        m = sessions.meta(self.tmp)
        self.assertEqual(m["change"]["to"], 2.0)
        self.assertIn("zombies == 0", m["change"]["prediction"])
        self.scan(0)
        m = sessions.meta(self.tmp)
        self.assertEqual(m["graded"]["grade"], "kept"); self.assertEqual(m["ttl_hours"], 2.0)

    def test_failed_prediction_reverts_and_the_value_is_never_retried(self):
        self.scan(2); self.scan(1); sessions.meta(self.tmp)
        self.scan(3)
        m = sessions.meta(self.tmp)
        self.assertEqual(m["graded"]["grade"], "reverted"); self.assertEqual(m["ttl_hours"], 4)
        self.scan(1); self.scan(1)
        self.assertIsNone(sessions.meta(self.tmp)["change"], "a reverted value is replaced, not repeated")
        self.assertIn(2.0, sessions.policy(self.tmp)["blocked_values"])

    def test_never_below_floor(self):
        sessions._write_policy(self.tmp, dict(POL, idle_ttl_hours=1))
        self.scan(1); self.scan(1)
        self.assertIsNone(sessions.meta(self.tmp)["change"])


class Registered(unittest.TestCase):
    def test_repo_policy_and_loop_are_valid(self):
        self.assertEqual(sessions.check(ROOT), [])


if __name__ == "__main__":
    unittest.main()

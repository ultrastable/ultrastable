# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import json, unittest
from collections import Counter
from pathlib import Path
from foundation import rootcause
import _repo

ROOT = Path(__file__).resolve().parent.parent.parent


def sandbox(findings=None):
    d = Path(_repo.scratch())
    (d / "doctrine").mkdir()
    pol = json.loads((ROOT / "doctrine/rootcauses.json").read_text())
    for c in pol["classes"]:  # the sandbox has no source tree: guards that exist in the real repository resolve to a file the sandbox does have
        if c["id"] != "estimate-miscalibrated":
            c["guard"] = "file:doctrine/rootcauses.json"
    (d / "doctrine/rootcauses.json").write_text(json.dumps(pol))
    (d / "ops/temporal").mkdir(parents=True)
    (d / "docs/issues").mkdir(parents=True)
    (d / "ops/temporal/findings.json").write_text(json.dumps({"findings": findings or {}}))
    return d


def hot(i, text="README.md: 147 edits in 3 days"):
    return {i: {"id": i, "kind": "hotspot", "subject": "file:README.md", "evidence": text, "status": "open"}}


class RootCause(unittest.TestCase):
    def test_unique_test_basenames(self):  # a duplicate basename made unittest discovery import the wrong file and failed the audit
        names = Counter(p.name for d in ("tests/foundation", "scripts", "tests") for p in (ROOT / d).glob("test_*.py"))
        self.assertEqual([n for n, c in names.items() if c > 1], [])

    def test_registry_is_valid_and_guards_resolve_to_files(self):
        self.assertEqual(rootcause.check(ROOT), [])

    def test_classifies_by_kind_text_and_mode(self):
        cl = rootcause.policy(ROOT)["classes"]
        f = lambda **k: {"source": "x", "key": "k", "kind": "", "mode": "", "text": "", **k}
        self.assertEqual(rootcause.classify(f(kind="hotspot"), cl), "edit-hotspot")
        self.assertEqual(rootcause.classify(f(text="ImportError: 'test_outreach' module incorrectly imported from"), cl), "test-module-collision")
        self.assertEqual(rootcause.classify(f(mode="fm-waiting-on-person"), cl), "waiting-on-person")
        self.assertEqual(rootcause.classify(f(text="nothing known"), cl), "unclassified")

    def test_one_day_watches_two_days_escalate_and_quiet_closes(self):
        d = sandbox(hot("a"))
        r = rootcause.run(d, now="2026-11-21T10:00:00Z")
        self.assertEqual(r["state"]["edit-hotspot"]["status"], "watching")
        self.assertFalse((d / "docs/issues/Q-ROOT-edit-hotspot.json").exists())
        r = rootcause.run(d, now="2026-11-22T10:00:00Z")
        self.assertEqual(r["state"]["edit-hotspot"]["status"], "escalated")
        item = json.loads((d / "docs/issues/Q-ROOT-edit-hotspot.json").read_text())
        self.assertIn("**Status:** open", item["body"])
        self.assertIn("rootcause --probe edit-hotspot", item["body"])
        self.assertEqual(rootcause.run(d, now="2026-11-22T11:00:00Z")["actions"], [])  # idempotent: no rewrite, no duplicate row
        self.assertEqual(len((d / rootcause.OCC).read_text().splitlines()), 2)
        (d / "ops/temporal/findings.json").write_text(json.dumps({"findings": {}}))  # fixed at the root: the finding stops
        self.assertFalse(rootcause.probe("edit-hotspot", d, now="2026-11-23T10:00:00Z")[0])  # one quiet day is not enough
        self.assertTrue(rootcause.probe("edit-hotspot", d, now="2026-11-25T10:00:00Z")[0])
        r = rootcause.run(d, now="2026-11-25T10:00:00Z")
        self.assertIn("edit-hotspot: closed with evidence", r["actions"])
        self.assertIn("**Status:** closed", (d / "docs/issues/Q-ROOT-edit-hotspot.json").read_text())

    def test_missing_guard_asks_to_build_it_and_unclassified_is_a_finding(self):
        d = sandbox()
        rootcause.record("estimate-miscalibrated", "Brier worse than a coin", "2026-11-20", d)
        rootcause.record("estimate-miscalibrated", "Brier still worse than a coin", "2026-11-21", d)
        r = rootcause.run(d, now="2026-11-21T10:00:00Z")
        self.assertEqual(r["state"]["estimate-miscalibrated"]["mode"], "build-guard")  # the guard file is absent in the sandbox
        d2 = sandbox(hot("z", "something unheard of"))
        d2f = json.loads((d2 / "ops/temporal/findings.json").read_text())
        d2f["findings"]["z"]["kind"] = "weird"
        (d2 / "ops/temporal/findings.json").write_text(json.dumps(d2f))
        r = rootcause.run(d2, now="2026-11-21T10:00:00Z")
        self.assertEqual(r["state"]["unclassified"]["mode"], "classify")


class Persistence(unittest.TestCase):
    def fake(self, store):
        def api(method, path, body=None, raw=False):
            if method == "PUT":
                store["b"] = body
                return b""
            if "b" not in store:
                raise OSError("GET x: HTTP 404")
            return store["b"]
        return api

    def test_recurrence_survives_a_fresh_checkout_through_the_store(self):
        store = {}
        a = sandbox()
        rootcause.record("edit-hotspot", "README hot", "2026-11-21", a)
        rootcause.run(a, now="2026-11-21T10:00:00Z")
        self.assertEqual(rootcause.push(a, api=self.fake(store), env={}), "stored and read back")
        b = sandbox()  # next day's run starts from a clean checkout
        rootcause.record("edit-hotspot", "README hot again", "2026-11-22", b)
        self.assertIn("pulled 1", rootcause.sync(b, api=self.fake(store), env={}))
        r = rootcause.run(b, now="2026-11-22T10:00:00Z")
        self.assertEqual(r["state"]["edit-hotspot"]["status"], "escalated")

    def test_unreachable_store_is_reported_not_fatal(self):
        def boom(*a, **k):
            raise OSError("HTTP 500")
        self.assertIn("unreachable", rootcause.sync(sandbox(), api=boom, env={}))


class Calibration(unittest.TestCase):
    def test_worse_than_a_coin_is_pulled_toward_the_hit_rate(self):
        from foundation import decisions
        bad = [{"predicted": 1.0, "hit": i % 4 == 0} for i in range(12)]  # confident, right a quarter of the time
        self.assertGreater(decisions.brier(bad), decisions.COIN_BRIER)
        self.assertLess(decisions.recalibrate(1.0, bad), 0.6)
        good = [{"predicted": 1.0, "hit": True}] * 12
        self.assertEqual(decisions.recalibrate(1.0, good), 1.0)
        self.assertEqual(decisions.recalibrate(1.0, bad[:3]), 1.0)  # too few settled outcomes to judge


if __name__ == "__main__":
    unittest.main()

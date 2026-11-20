# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""TENANT-CONTROLS-1 and PR-OUTCOME-1: a status is the result of its probes, the hosted tier cannot open early, and a pull request outcome is never guessed."""
import json
import shutil
import unittest

from _repo import ROOT, scratch
from foundation import executor, tenantcontrols as T


def repo():
    d = scratch()
    for f in (T.DEFS, T.PILOT, "doctrine/open-loops.json"):
        (d / f).parent.mkdir(parents=True, exist_ok=True); shutil.copy(ROOT / f, d / f)
    defs = {"controls": [{"id": "a", "obligation": "first", "owner": "operations", "probes": ["file:a.txt"]},
                         {"id": "b", "obligation": "second", "owner": "operations", "probes": ["file:b.txt", "file:a.txt"], "needs": "b.txt"},
                         {"id": "c", "obligation": "third", "owner": "product-manager", "probes": ["file:c.txt"], "gate": "mtc-processor-terms"}]}
    (d / T.DEFS).write_text(json.dumps(defs)); (d / "a.txt").write_text("x"); (d / "docs/issues").mkdir(parents=True)
    return d


class TenantControls(unittest.TestCase):
    def test_repository_record_is_current_and_tier_is_closed(self):
        self.assertEqual(T.check(ROOT), [])
        rec = json.loads((ROOT / T.RECORD).read_text())
        self.assertEqual(rec["hosted_tier"], "closed" if rec["unproven"] else "ready to offer")

    def test_status_follows_probes_and_unproven_work_is_filed(self):
        d = repo(); r = T.write(d)
        self.assertEqual({c["id"]: c["status"] for c in r["controls"]}, {"a": "proven", "b": "unproven", "c": "unproven"})
        self.assertEqual(r["filed"], ["Q-MTC-b"], "a gated control must not become work for a model")
        self.assertIn("**Done check:** file:b.txt", json.loads((d / "docs/issues/Q-MTC-b.json").read_text())["body"])
        self.assertEqual(T.check(d), [])
        (d / "b.txt").write_text("x")
        self.assertTrue(any("stale" in b for b in T.check(d)))
        (d / "c.txt").write_text("x"); self.assertEqual(T.write(d)["hosted_tier"], "ready to offer")

    def test_hosted_option_cannot_be_offered_while_unproven(self):
        d = repo(); T.write(d)
        pm = json.loads((d / T.PILOT).read_text())
        next(o for o in pm["options"] if o["id"] == "hosted")["status"] = "offered"
        (d / T.PILOT).write_text(json.dumps(pm))
        self.assertTrue(any("hosted option is offered" in b for b in T.check(d)))

    def test_unproven_gate_must_be_recorded(self):
        d = repo(); T.write(d)
        ol = json.loads((d / "doctrine/open-loops.json").read_text()); ol["gates"] = [g for g in ol["gates"] if g["id"] != "mtc-processor-terms"]
        (d / "doctrine/open-loops.json").write_text(json.dumps(ol))
        self.assertTrue(any("gate mtc-processor-terms" in b for b in T.check(d)))


class PrOutcome(unittest.TestCase):
    def test_outcomes_are_recorded_once_and_never_guessed(self):
        d = scratch(); (d / "ops").mkdir()
        rows = [{"at": f"2026-11-19T0{i}:00:00Z", "issue": f"Q-{i}", "result": "pr-opened", "pr": f"https://example.invalid/pull/{i}"} for i in range(1, 5)]
        (d / "ops/executor-log.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
        states = {"1": {"state": "MERGED", "mergedAt": "2026-11-19T05:00:00Z", "mergeCommit": {"oid": "abc"}}, "2": {"state": "CLOSED"}, "3": {"state": "OPEN"}, "4": None}
        st = lambda url, root: states[url[-1]]
        r = executor.fold_outcomes(d, apply=True, pr_state=st)
        self.assertEqual((len(r["merged"]), len(r["closed"]), len(r["open"]), len(r["unreadable"])), (1, 1, 1, 1))
        got = [json.loads(l) for l in (d / "ops/executor-log.jsonl").read_text().splitlines()][4:]
        self.assertEqual([(g["result"], g["issue"]) for g in got], [("pr-merged", "Q-1"), ("pr-closed", "Q-2")])
        self.assertEqual(got[0]["merge_commit"], "abc")
        again = executor.fold_outcomes(d, apply=True, pr_state=st)
        self.assertEqual((again["merged"], again["closed"]), ([], []), "an outcome was recorded twice")
        states["3"] = {"state": "MERGED", "mergedAt": "2026-11-20T05:00:00Z"}
        self.assertEqual(len(executor.fold_outcomes(d, apply=True, pr_state=st)["merged"]), 1)

    def test_dry_run_writes_nothing(self):
        d = scratch(); (d / "ops").mkdir()
        (d / "ops/executor-log.jsonl").write_text(json.dumps({"at": "x", "issue": "Q", "result": "pr-opened", "pr": "u1"}) + "\n")
        before = (d / "ops/executor-log.jsonl").read_text()
        executor.fold_outcomes(d, pr_state=lambda u, r: {"state": "CLOSED"})
        self.assertEqual((d / "ops/executor-log.jsonl").read_text(), before)


if __name__ == "__main__":
    unittest.main()

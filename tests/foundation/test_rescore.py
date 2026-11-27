# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""RESCORE-1: the held-out graders catch a lenient self-score, never count an unreachable model as agreement, and file what they find."""
import datetime as dt
import json
import shutil
import unittest

from _repo import ROOT, scratch
from foundation import decisions as D, rescore as R

T0 = dt.datetime(2026, 11, 18, 12, 0, tzinfo=dt.timezone.utc)
ENV = {"CLOUDFLARE_API_TOKEN": "x", "CLOUDFLARE_ACCOUNT_ID": "x"}  # GitHub Models is retired (ROUTE-RETIRED-1); Workers AI is the reviewer route


def repo(item_status="closed", done_check="file:present.txt"):
    d = scratch()
    for f in ("doctrine/decisions.json", "doctrine/code-agents.json"):
        (d / f).parent.mkdir(parents=True, exist_ok=True); shutil.copy(ROOT / f, d / f)
    (d / "docs/issues").mkdir(parents=True); (d / "ops/decisions").mkdir(parents=True)
    (d / "present.txt").write_text("x")
    (d / "docs/issues/Q-X.json").write_text(json.dumps({"id": "Q-X", "title": "Q-X: t", "body": f"**Owner:** staff\n**Done check:** {done_check}\n**Status:** {item_status}\n**Evidence:** e\n"}))
    row = D.record(d, "work-queue-priority", "Q-X", "Q-X", 1.0, "test", now=T0)
    return d, row


def settle(d, row, hit=True):
    D._append(d / "ops/decisions/outcomes.jsonl", {"id": row["id"], "point": row["point"], "at": "2026-11-19T12:00:00Z", "measured": 1.0 if hit else 0.0, "hit": hit, "predicted": 1.0, "decided_at": row["at"]})


def model(answer):
    return lambda url, headers, body: {"result": {"response": answer}}  # the Workers AI reply shape


def down(url, headers, body):
    raise RuntimeError("non-JSON response")


class Rescore(unittest.TestCase):
    def test_agreement_is_recorded_with_both_graders(self):
        d, row = repo(); settle(d, row)
        r = R.run(d, apply=True, env=ENV, transport=model('{"hit": true, "reason": "closed and probe passes"}'), now=T0)
        self.assertEqual((r["graded"], r["disagree"], r["model_unavailable"]), (1, [], 0))
        got = R.latest(d)[row["id"]]
        self.assertTrue(got["strict_hit"]); self.assertTrue(got["model_hit"]); self.assertTrue(got["agree"])
        self.assertEqual(R.status(d)["agreement"], 1.0)
        self.assertEqual(R.run(d, apply=True, env=ENV, transport=down, now=T0)["graded"], 0, "a graded decision was graded twice")

    def test_strict_rule_catches_a_lenient_self_score(self):
        # the item's record says open, yet the self-score says hit (the scorer counts an opened pull request as a closed item)
        d, row = repo(item_status="open"); settle(d, row, hit=True)
        r = R.run(d, apply=True, env=ENV, transport=down, now=T0)
        self.assertEqual(r["disagree"], [row["id"]])
        item = json.loads((d / f"docs/issues/Q-RESCORE-{row['id']}.json").read_text())
        self.assertIn(f"cmd:python3 -m foundation rescore --probe {row['id']}", item["body"])
        self.assertFalse(R.probe(d, row["id"])[0])

    def test_closed_item_whose_done_check_fails_is_a_miss(self):
        d, row = repo(done_check="file:absent.txt"); settle(d, row, hit=True)
        self.assertEqual(R.strict(d, D.load(d), row)[0], 0.0)

    def test_second_model_alone_can_disagree(self):
        d, row = repo(); settle(d, row)
        r = R.run(d, apply=True, env=ENV, transport=model('Sure. {"hit": false, "reason": "pull request was never merged"}'), now=T0)
        self.assertEqual(r["disagree"], [row["id"]])
        self.assertTrue(R.latest(d)[row["id"]]["model"])

    def test_unreachable_model_is_not_agreement_and_is_retried(self):
        d, row = repo(); settle(d, row)
        r = R.run(d, apply=True, env=ENV, transport=down, now=T0)
        got = R.latest(d)[row["id"]]
        self.assertEqual(r["model_unavailable"], 1); self.assertIsNone(got["model_hit"]); self.assertIsNone(got["model"])
        self.assertEqual(R.status(d)["second_model"]["verdicts"], 0)
        for _ in range(R.MODEL_TRIES):
            R.run(d, apply=True, env=ENV, transport=down, now=T0)
        self.assertEqual(R.latest(d)[row["id"]]["model_tries"], R.MODEL_TRIES, "retries are bounded")
        R.run(d, apply=True, env={}, now=T0)
        self.assertEqual(len(R._rows(d)), R.MODEL_TRIES)

    def test_null_from_the_model_is_cannot_tell(self):
        d, row = repo(); settle(d, row)
        R.run(d, apply=True, env=ENV, transport=model('{"hit": null, "reason": "evidence does not settle it"}'), now=T0)
        got = R.latest(d)[row["id"]]
        self.assertIsNone(got["model_hit"]); self.assertTrue(got["agree"])

    def test_check_fails_only_after_the_grace(self):
        d, row = repo(); settle(d, row)
        self.assertEqual(R.check(d, now=dt.datetime(2026, 11, 19, 13, 0, tzinfo=dt.timezone.utc)), [])
        self.assertTrue(R.check(d, now=dt.datetime(2026, 11, 25, 13, 0, tzinfo=dt.timezone.utc)))

    def test_dry_run_writes_nothing(self):
        d, row = repo(item_status="open"); settle(d, row)
        R.run(d, env=ENV, transport=down, now=T0)
        self.assertFalse((d / R.LEDGER).exists()); self.assertFalse(list((d / "docs/issues").glob("Q-RESCORE-*")))


if __name__ == "__main__":
    unittest.main()

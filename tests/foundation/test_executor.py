"""Executor: driver-order pick, path guard, edits, no-credential recording."""
import json, sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import executor  # noqa: E402

I = lambda n, labels=(), **k: {"number": n, "title": f"t{n}", "labels": [{"name": l} for l in labels], "updated_at": "2026-11-12T00:00:00Z", **k}


class Executor(unittest.TestCase):
    def test_pick_driver_order_and_skips(self):
        issues = [I(1, ["hold"]), I(2), I(3, ["p1"]), I(4, ["p0"], pull_request={}), I(5, ["owner"])]
        self.assertEqual(executor.pick(issues)["number"], 3)
        self.assertIsNone(executor.pick([I(1, ["blocked"])]))

    def test_stale_claim_is_retaken_fresh_is_not(self):
        import datetime as dt
        at = dt.datetime(2026, 11, 12, 1, 0, tzinfo=dt.timezone.utc)
        self.assertIsNone(executor.pick([I(1, ["in-progress"])], at))
        at2 = dt.datetime(2026, 11, 12, 4, 0, tzinfo=dt.timezone.utc)
        self.assertEqual(executor.pick([I(1, ["in-progress"])], at2)["number"], 1)

    def test_path_guard(self):
        for bad in ("/etc/x", "../x", ".github/workflows/a.yml", "autonomy/policy.json", ".git/config", "a/.env"):
            self.assertIsNotNone(executor.safe_path(bad), bad)
        self.assertIsNone(executor.safe_path("docs/a.md"))

    def test_apply_edits_writes_and_rejects(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(executor.apply_edits([{"path": "docs/a.md", "content": "x"}], d), ["docs/a.md"])
            self.assertEqual((Path(d) / "docs/a.md").read_text(), "x")
            with self.assertRaises(ValueError):
                executor.apply_edits([{"path": ".github/workflows/x.yml", "content": "x"}], d)
            with self.assertRaises(ValueError):
                executor.apply_edits([], d)

    def test_no_model_credential_is_recorded_not_hidden(self):
        import os, unittest.mock as m
        with tempfile.TemporaryDirectory() as d, m.patch.object(executor, "gh_json", return_value=[I(7)]), m.patch.dict(os.environ, {"EXECUTOR_SOURCE": "issues"}, clear=True):
            row = executor.run("o/r", apply=True, root=d)
            self.assertEqual(row["result"], "no-model-credential")
            line = json.loads((Path(d) / executor.LOG).read_text().splitlines()[0])
            self.assertEqual(line["issue"], 7)
            self.assertIn("within 24 h", line["prediction"])

    def test_pick_and_record_need_no_model_key(self):
        import os, unittest.mock as m
        with m.patch.object(executor, "gh_json", return_value=[I(3), I(2)]), m.patch.dict(os.environ, {"EXECUTOR_SOURCE": "issues"}, clear=True):
            self.assertEqual(executor.pick_row("o/r")["issue"], 2)

    def test_needs_you_page_is_current_and_link_only(self):
        from foundation import needsyou
        self.assertEqual(needsyou.check(), [])


if __name__ == "__main__":
    unittest.main()


NL = chr(10)


class QueueMode(unittest.TestCase):
    """QUEUE-1: the executor works repository-data items, needs no GitHub Issues, and the merge of its PR is the closure."""

    def _repo(self, d):
        (Path(d) / "docs/issues").mkdir(parents=True)
        for n, lab in (("Q-1", "p2"), ("Q-2", "p1")):
            body = NL.join(["**Owner:** executor", "**Trigger:** tick", "**Done check:** file:x", "**Status:** open", "", f"work {n}"])
            (Path(d) / f"docs/issues/{n}.json").write_text(json.dumps({"id": n, "title": n, "body": body, "labels": [lab]}))
        (Path(d) / "docs/issues/Q-3.json").write_text(json.dumps({"id": "Q-3", "title": "owner", "labels": ["p0"], "body": NL.join(["**Owner:** ROWAN", "**Trigger:** t", "**Done check:** file:x", "**Status:** open"])}))

    def test_takeable_skips_owner_items_and_orders_by_priority(self):
        with tempfile.TemporaryDirectory() as d:
            self._repo(d)
            from foundation import queue
            self.assertEqual(executor.pick(queue.takeable(d))["number"], "Q-2")
            self.assertEqual(sorted(i["number"] for i in queue.takeable(d)), ["Q-1", "Q-2"])

    def test_three_failures_park_an_item_and_close_requires_evidence(self):
        with tempfile.TemporaryDirectory() as d:
            self._repo(d)
            from foundation import queue
            for _ in range(3):
                executor.log(d, {"issue": "Q-2", "result": "failed"})
            self.assertEqual([i["number"] for i in queue.takeable(d)], ["Q-1"])
            queue.close(d, "Q-1", "closed by the pull request that carries this change")
            self.assertEqual(queue.takeable(d), [])
            self.assertNotIn("Q-1: closed without evidence", "".join(queue.check(d)))


if __name__ == "__main__":
    unittest.main()


class RepairLoop(unittest.TestCase):
    def test_repairs_and_server_side_constraint_are_in_the_code(self):
        from foundation import executor
        src = Path(executor.__file__).read_text(encoding="utf-8")
        self.assertGreaterEqual(executor.REPAIRS, 1)
        self.assertIn("YOUR PREVIOUS ATTEMPT FAILED THESE CHECKS", src)
        self.assertIn("Server-side only: never reference localhost", executor.build_prompt({"number": 1, "title": "t", "body": ""}, ""))

    def test_cloudflare_dict_response_is_accepted(self):
        import io, os, urllib.request
        from unittest import mock
        body = json.dumps({"result": {"response": {"summary": "s", "files": []}}}).encode()
        with mock.patch.dict(os.environ, {"CLOUDFLARE_ACCOUNT_ID": "a", "CLOUDFLARE_API_TOKEN": "t"}), \
             mock.patch.object(urllib.request, "urlopen", return_value=io.BytesIO(body)):
            self.assertEqual(executor.call_cloudflare("p")["summary"], "s")

    def test_crossrepo_eligibility_and_pr_body(self):
        from foundation import crossrepo as cx
        ok = {"title": "packs: x", "body": "a\n\nClosing probe: file_exists:core/x.js", "labels": [{"name": "open-loop"}]}
        self.assertTrue(cx.eligible(ok))
        self.assertFalse(cx.eligible(dict(ok, labels=[{"name": "protected-change"}])))
        self.assertFalse(cx.eligible(dict(ok, title="EPIC: all")))
        self.assertFalse(cx.eligible(dict(ok, body="no probe here")))
        body = cx.pr_body(7, {"models": ["m"]}, "t")
        for field in ("Item: #7", "Spec:", "Prediction:", "Evidence:", "Author:", "Reviewer:", "Closes #7"):
            self.assertIn(field, body)

    def test_crossrepo_cap_stops_intake(self):
        from foundation import crossrepo as cx
        from unittest import mock
        with mock.patch.object(cx, "prs_today", return_value=cx.MAX_PRS_PER_DAY):
            self.assertEqual(cx.takeable("o/r"), [])

    def test_every_generated_file_checked_in_ci_is_regenerated_by_the_executor(self):
        """Root cause of repeated executor PR failures: a queue change made site/roadmap-data.js stale and the executor did not regenerate it."""
        ci = (Path(executor.__file__).resolve().parents[1] / ".github/workflows/checks.yml").read_text(encoding="utf-8")
        self.assertIn("build_site_roadmap.py --check", ci)
        self.assertIn(["python3", "scripts/build_site_roadmap.py"], executor.GENERATORS)

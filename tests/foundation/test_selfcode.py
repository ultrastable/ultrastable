# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SELFCODE-1: sensors, rails, scope, learning and settle of the self-improving code loop."""
import json, sys, unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import agents, selfcode  # noqa: E402
from tests.foundation import _repo  # noqa: E402

ENV = {"GITHUB_MODELS_TOKEN": "t"}


def tree(files: dict) -> Path:
    d = _repo.scratch()
    (d / "doctrine").mkdir(); (d / "doctrine/selfcode.json").write_text((ROOT / "doctrine/selfcode.json").read_text())
    for p, c in files.items():
        (d / p).parent.mkdir(parents=True, exist_ok=True); (d / p).write_text(c)
    return d


class Sensors(unittest.TestCase):
    def test_unused_import_and_swallowed_error_found(self):
        d = tree({"foundation/a.py": "import os, re\nfrom x import y\n\ntry:\n    pass\nexcept Exception:\n    pass\nprint(os.name)\n",
                  "scripts/b.py": "import json\n\n\ndef f():\n    try:\n        return json.loads('1')\n    except:\n        return 0\n"})
        by = {(f["kind"], f["key"]): f for f in selfcode.sense_files(d)}
        self.assertEqual(by[("unused_import", "foundation/a.py")]["count"], 2)  # re and y
        self.assertIn(("bare_except", "foundation/a.py"), by); self.assertIn(("bare_except", "scripts/b.py"), by)
        self.assertNotIn(("unused_import", "scripts/b.py"), by)

    def test_noqa_all_and_string_use_are_not_flagged(self):
        d = tree({"foundation/a.py": "import os  # noqa\nimport re\nfrom m import n\n__all__ = ['n']\nX = 'uses re inside a string'\n"})
        self.assertFalse([f for f in selfcode.sense_files(d) if f["kind"] == "unused_import"])

    def test_probe_clears_when_fixed(self):
        d = tree({"foundation/a.py": "import os\n"})
        self.assertFalse(selfcode.probe("unused_import", "foundation/a.py", d))
        (d / "foundation/a.py").write_text("x = 1\n")
        self.assertTrue(selfcode.probe("unused_import", "foundation/a.py", d))

    def test_unknowns_ledger_last_row_wins(self):
        d = tree({"ops/unknowns/ledger.jsonl": '{"id":"U1","status":"open","question":"q"}\n{"id":"U2","status":"open"}\n{"id":"U2","status":"answered"}\n'})
        self.assertEqual([f["key"] for f in selfcode.sense_unknowns(d)], ["U1"])


class Rails(unittest.TestCase):
    def f(self, kind="unused_import", key="foundation/a.py", count=1):
        return {"kind": kind, "key": key, "count": count, "detail": ["d"]}

    def test_scope_blocks_protected_paths(self):
        self.assertEqual(selfcode.scope_violation(["foundation/a.py", ".github/workflows/x.yml", "autonomy/policy.json", "doctrine/x.json"]), [".github/workflows/x.yml", "autonomy/policy.json", "doctrine/x.json"])
        self.assertEqual(selfcode.check(), [])

    def test_caps_cooldown_and_open_items(self):
        d = tree({})
        found = [self.f(key=f"foundation/{i}.py") for i in range(5)]
        self.assertEqual(len(selfcode.pick_findings(found, [], set(), d)), 1)  # max_new_per_run
        self.assertEqual(selfcode.pick_findings(found, [], {"a", "b", "c"}, d), [])  # max_open
        iid = selfcode.item_for(found[0])["id"]
        recent = [{"id": iid, "kind": "unused_import", "status": "filed", "at": selfcode.stamp()}]
        self.assertNotIn(found[0], selfcode.pick_findings(found[:1], recent, set(), d))  # cooldown
        self.assertEqual(selfcode.pick_findings(found[:1], [], {iid}, d), [])  # already open

    def test_higher_weight_kind_first_and_item_has_probe(self):
        d = tree({})
        top = selfcode.pick_findings([self.f("todo"), self.f("failing_test", "tests.foundation.test_x")], [], set(), d)[0]
        self.assertEqual(top["kind"], "failing_test")
        it = selfcode.item_for(top)
        self.assertIn("cmd:python3 -m foundation selfcode --probe failing_test tests.foundation.test_x", it["body"])
        self.assertIn("**Status:** open", it["body"])

    def test_kill_switch(self):
        d = tree({})
        c = json.loads((d / "doctrine/selfcode.json").read_text()); c["enabled"] = False
        (d / "doctrine/selfcode.json").write_text(json.dumps(c))
        self.assertEqual(selfcode.run_sense(d, apply=True)["result"], "disabled")
        self.assertFalse(selfcode.enabled(ROOT, {"SELFCODE_OFF": "1"})); self.assertFalse(selfcode.enabled(ROOT, {"HALT": "1"}))


class Learning(unittest.TestCase):
    def rows(self, kind, outcomes):
        at = selfcode.stamp()
        return [{"id": f"{kind}-{i}", "kind": kind, "status": s, "at": at} for i, s in enumerate(outcomes)]

    def test_kept_rate_and_pause(self):
        r = self.rows("todo", ["kept", "reverted", "failed"])
        self.assertEqual(selfcode.kept_rate(r, "todo"), (3, 1 / 3))
        self.assertTrue(selfcode.paused(r, "todo", ROOT))
        self.assertFalse(selfcode.paused(self.rows("todo", ["kept", "kept", "failed"]), "todo", ROOT))
        self.assertFalse(selfcode.paused(self.rows("todo", ["failed"]), "todo", ROOT))  # too few settled
        later = datetime.now(timezone.utc) + timedelta(hours=100)
        self.assertFalse(selfcode.paused(r, "todo", ROOT, later))  # the pause expires and the kind is tried again

    def test_paused_kind_is_not_filed_and_proven_kind_ranks_higher(self):
        r = self.rows("todo", ["reverted", "reverted", "reverted"])
        self.assertEqual(selfcode.pick_findings([{"kind": "todo", "key": "foundation/a.py", "count": 1, "detail": []}], r, set(), ROOT), [])
        a, b = {"kind": "bare_except", "key": "x", "count": 1}, {"kind": "unused_import", "key": "y", "count": 1}
        good = self.rows("unused_import", ["kept", "kept", "kept"])
        self.assertGreater(selfcode.score(b, good, ROOT), selfcode.score(b, [], ROOT)); self.assertGreater(selfcode.score(a, [], ROOT), selfcode.score(b, [], ROOT) * 0.99)

    def test_ledger_is_append_only_last_row_wins(self):
        d = tree({})
        with mock.patch("foundation.provenance.record"):
            selfcode.append(d, {"id": "Q-1", "kind": "todo", "key": "k", "status": "filed", "before": 1})
            selfcode.append(d, {"id": "Q-1", "kind": "todo", "key": "k", "status": "kept"})
        st = selfcode.states(selfcode.ledger_rows(d))
        self.assertEqual(st["Q-1"]["status"], "kept"); self.assertEqual(st["Q-1"]["before"], 1)


class Settle(unittest.TestCase):
    def setUp(self):
        self.d = tree({"foundation/a.py": "x = 1\n"})
        with mock.patch("foundation.provenance.record"):
            selfcode.append(self.d, {"id": "Q-SELF-unused-import-a", "kind": "unused_import", "key": "foundation/a.py", "before": 1, "status": "filed"})
        merged = (datetime.now(timezone.utc) - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
        self.pr = {"state": "MERGED", "mergedAt": merged, "mergeCommit": {"oid": "abc1234"}, "number": 9}
        self.exec = [{"issue": "Q-SELF-unused-import-a", "result": "pr-opened", "pr": "https://github.com/o/r/pull/9"}]

    def go(self, failed):
        with mock.patch("foundation.queue.executor_rows", return_value=self.exec), mock.patch("foundation.selfcode.pr_state", return_value=self.pr), \
                mock.patch("foundation.selfcode.runs_failed_on", return_value=failed), mock.patch("foundation.selfcode.revert", return_value="https://x/pull/10") as rv, mock.patch("foundation.provenance.record"):
            return selfcode.run_settle(self.d, apply=True), rv

    def test_clean_merge_with_signal_gone_is_kept(self):
        res, rv = self.go([])
        self.assertEqual(res["outcomes"][0]["status"], "kept"); rv.assert_not_called()
        self.assertEqual(selfcode.states(selfcode.ledger_rows(self.d))["Q-SELF-unused-import-a"]["status"], "kept")

    def test_failed_workflow_on_merge_commit_reverts(self):
        res, rv = self.go(["deploy-workers"])
        self.assertEqual(res["outcomes"][0]["status"], "reverted"); rv.assert_called_once()

    def test_signal_that_did_not_move_is_learned_not_rolled_back(self):
        (self.d / "foundation/a.py").write_text("import os\n")
        res, rv = self.go([])
        self.assertEqual(res["outcomes"][0]["status"], "reverted"); rv.assert_not_called()

    def test_runs_still_going_waits(self):
        res, _ = self.go(None)
        self.assertEqual(res["outcomes"], [])


class GithubModels(unittest.TestCase):
    def test_route_uses_actions_token_and_parses_chat_reply(self):
        a = {x["id"]: x for x in agents.load(ROOT)["adapters"]}["github-models-gpt"]
        u, h, b = agents.build_request(a, "p", ENV)
        self.assertEqual(u, "https://models.github.ai/inference/chat/completions"); self.assertEqual(h["authorization"], "Bearer t"); self.assertEqual(b["model"], "openai/gpt-4.1")
        self.assertEqual(agents.parse_text(a, {"choices": [{"message": {"content": "hi"}}]}), "hi")
        ids = [x["id"] for x in agents.route_authors(ENV, ROOT)]
        self.assertEqual(ids[:2], ["github-models-gpt", "github-models-deepseek"])  # free routes first
        self.assertEqual(agents.route_authors({}, ROOT), [])
        self.assertEqual({x["family"] for x in agents.ensemble("openai", ENV, ROOT)}, {"deepseek"})

    def test_invoke_github_models_deepseek(self):
        a = {x["id"]: x for x in agents.load(ROOT)["adapters"]}["github-models-deepseek"]
        calls = []
        agents.invoke(a, "p", ENV, lambda u, h, b, timeout=300: calls.append(b) or {"choices": [{"message": {"content": "{}"}}]})
        self.assertEqual(calls[0]["model"], "deepseek/DeepSeek-V3-0324")


if __name__ == "__main__":
    unittest.main()

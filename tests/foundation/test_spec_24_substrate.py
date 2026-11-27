# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""US-SPEC-24 requirements whose only implementation is in the platform (foundation/, scripts/, github/), named by requirement id so
the specification can cite them: R01 (items as issues, a one-way mirror), R02 (Discussions off), R06 (two routes per duty),
R07 (the ruleset), R40 (public repositories relax nothing), R18 (no unpinned action reference), R61 (one repository standard,
read back)."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
for p in (str(ROOT), str(ROOT / "scripts"), str(ROOT / "workers" / "tools"), str(HERE)):
    if p not in sys.path:
        sys.path.insert(0, p)
from foundation import actionpins, ghmirror, repostd as rs  # noqa: E402
import check_routes  # noqa: E402
import workflow_lint as wl  # noqa: E402
import test_repostd as base  # noqa: E402

STD = rs.standard(ROOT)


class Substrate(unittest.TestCase):
    def test_us_24_r01_an_item_is_one_issue_found_again_by_its_marker_and_the_file_wins(self):
        item = {"id": "Q-1", "title": "do it", "body": "**Owner:** staff\n**Status:** open\n", "labels": ["p1"], "milestone": "Now"}
        want = ghmirror.desired(item)
        self.assertEqual((want["title"], want["state"], "queue" in want["labels"]), ("Q-1: do it", "open", True))
        self.assertIn("<!-- us-item:Q-1 -->", want["body"])
        self.assertEqual([a[0] for a in ghmirror.plan([want], [], {"queue", "p1"}, {"Now": 1})], ["create"])
        have = [{"number": 7, "state": "open", "title": "edited by hand", "body": want["body"], "labels": [{"name": n} for n in want["labels"]], "milestone": {"title": "Now"}}]
        acts = ghmirror.plan([want], have, {"queue", "p1"}, {"Now": 1})
        self.assertEqual([(a[0], a[2]) for a in acts], [("update", 7)], "a hand edit on GitHub is put back to the ledger's value")
        self.assertEqual(ghmirror.plan([want], [dict(have[0], title=want["title"])], {"queue", "p1"}, {"Now": 1}), [], "equal means no write: idempotent")
        done = ghmirror.desired(dict(item, body="**Status:** closed\n"))
        self.assertEqual(done["state"], "closed", "the mirror follows the file's status and never the other way")

    def test_us_24_r02_discussions_are_off_for_the_platform_repository_and_the_settings_script_enables_them_only_when_asked(self):
        settings = json.loads((ROOT / "github/org-settings.json").read_text(encoding="utf-8"))["repos"]["ultrastable/ultrastable"]["settings"]
        self.assertIs(settings["has_discussions"], False)
        script = (ROOT / "workers/tools/github_settings.py").read_text(encoding="utf-8")
        self.assertIn("--discussions", script)

    def test_us_24_r06_a_duty_with_one_live_host_or_one_credential_fails_the_two_route_check(self):
        self.assertEqual(check_routes.check(str(ROOT)), [], "the platform's own registry passes")
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            reg = json.loads((ROOT / "instances/ultrastable/loops.json").read_text(encoding="utf-8"))
            (root / "instances/ultrastable").mkdir(parents=True)
            (root / "deploy").mkdir()
            (root / reg["deploy_routes"]).write_text((ROOT / reg["deploy_routes"]).read_text(encoding="utf-8"), encoding="utf-8")
            live = [h for h in reg["hosts"] if h["state"] in check_routes.LIVE]
            for h in live:
                (root / h["adapter"]).parent.mkdir(parents=True, exist_ok=True)
                (root / h["adapter"]).write_text("", encoding="utf-8")
            reg["hosts"] = live[:1]
            (root / "instances/ultrastable/loops.json").write_text(json.dumps(reg), encoding="utf-8")
            problems = check_routes.check(str(root))
            self.assertTrue(any("only 1 live host" in p for p in problems), problems)

    def test_us_24_r07_the_ruleset_refuses_deletion_and_force_push_has_no_bypass_actor_and_is_gated_on_a_private_repository(self):
        rule = STD["worker"]["ruleset"]
        self.assertEqual((rule["name"], rule["enforcement"], rule["bypass_actors"]), ("main-no-rewrite", "active", []))
        self.assertEqual(sorted(r["type"] for r in rule["rules"]), ["deletion", "non_fast_forward"])
        self.assertIn("ruleset", STD["worker"]["private_plan_gated"])
        repos = {"ops": base.good_live("ops", rs.desired("ops", root=ROOT))}
        r = rs.measure(base.FakeApi(repos, {"ops": {"workflows": 0, "missing": {".github/workflows/branch-cleanup.yml"}}}), "ops", rs.desired("ops", root=ROOT), STD)
        self.assertIn("ruleset", r["gated"], "a private repository's ruleset is reported as gated, not as met and not as a failure")
        self.assertEqual(r["findings"], [])

    def test_us_24_r40_a_public_repository_relaxes_no_lint_rule_and_only_the_minutes_pause_is_waived(self):
        bad = "name: x\non:\n  pull_request_target:\n  schedule:\n    - cron: '0 * * * *'\njobs:\n  t:\n    runs-on: macos-latest\n    steps:\n      - uses: owner/act@main\n"
        found = {f.split()[1] for f in wl.lint_text(bad)}
        self.assertTrue({"W01", "W02", "W03", "W04", "W05", "W06", "W08"} <= found, "the rules of 7.2 have no public-repository exemption flag")
        guard = (ROOT / "scripts/actions_guard.py").read_text(encoding="utf-8")
        self.assertIn("the budget pause does not apply", guard, "the waiver is for the minutes pause alone")
        import inspect
        self.assertFalse([n for n in inspect.signature(wl.lint_text).parameters if "public" in n or "private" in n], "the linter has no switch that treats a public repository differently")
        self.assertIs(STD["worker"]["settings"]["allow_squash_merge"] and not STD["worker"]["settings"]["allow_merge_commit"], True, "the settings of 7.4 are one default for public and private alike")

    def test_us_24_r18_the_count_of_unpinned_action_references_does_not_rise_and_a_tag_reference_is_found(self):
        base_count = json.loads((ROOT / "doctrine/supply-chain.json").read_text(encoding="utf-8"))["unpinned_baseline"]
        self.assertLessEqual(len(actionpins.unpinned(ROOT)), base_count)
        with tempfile.TemporaryDirectory() as d:
            wf = Path(d) / ".github/workflows"
            wf.mkdir(parents=True)
            sha = "a" * 40
            (wf / "x.yml").write_text(f"jobs:\n  t:\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@{sha}\n      - uses: ./local\n", encoding="utf-8")
            self.assertEqual(actionpins.unpinned(Path(d)), ["x.yml: actions/checkout@v4"])

    def test_us_24_r61_one_standard_is_read_back_gated_where_the_plan_withholds_it_and_unmeasured_where_it_cannot_be_read(self):
        repos = {"unlearn": base.good_live("unlearn", rs.desired("unlearn", root=ROOT))}
        want = rs.desired("unlearn", root=ROOT)
        ok = rs.measure(base.FakeApi(repos, {"unlearn": {"workflows": 2, "ruleset": True}}), "unlearn", want, STD)
        self.assertEqual((ok["findings"], ok["unmeasured"], ok["status"]), ([], [], "measured"))
        wrong = {"unlearn": dict(repos["unlearn"], allow_merge_commit=True, delete_branch_on_merge=False)}
        r = rs.measure(base.FakeApi(wrong, {"unlearn": {"workflows": 2, "ruleset": True}}), "unlearn", want, STD)
        self.assertTrue(any("allow_merge_commit is true" in f for f in r["findings"]) and any("delete_branch_on_merge is false" in f for f in r["findings"]), r["findings"])
        hidden = {"unlearn": {k: v for k, v in repos["unlearn"].items() if k != "allow_auto_merge"}}
        u = rs.measure(base.FakeApi(hidden, {"unlearn": {"ruleset": True}}), "unlearn", want, STD)
        self.assertEqual(u["status"], "partly-unmeasured")
        self.assertTrue(any("allow_auto_merge" in x for x in u["unmeasured"]))
        self.assertEqual(rs.measure(base.FakeApi({}, listing=False), "unlearn", want, STD)["status"], "unmeasured", "a repository that cannot be read is never ok")
        for k in ("allow_squash_merge", "allow_auto_merge", "delete_branch_on_merge"):
            self.assertIs(STD["worker"]["settings"][k], True)
        self.assertEqual(STD["worker"]["security"]["secret_scanning"], "enabled")


if __name__ == "__main__":
    unittest.main()

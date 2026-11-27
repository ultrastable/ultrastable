# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-SPEC-33, rulings made when the specification was brought level with the code: what the Actions lane and the lane watch read of a hold (R13, R56),
the shipped session-reaper policy (R57), the executor's deny list by file name (R61), the completion sweep (R101) and the workflow-file credential route
of the Actions lane (R102). Every GitHub call is a fake; every git
repository is a scratch one. Each test names the requirement it proves."""
import json, os, shutil, stat, subprocess, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "tests/foundation"))
from foundation import executor, lanewatch, sessions  # noqa: E402
import lane_credential  # noqa: E402
import test_lane_merger as tlm  # noqa: E402

NEEDS_SHELL = unittest.skipUnless(shutil.which("bash") and shutil.which("jq") and shutil.which("git"), "the lane scripts need bash, jq and git (all are on the Actions runner)")


def tmp(test):
    from _repo import scratch
    return scratch()


class LaneWatchHolds(unittest.TestCase):
    def test_us_33_r56_and_r13_a_held_pull_request_is_not_a_finding_so_the_remediation_never_merges_it(self):
        """US-33-R56, US-33-R13: lane.yml runs scripts/lane.sh and then lanewatch --remediate; a hold the lane honours must hold in the next step too"""
        import datetime as dt
        from unittest import mock
        now = dt.datetime(2026, 11, 26, 12, 0, tzinfo=dt.timezone.utc)
        old = (now - dt.timedelta(minutes=10)).isoformat().replace("+00:00", "Z")
        pr = lambda n, **o: {"number": n, "isDraft": False, "mergeable": "MERGEABLE", "labels": [], "comments": [], "updatedAt": old,
                             "statusCheckRollup": [{"conclusion": "SUCCESS"}], "headRefOid": "sha" + str(n), **o}
        prs = [pr(1, labels=[{"name": "hold"}]), pr(2, comments=[{"body": "HOLD: the migration first"}]), pr(3, comments=[{"body": "I would HOLD: this"}]), pr(4, labels=["hold"]), pr(5)]
        self.assertEqual([g["number"] for g in lanewatch.classify(prs, now)], [3, 5], "the label (as an object or a name) and a comment that starts with HOLD: hold; a comment that only contains it does not")
        self.assertTrue(lanewatch.held(prs[0]) and lanewatch.held(prs[1]) and not lanewatch.held(prs[2]))
        ran = []

        def run(cmd, capture_output=None, text=None):
            ran.append(cmd)
            if cmd[:3] == ["gh", "pr", "list"]:
                return mock.Mock(returncode=0, stdout=json.dumps(prs[:2]), stderr="")
            return mock.Mock(returncode=0, stdout="", stderr="")
        with mock.patch.object(lanewatch.subprocess, "run", run), mock.patch.object(lanewatch, "datetime", wraps=dt.datetime) as D:
            D.now.return_value = now; D.fromisoformat = dt.datetime.fromisoformat
            self.assertEqual(lanewatch.main(["--check", "--remediate"]), 0, "a held pull request is not stuck: the run stays green")
        self.assertFalse([c for c in ran if c[:3] == ["gh", "pr", "merge"]], "nothing held is merged")
        listing = next(c for c in ran if c[:3] == ["gh", "pr", "list"])
        self.assertIn("comments", listing[listing.index("--json") + 1].split(","), "the list asks gh for the comments, in the same call")


class SessionPolicy(unittest.TestCase):
    def test_us_33_r57_the_shipped_ttl_is_about_ten_minutes_with_a_floor_of_a_tenth_of_an_hour_and_the_reaper_halves_it_to_the_floor(self):
        """US-33-R57"""
        pol = sessions.policy(ROOT)
        self.assertGreater(pol["idle_ttl_hours"], 0)
        self.assertLessEqual(pol["ttl_floor_hours"], pol["idle_ttl_hours"])
        self.assertEqual(sessions.check(ROOT), [], "the policy file in the repository passes its own check")
        # the values the specification states, read from the file the code reads (the reaper may have rewritten idle_ttl_hours since: then the ledger says so)
        hist = [h for h in pol.get("history", []) if h.get("grade") != "reverted"]
        if not hist:
            self.assertEqual((pol["idle_ttl_hours"], pol["ttl_floor_hours"]), (0.17, 0.1))
        self.assertEqual(pol["ttl_floor_hours"], 0.1)
        base = {"idle_ttl_hours": 0.17, "ttl_floor_hours": 0.1, "backlog_owner": "operations"}
        H, now = 3600, 1_000_000
        it = lambda name, age: {"name": name, "last_activity": now - age, "sha": "a" * 40, "ahead": 1, "pr": None, "draft": True, "checks": "unknown"}
        ttl = int(0.17 * H)
        r = sessions.classify([it("agent/at", ttl), it("agent/over", ttl + 60), it("agent/four-hours", 4 * H)], now, base)
        self.assertEqual(r["live"], ["agent/at"], "an age equal to the TTL is live; one minute more is a zombie, four hours is long past")
        self.assertEqual([z["name"] for z in r["zombies"]], ["agent/over", "agent/four-hours"])
        d = tmp(self); (d / "doctrine").mkdir(); (d / "ops").mkdir(); sessions._write_policy(d, dict(base))
        for z in (1, 2):
            with (d / sessions.LEDGER).open("a") as f:
                f.write(json.dumps({"at": z, "entered": z, "live": 0, "zombies": z, "dispositions": [], "invariant": True}) + "\n")
        m = sessions.meta(d)
        self.assertEqual((m["change"]["from"], m["change"]["to"]), (0.17, 0.1), "halved and rounded to two decimals gives 0.09, which the floor lifts to 0.1")
        self.assertEqual(sessions.policy(d)["idle_ttl_hours"], 0.1)


class ExecutorDenyNames(unittest.TestCase):
    def test_us_33_r61_a_file_named_exactly_env_id_rsa_or_credentials_is_refused_in_any_directory_and_a_name_that_only_ends_like_one_is_not(self):
        """US-33-R61"""
        self.assertEqual(executor.DENY_NAMES, (".env", "id_rsa", "credentials"))
        for bad in (".env", "config/.env", "a/b/id_rsa", "x/credentials", "ops/executor-log.jsonl"):
            self.assertIsNotNone(executor.safe_path(bad), bad)
        for good in ("prod.env", "config/prod.env", "my_id_rsa", "id_rsa.pub", "credentials.md", "docs/credentials/readme.md"):
            self.assertIsNone(executor.safe_path(good), good)


FAKE_GH = r'''#!/usr/bin/env python3
"""A stand-in for the gh CLI for the completion sweep: answers from a JSON state file and logs every call."""
import json, os, subprocess, sys
a = sys.argv[1:]
state = json.load(open(os.environ["FAKE_GH_STATE"]))
open(os.environ["FAKE_GH_LOG"], "a").write(json.dumps(a) + "\n")

def out(value):
    if "--jq" in a:
        r = subprocess.run(["jq", "-r", a[a.index("--jq") + 1]], input=json.dumps(value), capture_output=True, text=True)
        sys.stdout.write(r.stdout); sys.exit(r.returncode)
    print(json.dumps(value)); sys.exit(0)

opt = lambda k: a[a.index(k) + 1] if k in a else None
if a[:1] == ["api"] and len(a) > 1 and a[1] == "repos/o/r":
    out({"has_issues": state["has_issues"]})
if a[:1] == ["api"] and a[1].endswith("/branches"):
    out([{"name": n} for n in state["branches"]])
if a[:2] == ["pr", "list"]:
    head, st = opt("--head"), opt("--state")
    out(state["prs"].get(f"{head}:{st}", []) if head else [])
if a[:2] == ["issue", "list"]:
    out([{"number": n} for n in state["done_issues"]])
sys.exit(0)
'''


@NEEDS_SHELL
class CompletionSweep(unittest.TestCase):
    OLD = "2026-01-01T00:00:00Z"

    def git(self, cwd, *a, date=None):
        env = {**os.environ, "GIT_AUTHOR_DATE": date or self.OLD, "GIT_COMMITTER_DATE": date or self.OLD}
        return subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t", *a], cwd=cwd, check=True, capture_output=True, text=True, env=env).stdout.strip()

    def commit(self, w, branch, base, name, text, date=None):
        self.git(w, "checkout", "-q", "-B", branch, base)
        (w / name).write_text(text)
        self.git(w, "add", name); self.git(w, "commit", "-q", "-m", f"{branch}: {name}", date=date)
        sha = self.git(w, "rev-parse", "HEAD")
        self.git(w, "push", "-q", "origin", f"{branch}:{branch}")
        return sha

    def world(self, has_issues=True):
        d = tmp(self)
        self.git(d, "init", "-q", "--bare", "-b", "main", "origin.git")
        w = d / "w"; self.git(d, "clone", "-q", "origin.git", "w")
        (w / "base.txt").write_text("base"); self.git(w, "add", "."); self.git(w, "commit", "-q", "-m", "c0"); self.git(w, "branch", "-M", "main")
        c0 = self.git(w, "rev-parse", "HEAD"); self.git(w, "push", "-q", "origin", "main")
        tips = {}
        for b in ("claude/merged", "claude/open-contained"):      # their tip is c0: an ancestor of main once main moves
            self.git(w, "push", "-q", "origin", f"{c0}:refs/heads/{b}"); tips[b] = c0
        tips["claude/squashed"] = self.commit(w, "claude/squashed", c0, "s.txt", "squash")
        tips["claude/landed"] = self.commit(w, "claude/landed", c0, "l.txt", "same")
        tips["claude/unmerged"] = self.commit(w, "claude/unmerged", c0, "u.txt", "work")
        tips["claude/carried"] = self.commit(w, "claude/carried", c0, "c.txt", "carried")
        tips["parked/x"] = self.commit(w, "parked/x", c0, "p.txt", "parked")
        tips["loop-evidence"] = self.commit(w, "loop-evidence", c0, "e.txt", "evidence")
        tips["claude/young"] = self.commit(w, "claude/young", c0, "y.txt", "young", date=subprocess.run(["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"], capture_output=True, text=True).stdout.strip())
        self.git(w, "checkout", "-q", "main"); (w / "l.txt").write_text("same"); self.git(w, "add", "."); self.git(w, "commit", "-q", "-m", "main also lands l.txt"); self.git(w, "push", "-q", "origin", "main")
        state = {"has_issues": has_issues, "done_issues": [7], "branches": ["main", *tips], "prs": {
            "claude/open-contained:open": [{"number": 11}],
            "claude/squashed:merged": [{"mergedAt": "2026-01-02T00:00:00Z", "headRefOid": tips["claude/squashed"]}],
            "claude/carried:closed": [{"headRefOid": tips["claude/carried"]}]}}
        (d / "state.json").write_text(json.dumps(state)); (d / "log.jsonl").write_text("")
        gh = d / "bin" / "gh"; gh.parent.mkdir(); gh.write_text(FAKE_GH); gh.chmod(gh.stat().st_mode | stat.S_IEXEC)
        return d, w

    def sweep(self, has_issues=True):
        d, w = self.world(has_issues)
        env = {"PATH": f"{d / 'bin'}:{os.environ['PATH']}", "GITHUB_REPOSITORY": "o/r", "HOME": str(d), "FAKE_GH_STATE": str(d / "state.json"), "FAKE_GH_LOG": str(d / "log.jsonl")}
        r = subprocess.run(["bash", str(ROOT / "scripts/completion_sweep.sh")], env=env, capture_output=True, text=True, timeout=120, cwd=w)
        calls = [json.loads(l) for l in (d / "log.jsonl").read_text().splitlines()]
        return r, calls

    def test_us_33_r101_finished_work_is_closed_and_nothing_with_unmerged_commits_is_deleted(self):
        """US-33-R101"""
        r, calls = self.sweep()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        deleted = {c[3].rsplit("heads/", 1)[1] for c in calls if c[:3] == ["api", "-X", "DELETE"]}
        self.assertEqual(deleted, {"claude/merged", "claude/squashed", "claude/landed"}, "an ancestor of main, a squash-merged tip and a branch whose content already landed are deleted; nothing else")
        for kept in ("claude/unmerged", "claude/carried", "parked/x", "claude/young", "loop-evidence", "main"):
            self.assertNotIn(kept, deleted, kept)
        closed = [c for c in calls if c[:2] == ["pr", "close"]]
        self.assertEqual([c[2] for c in closed], ["11"], "an open pull request whose commits are all in main is closed, with a comment")
        self.assertIn("--comment", closed[0])
        created = [c[c.index("--head") + 1] for c in calls if c[:2] == ["pr", "create"]]
        self.assertEqual(created, ["claude/unmerged"], "only an old unmerged branch with no pull request gets one: not a parked/ branch, not one a closed pull request already carried, not a young one")
        make = next(c for c in calls if c[:2] == ["pr", "create"]); self.assertEqual(make[make.index("--title") + 1], "automerge: claude/unmerged")
        self.assertEqual([c[2] for c in calls if c[:2] == ["issue", "close"]], ["7"], "an open issue labelled done is closed with a comment")
        self.assertIn("cycle_metric leftover_after_sweep prs_idle_over_1d=", r.stdout)
        self.assertIn("BRANCH-CLEANUP-1", r.stdout + r.stderr, "the fleet branch cleanup is run and its failure is reported as a warning, never swallowed")

    def test_us_33_r101_with_issues_off_the_issue_steps_are_skipped_and_the_branch_steps_still_run(self):
        """US-33-R101"""
        r, calls = self.sweep(has_issues=False)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual([c for c in calls if c[:1] == ["issue"]], [])
        self.assertIn("done_issues=off", r.stdout)
        self.assertTrue([c for c in calls if c[:3] == ["api", "-X", "DELETE"]], "branches are still swept")

    def test_us_33_r101_a_second_pass_over_the_same_state_does_the_same_thing(self):
        """US-33-R101: idempotent, because each decision reads the repository and not what an earlier pass did"""
        (r1, c1), (r2, c2) = self.sweep(), self.sweep()
        pick = lambda calls: sorted(" ".join(c[:4]) for c in calls if c[:3] == ["api", "-X", "DELETE"] or c[:2] in (["pr", "close"], ["pr", "create"]))
        self.assertEqual(pick(c1), pick(c2))
        self.assertEqual(len(pick(c1)), 5, "three deletions, one close and one pull request")


@NEEDS_SHELL
class ActionsLaneHolds(unittest.TestCase):
    PAT = "pat-value-for-the-test"
    run_lane = tlm.LaneMergesNeedsPat.run_lane
    merges = staticmethod(tlm.LaneMergesNeedsPat.merges)

    def test_us_33_r13_the_actions_lane_holds_on_the_label_and_on_a_comment_that_starts_with_hold(self):
        """US-33-R13, US-33-R05"""
        prs = {"1": {**tlm.pr("aaa1111"), "comments": [{"body": "HOLD: not yet"}]}, "2": {**tlm.pr("bbb2222"), "comments": [{"body": "I would HOLD: this"}]},
               "3": tlm.pr("ccc3333", labels=("hold",)), "4": {**tlm.pr("ddd4444"), "comments": [{"body": None}]}}
        r, calls = self.run_lane(prs, {s: tlm.GREEN for s in ("aaa1111", "bbb2222", "ccc3333", "ddd4444")})
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(sorted(self.merges(calls)), ["2", "4"], "a comment that only contains HOLD: and a comment with no text do not hold")
        self.assertIn("#1 HOLD", r.stdout); self.assertIn("#3 hold", r.stdout)
        view = next(c["argv"] for c in calls if c["argv"][:3] == ["pr", "view", "1"])
        self.assertIn("comments", view[view.index("--json") + 1].split(","), "the comments come in the same gh call as the labels")


@NEEDS_SHELL
class WorkflowCredentialRoute(unittest.TestCase):
    PAT = "pat-value-for-the-test"
    run_lane = tlm.LaneMergesNeedsPat.run_lane
    merges = staticmethod(tlm.LaneMergesNeedsPat.merges)

    def test_us_33_r102_the_source_prefers_the_token_then_the_app_and_half_an_app_is_none_and_token_without_a_credential_fails_with_no_secret_in_the_reason(self):
        """US-33-R102"""
        self.assertEqual(lane_credential.source({}), "none")
        self.assertEqual(lane_credential.source({"LANE_APP_PRIVATE_KEY": "k"}), "none")
        self.assertEqual(lane_credential.source({"LANE_APP_ID": "1", "LANE_APP_PRIVATE_KEY": "k"}), "github-app")
        self.assertEqual(lane_credential.source({"LANE_PAT": "p", "LANE_APP_ID": "1", "LANE_APP_PRIVATE_KEY": "k"}), "lane-pat")
        r = subprocess.run([sys.executable, str(ROOT / "scripts/lane_credential.py"), "token"], env={"PATH": os.environ["PATH"]}, capture_output=True, text=True)
        self.assertEqual(r.returncode, 1); self.assertEqual(r.stdout, ""); self.assertIn("no workflow-capable credential", r.stderr)
        r = subprocess.run([sys.executable, str(ROOT / "scripts/lane_credential.py"), "org-token"], env={"PATH": os.environ["PATH"]}, capture_output=True, text=True)
        self.assertEqual(r.returncode, 1, "org-token needs the App")
        self.assertEqual(lane_credential.PERMISSIONS, {"contents": "write", "pull_requests": "write", "workflows": "write"})
        self.assertEqual(lane_credential.ORG_PERMISSIONS, {"administration": "write", "contents": "write"})

    def test_us_33_r102_with_no_credential_the_workflow_pr_waits_open_and_labelled_and_the_run_stays_green(self):
        """US-33-R102"""
        prs = {"1": tlm.pr("aaa1111", files=(".github/workflows/lane.yml",))}
        r, calls = self.run_lane(prs, {"aaa1111": tlm.GREEN})
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(self.merges(calls), {})
        self.assertTrue(any(c["argv"][:3] == ["pr", "edit", "1"] and "needs-pat" in c["argv"] for c in calls))
        self.assertIn("#1 needs-pat: green on aaa1111, not merged", r.stdout)
        self.assertIn("lane: needs-pat merged=0 waiting=1 credential=none", r.stdout)

    def test_us_33_r102_a_conflicting_workflow_pr_is_left_to_the_sweeper_and_a_refused_merge_labels_it(self):
        """US-33-R102"""
        conflicting = {**tlm.pr("ddd4444", labels=("needs-pat",), files=(".github/workflows/lane.yml",)), "mergeable": "CONFLICTING"}
        r, calls = self.run_lane({"1": conflicting}, {"ddd4444": tlm.GREEN}, LANE_PAT=self.PAT)
        self.assertIn("#1 needs-pat conflict: left to the sweeper", r.stdout)
        self.assertEqual(self.merges(calls), {})
        self.assertFalse([c for c in calls if c["argv"][:2] == ["pr", "merge"]])
        # a credential that cannot write workflows: GitHub refuses naming the workflow permission, and the lane labels the pull request
        r, calls = self.run_lane({"2": tlm.pr("eee5555", files=(".github/workflows/lane.yml",))}, {"eee5555": tlm.GREEN}, LANE_PAT="a-token-without-workflow-scope")
        self.assertTrue(any(c["argv"][:3] == ["pr", "edit", "2"] and "needs-pat" in c["argv"] for c in calls))
        self.assertNotIn("a-token-without-workflow-scope", r.stdout + r.stderr, "a token is never printed")


if __name__ == "__main__":
    unittest.main()

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-SPEC-33, the Actions half of the server-side change lane and its watchers: the lane script, conflict resolution, the bounds on a pull request's
life, the sweeps of sessions and branches, post-merge dispatch, the checks run, the drain count and the repository guards. Every GitHub call is a
fake; every git repository is a scratch one. Each test names the requirement it proves."""
import datetime as dt, json, os, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path
from _repo import scratch  # removed when the test ends (the repo-cleanup guard bans a bare mkdtemp)
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "tests/foundation"))
from foundation import branchsweep, checksrun, collisions, conflicts, drainwatch, fleet, lanewatch, lifecycle, prbound, sessions, strays  # noqa: E402
import postmerge_dispatch as pmd  # noqa: E402
import regen_generated  # noqa: E402
import local_checks  # noqa: E402
import test_lane_merger as tlm  # noqa: E402

NOW = dt.datetime(2026, 11, 26, 12, 0, tzinfo=dt.timezone.utc)
iso = lambda minutes: (NOW - dt.timedelta(minutes=minutes)).strftime("%Y-%m-%dT%H:%M:%SZ")


def tmp(test):
    d = scratch()
    test.addCleanup(shutil.rmtree, d, True)
    return d


def sh(cwd, *a):
    return subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t", *a], cwd=cwd, check=True, capture_output=True, text=True).stdout


def write(d, rel, text):
    p = Path(d) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


@unittest.skipUnless(shutil.which("bash") and shutil.which("jq"), "the lane script needs bash and jq (both are on the Actions runner)")
class ActionsLane(unittest.TestCase):
    PAT = tlm.LaneMergesNeedsPat.PAT

    def run_lane(self, *a, **k):
        return tlm.LaneMergesNeedsPat.run_lane(self, *a, **k)

    def merges(self, calls):
        return {c["argv"][2]: c for c in calls if c["argv"][:2] == ["pr", "merge"]}

    def test_us_33_r05_the_actions_lane_is_a_second_route_that_merges_on_green_on_the_exact_head_and_never_around_a_hold_or_a_red_check(self):
        """US-33-R05"""
        prs = {"1": tlm.pr("aaa1111"), "2": tlm.pr("bbb2222", labels=("hold",)), "3": tlm.pr("ccc3333"), "4": tlm.pr("ddd4444"), "5": tlm.pr("eee5555", draft=True)}
        red = [{"name": "checks", "status": "completed", "conclusion": "failure"}]
        running = [{"name": "checks", "status": "in_progress", "conclusion": None}]
        r, calls = self.run_lane(prs, {"aaa1111": tlm.GREEN, "bbb2222": tlm.GREEN, "ccc3333": red, "ddd4444": running, "eee5555": tlm.GREEN})
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        m = self.merges(calls)
        self.assertEqual(sorted(m), ["1", "5"], "only the green pull requests are merged: a hold, a red check and a running check are not")
        a = m["1"]["argv"]
        self.assertEqual(a[a.index("--match-head-commit") + 1], "aaa1111"); self.assertIn("--squash", a); self.assertIn("--delete-branch", a)
        self.assertEqual(m["1"]["token"], "builtin", "the built-in token, minted by GitHub for the run, is the credential-free route")
        self.assertIn("#2 hold", r.stdout); self.assertIn("#3 ci-failed", r.stdout); self.assertIn("#4 pending", r.stdout)
        self.assertTrue(any(c["argv"][:3] == ["pr", "edit", "3"] and "ci-failed" in c["argv"] for c in calls), "a red pull request is labelled, so the bound can close it")
        self.assertTrue(any(c["argv"][:3] == ["pr", "ready", "5"] for c in calls), "a draft is marked ready first")
        r2, calls2 = self.run_lane(prs, {"aaa1111": tlm.GREEN, "bbb2222": tlm.GREEN, "ccc3333": red, "ddd4444": running, "eee5555": tlm.GREEN}, LANE_ONLY_PR="1")
        self.assertEqual(sorted(self.merges(calls2)), ["1"], "LANE_ONLY_PR restricts a pass to the pull request whose checks just finished")
        core = {"1": tlm.pr("aaa1111")}
        r3, calls3 = self.run_lane(core, {"aaa1111": [{"name": "ci", "status": "completed", "conclusion": "success"}]}, GITHUB_REPOSITORY="ultrastable/ultrastable")
        self.assertEqual(self.merges(calls3), {}); self.assertIn("waiting: the full checks suite has not passed on aaa1111", r3.stdout, "the core repository needs its full suite, not any green run")


class Resolve(unittest.TestCase):
    def merge_case(self, files):
        """files: {path: (base, pr side, main side)}; returns (script result, directory) after `git merge main` into the pr branch."""
        d = tmp(self)
        sh(d, "init", "-q", "-b", "main")
        for p, (b, _, _) in files.items():
            write(d, p, b)
        sh(d, "add", "."); sh(d, "commit", "-qm", "base"); sh(d, "checkout", "-qb", "pr")
        for p, (_, o, _) in files.items():
            write(d, p, o)
        sh(d, "commit", "-qam", "pr"); sh(d, "checkout", "-q", "main")
        for p, (_, _, t) in files.items():
            write(d, p, t)
        sh(d, "commit", "-qam", "main"); sh(d, "checkout", "-q", "pr"); sh(d, "branch", "-q", "origin/main", "main")
        subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t", "merge", "-q", "--no-edit", "main"], cwd=d, capture_output=True)
        r = subprocess.run([sys.executable, str(ROOT / "scripts/resolve_generated.py")], cwd=d, capture_output=True, text=True)
        return r, d

    def test_us_33_r24_generated_and_append_only_conflicts_resolve_by_rule_and_a_hand_written_one_stays_a_conflict(self):
        """US-33-R24"""
        ledger = lambda *ids: json.dumps({"rows": [{"id": i} for i in ids]}, indent=1) + "\n"
        r, d = self.merge_case({
            "doctrine/decision-ledger.json": (ledger("a"), ledger("a", "pr"), ledger("a", "main")),
            "ops/log.jsonl": ('{"n":0}\n', '{"n":0}\n{"n":"pr"}\n', '{"n":0}\n{"n":"main"}\n'),
            "README.md": ("v <!-- claim:n -->1<!-- /claim -->\n", "v <!-- claim:n -->3<!-- /claim -->\n", "v <!-- claim:n -->9<!-- /claim -->\n"),
            "foundation/x.py": ("a = 1\n", "a = 2\n", "a = 3\n")})
        self.assertEqual(r.returncode, 1, r.stdout + r.stderr)
        self.assertIn("still conflicting: ['foundation/x.py']", r.stdout, "only the hand-written file is left, and the exit status says so")
        ids = [x["id"] for x in json.loads((d / "doctrine/decision-ledger.json").read_text())["rows"]]
        self.assertEqual(ids, ["a", "main", "pr"], "the decision ledger is the union of rows by id, main's first")
        self.assertEqual({json.loads(l)["n"] for l in (d / "ops/log.jsonl").read_text().split("\n") if l}, {0, "pr", "main"}, "an append-only ledger keeps both sides")
        self.assertNotIn("<<<<<<<", (d / "ops/log.jsonl").read_text())
        self.assertEqual((d / "README.md").read_text(), "v <!-- claim:n -->9<!-- /claim -->\n", "a claim value is computed from code: main's value wins")
        self.assertIn("<<<<<<<", (d / "foundation/x.py").read_text(), "a real conflict in code is never forced")
        r2, d2 = self.merge_case({"site/claims-data.js": ("x = 1\n", "x = 2\n", "x = 3\n")})
        self.assertEqual(r2.returncode, 0, "a generated data file takes one side and is regenerated after the merge"); self.assertIn("resolved site/claims-data.js", r2.stdout)

    def test_us_33_r23_the_python_generator_list_and_the_worker_list_are_one_list(self):
        """US-33-R23"""
        self.assertEqual(sorted(regen_generated.OUTPUTS), sorted(set(regen_generated.OUTPUTS)), "no output is listed twice")
        js = (ROOT / "seed/worker/src/generated.js").read_text()
        import re
        listed = set(re.findall(r'"([^"]+)"', js[js.index("GENERATED = ["):]))
        self.assertTrue(listed <= set(regen_generated.OUTPUTS), "the Worker never reconciles a file no generator writes")
        self.assertEqual(listed, {p for p in regen_generated.OUTPUTS if not p.endswith("README.md") and p != "social/calendar.json"})

    def test_us_33_r88_generated_data_is_regenerated_by_a_bot_after_a_merge_in_a_fixed_order_and_a_failing_generator_fails_the_run(self):
        """US-33-R88"""
        cmds = [" ".join(c) for c, _ in regen_generated.GENERATORS]
        self.assertIn("python3 -m foundation claims --fix --apply", cmds); self.assertIn("python3 scripts/build_dashboard.py", cmds); self.assertIn("python3 -m foundation admit --apply", cmds)
        self.assertLess(cmds.index("python3 -m foundation claims --fix --apply"), cmds.index("python3 scripts/build_dashboard.py"))
        seen = []

        def fake(cmd, cwd=None, capture_output=None, text=None):
            seen.append(cmd)
            return mock.Mock(returncode=1 if cmd[-2:] == ["--fix", "--apply"] else 0, stderr="claims drift", stdout="")
        with mock.patch.object(regen_generated.subprocess, "run", fake):
            bad = regen_generated.run_all(ROOT)
        self.assertEqual(len(seen), len(regen_generated.GENERATORS), "every generator runs even after one failed")
        self.assertEqual(len(bad), 1); self.assertIn("claims drift", bad[0]); self.assertIn("foundation claims --fix --apply", bad[0])


class Conflicts(unittest.TestCase):
    def test_us_33_r25_a_conflict_the_lane_resolved_is_pushed_and_checked_and_one_it_cannot_is_closed_only_when_the_queue_can_redo_it(self):
        """US-33-R25"""
        self.assertEqual(conflicts.decide(True, False, True, False), "resolved"); self.assertEqual(conflicts.decide(False, True, True, True), "resolved")
        self.assertEqual(conflicts.decide(True, False, False, True), "requeued", "a clean merge that could not be pushed is not a resolution")
        self.assertEqual(conflicts.decide(False, False, False, True), "requeued"); self.assertEqual(conflicts.decide(False, False, False, False), "left", "a session's pull request keeps its work")
        self.assertTrue(conflicts.executor_authored("app/github-actions", "agent/Q-X-fix")); self.assertTrue(conflicts.executor_authored("github-actions[bot]", "agent/OL-PR-5"))
        self.assertFalse(conflicts.executor_authored("rowan", "agent/Q-X-fix"), "a person's pull request is never the queue's to redo"); self.assertFalse(conflicts.executor_authored("github-actions", "claude/q-x"), "a branch not named for a queue item cannot be reproduced")
        calls = []

        def sh_(argv, root, timeout=180):
            calls.append(argv)
            if argv[:3] == ["gh", "pr", "view"]:
                return 0, json.dumps({"headRefName": "agent/Q-1-x", "author": {"login": "github-actions"}, "isCrossRepository": False})
            if argv[:2] == ["git", "rev-parse"]:
                return 0, "start"
            if argv[0] == sys.executable:
                return 1, "still conflicting: ['foundation/x.py']"
            return (1, "CONFLICT") if "merge" in argv and "--no-edit" in argv else (0, "")
        row = conflicts.resolve(7, apply=True, sh=sh_)
        self.assertEqual(row["result"], "requeued"); close = next(c for c in calls if c[:3] == ["gh", "pr", "close"])
        self.assertIn("--delete-branch", close); self.assertIn("the executor redoes it from current main", " ".join(close))
        self.assertEqual(conflicts.resolve(7, apply=False, sh=sh_)["result"], "dry-run")
        fork = conflicts.resolve(7, apply=True, sh=lambda a, r, timeout=180: (0, json.dumps({"headRefName": "x", "author": {"login": "u"}, "isCrossRepository": True})))
        self.assertEqual((fork["result"], fork["detail"]), ("left", "head is in another repository"))


class Bounds(unittest.TestCase):
    PR = lambda self, n, created, *labels, updated=None: {"number": n, "createdAt": iso(created), "updatedAt": iso(updated if updated is not None else 1), "labels": [{"name": x} for x in labels]}

    def test_us_33_r55_a_pull_request_the_lane_labelled_conflict_or_ci_failed_is_closed_past_its_bound_with_its_branch_kept_and_a_held_one_is_never_closed(self):
        """US-33-R55"""
        self.assertEqual(prbound.CONF, {"conflict_min": 30, "failed_min": 60, "max_open_h": 2})
        now = NOW.timestamp()
        close, stale = prbound.read([self.PR(1, 31, "conflict"), self.PR(2, 29, "conflict"), self.PR(3, 61, "ci-failed"), self.PR(4, 59, "ci-failed"), self.PR(5, 500, "conflict", "hold"), self.PR(6, 130), self.PR(7, 119)], now)
        self.assertEqual([n for n, _ in close], [1, 3]); self.assertIn("merge conflict with main unresolved for 31 min", close[0][1]); self.assertIn("a failing check unrepaired for 61 min", close[1][1])
        self.assertEqual(stale, [(6, 2.2)], "the age is minutes since it opened: the lane's own labels and comments refresh updatedAt, so that clock never ran out; a held pull request is exempt")
        self.assertEqual(prbound.read([self.PR(8, 40, "conflict", updated=0)], now)[0][0][0], 8)
        d = tmp(self); ran = []
        real = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=31)).strftime("%Y-%m-%dT%H:%M:%SZ"); prs = [{"number": 1, "created_at": real, "updated_at": real, "labels": [{"name": "conflict"}]}]

        def gh_api(path, method="GET", fields=None):  # PR-NEVER-LOSE-1 (#2630): the list is read over REST through prsafe
            ran.append((method, path))
            return prs if path.startswith("repos/o/r/pulls?state=open") else {}

        def safe_close(repo, n, why, **kw):  # the close itself (live re-read, refresh, head pinned before close) is proven in test_prsafe
            ran.append(("safe_close", repo, n, why))
            return {"closed": True, "reason": why, "ref": f"refs/archive/pr-{n}-abcdef1", "sha": "abcdef1234"}
        old = os.getcwd(); os.chdir(d); self.addCleanup(os.chdir, old); (d / "ops").mkdir()
        with mock.patch.object(prbound.prsafe, "gh_api", gh_api), mock.patch.object(prbound.prsafe, "safe_close", safe_close), mock.patch.dict(os.environ, {"GITHUB_REPOSITORY": "o/r"}):
            self.assertEqual(prbound.main(["--apply"]), 0)
        closer = next(a for a in ran if a[0] == "safe_close"); self.assertEqual(closer[1:3], ("o/r", 1)); self.assertIn("merge conflict with main unresolved", closer[3])
        self.assertFalse(any(m == "DELETE" and "git/refs/heads" in p for m, p in (a for a in ran if len(a) == 2)), "the branch is kept")
        row = json.loads((d / "ops/prbound.jsonl").read_text()); self.assertEqual(row["pr"], 1); self.assertTrue(row["ref"].startswith("refs/archive/"))
        with mock.patch.object(prbound.prsafe, "gh_api", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("HTTP 502"))):
            self.assertEqual(prbound.main(["--check"]), 1, "an unreadable list is unmeasured, never passed")

    def test_us_33_r56_a_green_mergeable_pull_request_unmerged_after_three_minutes_is_a_finding_with_its_cause_and_a_remediation_merges_it_on_its_head(self):
        """US-33-R56"""
        self.assertEqual(lanewatch.LATENCY_MINUTES, 3)
        ok = [{"conclusion": "SUCCESS"}, {"state": "SKIPPED"}]
        pr = lambda n, **o: {"number": n, "isDraft": False, "mergeable": "MERGEABLE", "labels": [], "updatedAt": iso(10), "statusCheckRollup": ok, "headRefOid": "sha" + str(n), **o}
        prs = [pr(1), pr(2, labels=[{"name": "needs-pat"}]), pr(3, isDraft=True), pr(4, mergeable="CONFLICTING"), pr(5, statusCheckRollup=[{"conclusion": "FAILURE"}]), pr(6, statusCheckRollup=[]), pr(7, updatedAt=iso(1))]
        got = lanewatch.classify(prs, NOW)
        self.assertEqual([g["number"] for g in got], [1, 2], "a draft, a conflict, a red or empty rollup and a young pull request are not stuck")
        self.assertIn("the lane has not merged it", got[0]["cause"]); self.assertIn("credential gate", got[1]["cause"]); self.assertTrue(got[1]["needs_pat"]); self.assertEqual(got[0]["age_minutes"], 10)
        self.assertEqual(lanewatch.classify(prs, NOW, minutes=30), [], "the threshold is a parameter")
        ran = []

        def run(cmd, capture_output=None, text=None):
            ran.append(cmd)
            if cmd[:3] == ["gh", "pr", "list"]:
                return mock.Mock(returncode=0, stdout=json.dumps([dict(pr(1), updatedAt=iso(10)), dict(pr(2, labels=[{"name": "needs-pat"}]), updatedAt=iso(10))]), stderr="")
            return mock.Mock(returncode=0, stdout="", stderr="")
        with mock.patch.object(lanewatch.subprocess, "run", run), mock.patch.object(lanewatch, "datetime", wraps=dt.datetime) as D:
            D.now.return_value = NOW; D.fromisoformat = dt.datetime.fromisoformat
            self.assertEqual(lanewatch.main(["--remediate"]), 1, "the pull request that needs a workflow credential is still listed, so the run is red")
        merge = next(c for c in ran if c[:3] == ["gh", "pr", "merge"]); self.assertEqual(merge[3], "1"); self.assertEqual(merge[merge.index("--match-head-commit") + 1], "sha1")
        self.assertEqual(len([c for c in ran if c[:3] == ["gh", "pr", "merge"]]), 1)


class Sessions(unittest.TestCase):
    POL = {"idle_ttl_hours": 4, "ttl_floor_hours": 1, "backlog_owner": "operations"}

    def test_us_33_r57_every_agent_session_is_live_or_has_one_recorded_disposition_and_the_reaper_tunes_its_own_ttl_with_a_graded_prediction(self):
        """US-33-R57"""
        H, now = 3600, 1_000_000
        it = lambda name, age, ahead=1, pr=None, checks="unknown": {"name": name, "last_activity": now - age * H, "sha": "a" * 40, "ahead": ahead, "pr": pr, "draft": True, "checks": checks}
        r = sessions.classify([it("agent/a", 1), it("agent/b", 9, ahead=0), it("agent/c", 9, pr=5, checks="pass"), it("agent/d", 9, pr=6, checks="fail"), it("agent/e", 4)], now, self.POL)
        self.assertEqual(r["live"], ["agent/a", "agent/e"], "a session exactly at the limit is still live")
        self.assertEqual({z["name"]: z["action"] for z in r["zombies"]}, {"agent/b": "close-superseded", "agent/c": "lane-merge", "agent/d": "backlog"}); self.assertEqual(r["entered"], len(r["live"]) + len(r["zombies"]))
        b = sessions.backlog_item({**it("agent/d", 9), "age_hours": 9.0}, self.POL)
        for need in ("**Owner:** operations", "**Trigger:**", "Closing probe"):
            self.assertIn(need, b["body"])
        d = tmp(self); (d / "doctrine").mkdir(); (d / "ops").mkdir(); sessions._write_policy(d, dict(self.POL))
        scan = lambda z: (d / sessions.LEDGER).open("a").write(json.dumps({"at": 1, "entered": z, "live": 0, "zombies": z, "dispositions": [], "invariant": True}) + "\n")
        scan(1); self.assertIsNone(sessions.meta(d)["change"], "one scan with zombies is not persistence")
        scan(2); m = sessions.meta(d); self.assertEqual(m["change"]["to"], 2.0); self.assertIn("zombies == 0", m["change"]["prediction"])
        scan(3); m = sessions.meta(d); self.assertEqual((m["graded"]["grade"], m["ttl_hours"]), ("reverted", 4)); self.assertIn(2.0, sessions.policy(d)["blocked_values"])
        scan(1); scan(1); self.assertIsNone(sessions.meta(d)["change"], "a reverted value is never retried")
        d2 = tmp(self); (d2 / "doctrine").mkdir(); (d2 / "ops").mkdir(); sessions._write_policy(d2, dict(self.POL, idle_ttl_hours=1))
        for z in (1, 1):
            (d2 / sessions.LEDGER).open("a").write(json.dumps({"at": 1, "entered": z, "live": 0, "zombies": z, "dispositions": [], "invariant": True}) + "\n")
        self.assertIsNone(sessions.meta(d2)["change"], "the TTL never goes below its floor")
        self.assertEqual(sessions.check(ROOT), [])

    def test_us_33_r58_an_agent_lease_is_kept_alive_by_a_heartbeat_closed_with_one_of_four_dispositions_and_a_repeatedly_reaped_agent_files_one_incident(self):
        """US-33-R58"""
        self.assertEqual((lifecycle.TTL_MIN, lifecycle.DISPOSITIONS, lifecycle.REAPS_BEFORE_INCIDENT, lifecycle.WINDOW_DAYS), (45, ("done", "backlogged", "superseded", "reaped"), 3, 7))
        d = tmp(self); (d / "docs/issues").mkdir(parents=True); M = lambda n: NOW + dt.timedelta(minutes=n)
        a, b = lifecycle.open_session(d, "x", now=NOW), lifecycle.open_session(d, "y", now=NOW); lifecycle.beat(d, a, now=M(40))
        self.assertEqual(lifecycle.check(d, now=M(44)), [], "inside the TTL nothing is a zombie"); self.assertEqual(len(lifecycle.check(d, now=M(50))), 1); self.assertIn(b, lifecycle.check(d, now=M(50))[0])
        self.assertEqual(lifecycle.reap(d, now=M(50))["reaped"], [b]); self.assertEqual(lifecycle.state(d)[b]["closed"]["disposition"], "reaped"); self.assertEqual(lifecycle.check(d, now=M(50)), [])
        with self.assertRaises(ValueError):
            lifecycle.close_session(d, a, "gone")
        with self.assertRaises(ValueError):
            lifecycle.close_session(d, a, "backlogged", "OL-NOPE")
        write(d, "docs/issues/OL-REAL.json", "{}"); lifecycle.close_session(d, a, "backlogged", "OL-REAL", now=M(41)); self.assertEqual(lifecycle.state(d)[a]["closed"]["item"], "OL-REAL")
        for i in range(3):
            lifecycle.open_session(d, "flaky", now=M(60 + i))
        r = lifecycle.reap(d, now=M(200)); self.assertEqual(len(r["reaped"]), 3); self.assertEqual(r["incidents"], ["OL-ZOMBIE-flaky"])
        item = json.loads((d / "docs/issues/OL-ZOMBIE-flaky.json").read_text()); self.assertIn("**Owner:** operations", item["body"]); self.assertIn("**Done check:** cmd:python3 -m foundation lifecycle --check --agent flaky", item["body"])
        self.assertEqual(lifecycle.reaped_count(d, "flaky", M(200)), 3); self.assertEqual(lifecycle.reaped_count(d, "flaky", M(200 + 8 * 24 * 60)), 0, "only the last seven days count")
        self.assertEqual(len(lifecycle.check(d, agent="flaky", now=M(200))), 1)


class BranchSweep(unittest.TestCase):
    def repo(self, rejected=None):
        d = tmp(self); origin, w = d / "o.git", d / "w"
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(origin)], check=True)
        subprocess.run(["git", "clone", "-q", str(origin), str(w)], check=True, capture_output=True)
        write(w, "doctrine/branchsweep.json", json.dumps({"state_branches": ["evidence"], "state_prefixes": [], "gate": [], "min_idle_hours": 4, "port_owner": "operations", "rejected": rejected or {"bad": "closed on purpose"}}))
        write(w, "ops/x.jsonl", '{"n":1}\n'); write(w, "code.py", "x = 1\n")
        sh(w, "add", "-A"); sh(w, "commit", "-qm", "base"); sh(w, "push", "-q", "origin", "main")
        return w

    def branch(self, w, name, files, base="main", when=None):
        sh(w, "checkout", "-q", "-B", name, "origin/" + base)
        for rel, text in files.items():
            write(w, rel, text)
        sh(w, "add", "-A")
        env = {**os.environ, "GIT_COMMITTER_DATE": when, "GIT_AUTHOR_DATE": when} if when else None
        subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", name], cwd=w, check=True, capture_output=True, env=env)
        sh(w, "push", "-q", "origin", name); sh(w, "checkout", "-q", "main")

    def test_us_33_r59_every_remote_branch_gets_one_disposition_main_holds_its_work_or_one_item_carries_it_and_nothing_with_unmerged_work_is_deleted(self):
        """US-33-R59"""
        w = self.repo(); old = "2026-11-01T00:00:00"
        self.branch(w, "clean", {"new.py": "y = 2\n"}, when=old); self.branch(w, "gen", {"ops/x.jsonl": '{"n":1}\n{"n":2}\n'}, when=old); self.branch(w, "codeconf", {"code.py": "x = 2\n"}, when=old)
        self.branch(w, "bad", {"bad.py": "z = 1\n"}, when=old); self.branch(w, "evidence", {"e.txt": "e\n"}, when=old); self.branch(w, "fresh", {"f.py": "f = 1\n"})
        self.branch(w, "same", {"code.py": "x = 1\n", "same.txt": "s\n"}, when=old)
        sh(w, "checkout", "-q", "main"); write(w, "code.py", "x = 3\n"); write(w, "ops/x.jsonl", '{"n":1}\n{"n":3}\n'); write(w, "same.txt", "s\n"); sh(w, "add", "-A"); sh(w, "commit", "-qm", "adv"); sh(w, "push", "-q", "origin", "main"); sh(w, "fetch", "-q", "origin")
        got = {p["name"]: p["action"] for p in branchsweep.scan(w)}
        self.assertEqual(got, {"clean": "merge", "gen": "merge", "codeconf": "port", "bad": "rejected", "evidence": "state", "fresh": "live", "same": "superseded"}, "a rejected branch is never merged, a session's own state branch is left, a branch touched in the last hours belongs to a live session")
        one = branchsweep.plan_one(w, "origin/clean"); self.assertEqual((one["action"], one["conflicts"]), ("merge", []))
        sh(w, "checkout", "-q", "-B", "ancestor", "origin/main"); sh(w, "push", "-q", "origin", "ancestor"); self.assertEqual(branchsweep.plan_one(w, "origin/ancestor")["action"], "merged")
        sh(w, "checkout", "-q", "main"); sh(w, "checkout", "-q", "-B", "sq", "origin/main~1"); write(w, "same.txt", "s\n"); sh(w, "add", "-A")
        pol = branchsweep.policy(w); item = branchsweep.port_item({"name": "codeconf", "sha": "a" * 40, "why": "conflicts in code: code.py", "ahead": 1}, pol)
        self.assertEqual(item["id"], "PORT-BRANCH-codeconf"); self.assertIn("**Owner:** operations", item["body"]); self.assertIn("**Closing probe:** python3 -m foundation branchsweep --carried codeconf", item["body"])
        self.assertEqual(branchsweep.port_item({"name": "Feat/Big Thing!" + "x" * 80, "sha": "a" * 40, "why": "w"}, pol)["id"], "PORT-BRANCH-" + ("feat-big-thing-" + "x" * 80)[:48], "the slug is at most 48 characters")
        ok, why = branchsweep.carried(w, "clean"); self.assertFalse(ok, "main does not hold the branch's work yet: its item stays open"); self.assertIn("clean:", why)
        ok2, why2 = branchsweep.carried(w, "ancestor"); self.assertTrue(ok2)
        self.assertTrue(branchsweep.generated("ops/x.jsonl") and branchsweep.generated("doctrine/decision-ledger.json") and not branchsweep.generated("code.py"))
        sh(w, "checkout", "-q", "main"); self.assertEqual(branchsweep.archive(w, open_heads=None), [], "with the open pull requests unreadable nothing is archived: unmeasured is never empty")
        rows = branchsweep.archive(w, open_heads={"codeconf"}); self.assertNotIn("codeconf", {r["name"] for r in rows}, "a branch with an open pull request is never archived")
        port = {r["name"]: r for r in branchsweep.archive(w, open_heads=set(), dry=True)}; self.assertEqual(port["codeconf"]["action"], "would_archive"); self.assertEqual(port["codeconf"]["ref"], "refs/archive/codeconf")
        done = {r["name"]: r["action"] for r in branchsweep.archive(w, open_heads=set())}; self.assertEqual(done["codeconf"], "archived")
        heads = sh(w, "ls-remote", "origin").split(); self.assertIn("refs/archive/codeconf", heads); self.assertNotIn("refs/heads/codeconf", heads, "the head moves off the branch list only after the archive ref was read back")


class PostMerge(unittest.TestCase):
    def test_us_33_r86_a_merge_that_fires_no_push_workflow_dispatches_every_push_workflow_its_files_match_once(self):
        """US-33-R86"""
        self.assertTrue(pmd.matches(["site/a.js"], ["site/**"])); self.assertFalse(pmd.matches(["site/a/b.js"], ["site/*"]), "* does not cross a directory"); self.assertTrue(pmd.matches(["site/a/b.js"], ["**"]))
        self.assertFalse(pmd.matches(["site/x.md"], ["site/**", "!site/*.md"]), "a negated pattern excludes"); self.assertTrue(pmd.matches(["a.py"], ["?.py"]))
        trig = {"deploy-site.yml": ["site/**"], "seed-launch.yml": ["seed/**", "foundation/**"], "all.yml": ["**"]}
        merged = [{"number": 1, "merged_at": "2026-11-26T10:00:00Z", "files": ["site/a.js"]}, {"number": 2, "merged_at": "2026-11-26T11:00:00Z", "files": ["site/b.js", "seed/x.js"]}]
        ran = {("deploy-site.yml", "2026-11-26T10:00:00Z"): 0, ("all.yml", "2026-11-26T10:00:00Z"): 1}
        todo = pmd.plan(merged, trig, lambda wf, at: ran.get((wf, at), 0))
        self.assertEqual(todo, [(1, "deploy-site.yml"), (2, "seed-launch.yml"), (2, "all.yml")], "a workflow with no run since a merge that matches it is dispatched once; deploy-site is not asked again for the second merge, and all.yml ran after the first merge but not the second")
        self.assertEqual(pmd.plan([], trig, lambda *a: 0), [])
        t = pmd.triggers(ROOT); self.assertTrue(t and all(isinstance(v, list) and v for v in t.values()), "the map is read from the workflows' own triggers, so it cannot drift")


class Checks(unittest.TestCase):
    def test_us_33_r87_the_checks_workflow_runs_without_actions_steps_that_cannot_run_are_skipped_with_their_reason_and_never_counted_as_passed_or_failed(self):
        """US-33-R87"""
        self.assertEqual(checksrun.unrunnable("echo ${{ needs.a.result }}", {}), "reads the results of other Actions jobs")
        with mock.patch.dict(os.environ):
            os.environ.pop("GITHUB_REPOSITORY", None)
            self.assertEqual(checksrun.unrunnable("gh pr list -R $GITHUB_REPOSITORY", {}), "needs GITHUB_REPOSITORY, which only Actions sets")
        self.assertEqual(checksrun.unrunnable("gh pr list -R $GITHUB_REPOSITORY", {"GITHUB_REPOSITORY": "o/r"}), ""); self.assertEqual(checksrun.unrunnable("python3 -m unittest", {}), "")
        d = tmp(self)
        write(d, ".github/workflows/checks.yml", "jobs:\n  a:\n    env: {K: v}\n    steps:\n      - name: ok\n        run: echo ok\n      - name: bad\n        run: exit 3\n      - name: gate\n        run: echo ${{ needs.a.result }}\n")
        out = checksrun.run(d, runner=lambda sc, cwd, env: mock.Mock(returncode=3 if "exit 3" in sc else 0, stdout="boom" if "exit 3" in sc else "", stderr=""))
        self.assertEqual((out["steps"], out["failed"], out["skipped"]), (3, ["bad"], ["gate"]))
        self.assertEqual([r["ok"] for r in out["results"]], [True, False, None], "a skipped step is neither a pass nor a failure")
        self.assertEqual(out["results"][2]["skipped"], "reads the results of other Actions jobs"); self.assertIn("boom", out["results"][1]["tail"])
        self.assertEqual(checksrun.steps(d)[0]["env"], {"K": "v"}, "the job env reaches every step")
        self.assertEqual(local_checks.expr("base=${{ github.base_ref || 'main' }} x=${{ other }}"), "base=main x=", "outside Actions a context value is empty and an expression with a literal fallback takes it")
        self.assertEqual(checksrun.main(["--help"]), 0); self.assertNotEqual(checksrun.main(["--bogus"]), 0, "an unknown argument is refused, so --help can never start a half-hour run")


class Drain(unittest.TestCase):
    def test_us_33_r90_the_fleet_is_drained_only_when_every_repository_was_read_and_has_no_open_issue_and_no_open_pull_request(self):
        """US-33-R90"""
        issue, pr = {"number": 1}, {"number": 2, "pull_request": {}}
        s = drainwatch.summarize({"a": {"issues": [issue, pr], "pulls": [{"number": 2}]}, "b": {"issues": [], "pulls": []}})
        self.assertEqual(s["repos"]["a"], {"open_issues": 1, "open_prs": 1}, "a pull request listed as an issue is a pull request, counted once"); self.assertEqual(s["fleet"], {"open_issues": 1, "open_prs": 1}); self.assertFalse(s["drained"])
        z = drainwatch.summarize({"a": {"issues": [], "pulls": []}}); self.assertTrue(z["drained"]); self.assertEqual(z["unmeasured"], [])
        u = drainwatch.summarize({"a": {"issues": [], "pulls": []}, "b": {"issues": None, "pulls": []}, "c": {"issues": [], "pulls": None}})
        self.assertEqual(u["unmeasured"], ["b", "c"]); self.assertNotIn("b", u["repos"]); self.assertFalse(u["drained"], "an unreadable repository is unmeasured, never zero"); self.assertEqual(u["fleet"], {"open_issues": 0, "open_prs": 0})

    def test_us_33_r91_one_queue_and_one_merge_gate_span_the_fleet_and_the_gate_is_the_same_as_the_workers(self):
        """US-33-R91"""
        cfg = {"org": "o", "repos": ["a", "b"], "merge": {"skip_labels": ["hold", "blocked", "wip"]}}
        issues = {"a": [{"number": 5, "labels": [{"name": "p2"}]}, {"number": 9, "pull_request": {}}], "b": [{"number": 1, "labels": [{"name": "p0"}]}]}
        api = lambda m, p: (200, issues[p.split("/")[3]])
        q = fleet.queue(cfg, api, root=tmp(self)); self.assertEqual([(i["repo"], i["number"]) for i in q], [("b", 1), ("a", 5)], "one queue, driver order across repositories, pull requests excluded")
        ok = [{"name": "ci", "status": "completed", "conclusion": "success"}]
        self.assertIsNone(fleet.not_green("o", "abc", ok)); self.assertEqual(fleet.not_green("o", "abc", None), "check-runs unreadable")
        self.assertEqual(fleet.not_green("o", "abc", ok + [{"name": "x", "status": "queued"}]), "x still running"); self.assertEqual(fleet.not_green("o", "abc", ok + [{"name": "x", "status": "completed", "conclusion": "failure"}]), "x failure")
        self.assertEqual(fleet.not_green("ultrastable", "abcdef1234", ok), "checks has not passed on abcdef1"); self.assertIsNone(fleet.not_green("ultrastable", "abc", ok + [{"name": "checks", "status": "completed", "conclusion": "success"}]))
        self.assertEqual(fleet.not_green("o", "a", [{"name": "lane", "status": "in_progress"}]), None, "the lane's own run never blocks it")
        pr = lambda **k: {"draft": False, "labels": [], "head": {"sha": "s"}, **k}
        self.assertEqual(fleet.mergeable(cfg, pr(), ok, "o"), (True, "green")); self.assertEqual(fleet.mergeable(cfg, pr(draft=True), ok, "o"), (False, "draft"))
        self.assertEqual(fleet.mergeable(cfg, pr(labels=[{"name": "HOLD"}]), ok, "o"), (False, "held by label")); self.assertEqual(fleet.mergeable(cfg, pr(), None, "o"), (False, "check-runs unreadable"))


class Guards(unittest.TestCase):
    def test_us_33_r96_a_code_file_outside_the_roots_the_repository_runs_and_a_workflow_nothing_runs_are_strays_the_sweep_and_the_checks_both_refuse(self):
        """US-33-R96"""
        pol = {"code_roots": ["foundation", "seed", ".github", "workers"], "extensions": [".py", ".js", ".yml"], "baseline": ["old/legacy.py"], "workflow_template_dirs": ["workers/adapters/github/workflows"], "standard_root_files": [{"path": "catalog-info.yaml"}]}
        got = {f["path"]: f["kind"] for f in strays.classify(["foundation/a.py", "seed/b.js", "stray.py", "newdir/c.js", "old/legacy.py", "catalog-info.yaml", "README.md", "docs/guide.md", ".github/workflows/ci.yml", "github/workflows/ci.yml", "workers/adapters/github/workflows/t.yml", "a.yml"], pol)}
        self.assertEqual(got, {"stray.py": "stray-root", "newdir/c.js": "stray-dir", "github/workflows/ci.yml": "decoy-workflow", "a.yml": "stray-root"})
        self.assertEqual(strays.check(ROOT), [], "the repository itself has no stray")

    def test_us_33_r97_a_second_session_building_what_an_older_pull_request_adds_is_refused_by_its_migration_number_file_route_or_subcommand(self):
        """US-33-R97"""
        mine = collisions.added([{"filename": "seed/worker/migrations/0040_a.sql", "status": "added", "patch": ""}, {"filename": "seed/worker/src/x.js", "status": "added", "patch": "+if (url.pathname === '/api/graph/new') return 1;"},
                                 {"filename": "foundation/__main__.py", "status": "modified", "patch": '+    if _av[:1] == ["newcmd"]: return 0'}])
        self.assertEqual(mine["migrations"], {"seed/worker/migrations#0040"}); self.assertEqual(mine["routes"], {"/api/graph/new"}); self.assertEqual(mine["subcommands"], {"newcmd"}); self.assertIn("seed/worker/src/x.js", mine["new_files"])
        theirs = collisions.added([{"filename": "seed/worker/migrations/0040_other.sql", "status": "added", "patch": ""}, {"filename": "foundation/__main__.py", "status": "modified", "patch": '+    if _av[:1] == ["newcmd"]: return 1'}])
        self.assertEqual(collisions.clashes(mine, theirs), ["migration number seed/worker/migrations#0040", "foundation subcommand newcmd"])
        self.assertEqual(collisions.clashes(mine, collisions.added([])), []); self.assertEqual(collisions.check(ROOT), [], "no numbered migration directory holds two files with one number beyond the shrink-only baseline")


if __name__ == "__main__":
    unittest.main()

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-SPEC-33, the producing half of the Actions side of the change lane: the executor and its guards, the code-agent registry and ladder, the caps on the
agent, the self-code loop, the mechanical fixes, the CI watch and the queue-to-issue mirror. Every model, GitHub and git call is a fake or a scratch
repository. Each test names the requirement it proves."""
import datetime as dt, json, os, shutil, subprocess, sys, tempfile, unittest, urllib.error
from pathlib import Path
from _repo import scratch  # removed when the test ends (the repo-cleanup guard bans a bare mkdtemp)
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tools"))
from foundation import agent_ladder as L, agents, agentwork, ciwatch, crossrepo, evals, executor, ghmirror, issueloop, ladderwatch, mechfix, mergeaudit, redmain, selfcode  # noqa: E402

NOW = dt.datetime(2026, 11, 26, 12, 0, tzinfo=dt.timezone.utc)
CF = {"CLOUDFLARE_API_TOKEN": "t", "CLOUDFLARE_ACCOUNT_ID": "a"}
ALL = {**CF, "GITHUB_TOKEN": "g", "ANTHROPIC_API_KEY": "k"}


def tmp(test):
    d = scratch()
    test.addCleanup(shutil.rmtree, d, True)
    return d


def write(d, rel, text):
    p = Path(d) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text if isinstance(text, str) else json.dumps(text), encoding="utf-8")


def git(cwd, *a):
    return subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t", *a], cwd=cwd, check=True, capture_output=True, text=True).stdout


I = lambda n, labels=(), **k: {"number": n, "title": f"t{n}", "labels": [{"name": l} for l in labels], "updated_at": "2026-11-26T00:00:00Z", **k}


class Pick(unittest.TestCase):
    def test_us_33_r60_the_executor_takes_effect_items_first_then_the_p_label_then_the_oldest_and_skips_what_is_held_failed_or_freshly_claimed(self):
        """US-33-R60"""
        self.assertEqual(executor.effect_tier(I("Q-CIFAIL-x")), 0); self.assertEqual(executor.effect_tier(I("BREACH-m")), 0); self.assertEqual(executor.effect_tier(I("Q-SELF-bare-except-a")), 0)
        self.assertEqual(executor.effect_tier(I(5, ["bug"])), 0); self.assertEqual(executor.effect_tier(I(5, ["raises-self"])), 0); self.assertEqual(executor.effect_tier(I("Q-CLAIM-COVER-1")), 0.5, "a coverage item is often a wording change: after items that change code")
        self.assertEqual(executor.effect_tier(I("Q-GROW-1")), 1)
        self.assertEqual(executor.priority(I(7, ["p2", "p1"])), (1, 1, 7)); self.assertEqual(executor.priority(I(7)), (1, 5, 7)); self.assertEqual(executor.priority(I("Q-CIFAIL-a", ["p3"]))[:2], (0, 3)); self.assertEqual(executor.priority(I(7, ["p9"])), (1, 5, 7), "a label can only raise an item above the default of p5")
        self.assertEqual(executor.priority({**I(7), "score": 3})[:3], (1, 0, -3), "the ranker's score replaces label-then-age order inside a tier")
        order = [I(1, ["p0"]), I("Q-CIFAIL-z", ["p9"]), I(3, ["p1"]), I(4)]
        self.assertEqual(executor.pick(order)["number"], "Q-CIFAIL-z", "executable effect beats a p0 label"); self.assertEqual(executor.pick([order[0], order[2], order[3]])["number"], 1)
        for skip in sorted(executor.SKIP_LABELS - {"in-progress"}):
            self.assertIsNone(executor.pick([I(1, [skip])]), skip)
        self.assertIsNone(executor.pick([{**I(1, ["p0"]), "pull_request": {}}]))
        self.assertIsNone(executor.pick([I(1, ["in-progress"])], dt.datetime(2026, 11, 26, 1, 0, tzinfo=dt.timezone.utc)), "a claim under two hours old holds the item"); self.assertEqual(executor.pick([I(1, ["in-progress"])], dt.datetime(2026, 11, 26, 3, 0, tzinfo=dt.timezone.utc))["number"], 1, "a stale claim is retaken")
        foreign = {"number": "Q-CIFAIL-other-deploy", "title": "Q-CIFAIL-other-deploy: deploy is failing in ultrastable/other"}
        self.assertTrue(executor.foreign_cifail(foreign, "ultrastable/ultrastable")); self.assertFalse(executor.foreign_cifail({**foreign, "title": "x is failing in ultrastable/ultrastable"}, "ultrastable/ultrastable")); self.assertFalse(executor.foreign_cifail({**foreign, "number": 4}, "ultrastable/ultrastable"))

    def test_us_33_r61_the_executor_never_writes_a_workflow_the_policy_git_a_secret_or_its_own_log_and_a_change_is_bounded(self):
        """US-33-R61"""
        for bad in ("/etc/x", "../x", "a/../b", "a\\b", ".github/workflows/a.yml", "autonomy/policy.json", ".git/config", "ops/executor-log.jsonl", "a/.env", "x/id_rsa", "y/credentials", ""):
            self.assertIsNotNone(executor.safe_path(bad), bad)
        for good in ("docs/a.md", "foundation/x.py", "ops/deploys.jsonl", "github/org-settings.json"):
            self.assertIsNone(executor.safe_path(good), good)
        self.assertEqual((executor.MAX_FILES, executor.MAX_BYTES), (8, 200_000))
        d = tmp(self)
        with self.assertRaises(ValueError):
            executor.apply_edits([{"path": f"a{i}.txt", "content": "x"} for i in range(9)], d)
        with self.assertRaises(ValueError):
            executor.apply_edits([{"path": "ok.txt", "content": "x"}, {"path": ".github/x.yml", "content": "x"}], d)
        self.assertFalse((d / "ok.txt").exists(), "nothing is written when any path is refused")
        with self.assertRaises(ValueError):
            executor.apply_edits([{"path": "a.txt", "content": "x" * 200_001}], d)

    def test_us_33_r62_a_change_that_touches_no_running_code_gutters_a_file_leaves_an_elision_marker_or_touches_only_bookkeeping_is_a_failed_attempt_not_a_pull_request(self):
        """US-33-R62"""
        self.assertIsNone(executor.consumer_gap(["foundation/x.py"], ROOT), "a code file passes")
        gap = executor.consumer_gap(["docs/issues/Q-1.json", "ops/x.jsonl"], ROOT); self.assertIn("it writes only queue or ops files", gap); self.assertIn("(CLOSED-LOOP-1)", gap)
        self.assertIn("docs/guide-nothing-reads.md", executor.consumer_gap(["docs/guide-nothing-reads.md"], ROOT)); self.assertIsNone(executor.consumer_gap(["doctrine/code-agents.json"], ROOT), "a data file code names is consumed")
        self.assertIsNone(executor.saydo_gap(["foundation/x.py", "docs/issues/Q-1.json"])); gap = executor.saydo_gap(["docs/issues/Q-1.json", "ops/a.jsonl", "doctrine/writeback/w.json"]); self.assertTrue(gap.startswith("SAY-DO-1: the change touches only "))
        self.assertIsNone(executor.saydo_gap([]))
        d = tmp(self); git(d, "init", "-q", "-b", "main"); write(d, "seed/a.js", "".join(f"line {i}\n" for i in range(60))); write(d, "seed/b.js", "x\n"); git(d, "add", "."); git(d, "commit", "-qm", "base")
        self.assertIsNone(executor.elision_gap(["seed/a.js"], d)); write(d, "seed/a.js", "".join(f"line {i}\n" for i in range(20)))
        self.assertIn("would shrink from 60 to 20 lines (ELISION-1)", executor.elision_gap(["seed/a.js"], d)); write(d, "seed/a.js", "x\n// ... existing code ...\n".replace("//", "//"))
        self.assertIn("contains an elision marker in place of code (ELISION-1)", executor.elision_gap(["seed/a.js"], d)); write(d, "seed/b.js", "short\n"); self.assertIsNone(executor.elision_gap(["seed/b.js"], d), "a small file may shrink")


class Run(unittest.TestCase):
    def test_us_33_r66_one_executor_run_claims_one_item_gives_the_model_three_attempts_each_told_what_the_last_one_broke_and_ends_in_a_pull_request_or_a_labelled_failure_with_a_log_row(self):
        """US-33-R66"""
        self.assertEqual((executor.REPAIRS, executor.PR_REPAIR_TRIES, executor.MAX_TARGETED, executor.REPAIR_MIN_S), (2, 2, 12, 150))
        self.assertTrue(issubclass(executor.Stall, BaseException) and not issubclass(executor.Stall, Exception), "the watchdog's signal is not swallowed by the run's own except")
        src = (ROOT / "foundation/executor.py").read_text(); self.assertIn('os.environ.get("EXECUTOR_WATCHDOG_S", "600")', src)
        d = tmp(self); env = {"EXECUTOR_SOURCE": "issues"}
        with mock.patch.object(executor, "gh_json", return_value=[]), mock.patch.dict(os.environ, env, clear=True):
            row = executor.run("o/r", apply=True, root=d, model_call=lambda p: {}); self.assertEqual((row["result"], row["prediction"]), ("idle", "open_issues_takeable <= 0 within 24 h"))
        with mock.patch.object(executor, "gh_json", return_value=[I(7)]), mock.patch.dict(os.environ, env, clear=True):
            dry = executor.run("o/r", apply=False, root=d, model_call=lambda p: {}); self.assertEqual((dry["result"], dry["prediction"]), ("dry-run", "issue_7_closed = 1 within 24 h"))
            none = executor.run("o/r", apply=True, root=d); self.assertEqual(none["result"], "no-model-credential", "a missing credential is recorded, never hidden")
        prompts, calls = [], []

        def model(p):
            prompts.append(p)
            return {"summary": "s", "files": [{"path": "foundation/new_thing.py", "content": "def f():\n    return 1\n"}]}

        def sh(argv, root=None, timeout=0):
            calls.append(argv)
            return (1, "FAIL: test_x (m.C.test_x)\nboom") if argv == ["bad-check"] else ((0, "foundation/a.py") if argv[:2] == ["git", "ls-files"] else (0, ""))
        with mock.patch.object(executor, "gh_json", return_value=[I(7)]), mock.patch.object(executor, "sh", sh), mock.patch.object(executor, "time_left", lambda: 9999), mock.patch.dict(os.environ, env, clear=True):
            row = executor.run("o/r", apply=True, root=d, model_call=model, checks=[["bad-check"]])
        self.assertEqual(row["result"], "failed"); self.assertEqual(len(prompts), 3, "the first try and two repairs"); self.assertEqual(len(row["attempts"]), 3)
        self.assertNotIn("YOUR PREVIOUS ATTEMPT FAILED", prompts[0]); self.assertIn("YOUR PREVIOUS ATTEMPT FAILED THESE CHECKS", prompts[1]); self.assertIn("FAILING TESTS: m.C.test_x", prompts[2])
        self.assertIn("checks failed after 3 attempts", row["detail"])
        self.assertTrue(any(c[:3] == ["gh", "issue", "edit"] and "executor-failed" in c for c in calls), "the failure is labelled and commented, never swallowed"); self.assertTrue(any(c[:3] == ["gh", "issue", "comment"] for c in calls))
        logged = [json.loads(l) for l in (d / executor.LOG).read_text().splitlines()]; self.assertEqual(logged[-1]["result"], "failed"); self.assertEqual(logged[-1]["issue"], 7)
        prompts.clear()
        with mock.patch.object(executor, "gh_json", return_value=[I(7)]), mock.patch.object(executor, "sh", sh), mock.patch.object(executor, "time_left", lambda: 100), mock.patch.dict(os.environ, env, clear=True):
            row = executor.run("o/r", apply=True, root=d, model_call=model, checks=[["bad-check"]])
        self.assertEqual(len(prompts), 1); self.assertIn("out_of_time", row, "with too little time left for an attempt the run ends with its real reasons")
        with mock.patch.object(executor, "gh_json", return_value={"state": "MERGED", "headRefName": "agent/x"}):
            self.assertIsNone(executor.pr_repair({"number": "OL-PR-9"}, "o/r", d), "a merged pull request is not repaired"); self.assertIsNone(executor.pr_repair({"number": "Q-1"}, "o/r", d), "only an OL-PR item names a pull request")


class Registry(unittest.TestCase):
    def setUp(self):
        L.DOWN.clear(); self.addCleanup(L.DOWN.clear)

    def test_us_33_r67_authors_are_tried_cheapest_known_price_first_a_reviewer_is_of_another_family_and_can_veto_and_every_call_is_costed(self):
        """US-33-R67"""
        ids = [a["id"] for a in agents.route_authors(ALL, ROOT)]
        self.assertEqual(ids[:2], ["github-models-gpt", "github-models-llama"], "the free rungs on the built-in token come first"); self.assertLess(ids.index("workers-ai-glm"), ids.index("workers-ai-llama"))
        self.assertNotIn("claude-session", ids, "the session route is not an HTTP route"); self.assertNotIn("anthropic-api-fable", ids, "a reviewer-only adapter does not author")
        self.assertTrue(all(i in ("anthropic-api", "workers-ai-qwen-coder") for i in ids[-2:]), "unknown prices rank after known ones")
        self.assertEqual(agents.route_authors({}, ROOT), []); self.assertEqual([a["id"] for a in agents.route_authors({"ANTHROPIC_API_KEY": "k"}, ROOT)], ["anthropic-api"], "an adapter whose secrets are unbound on this host is not routed")
        for fam in ("llama", "glm", "openai"):
            rv = agents.ensemble(fam, ALL, ROOT); fams = [a["family"] for a in rv]
            self.assertNotIn(fam, fams); self.assertEqual(len(fams), len(set(fams))); self.assertLessEqual(len(rv), 3); self.assertTrue(all("reviewer" in a["roles"] for a in rv))
        self.assertTrue(agents.needs_ensemble(["workers/core/router/index.js"])); self.assertTrue(agents.needs_ensemble(["a/migrations/0001.sql"])); self.assertFalse(agents.needs_ensemble(["docs/x.md"]))
        d = tmp(self); seen = []
        def send(a, prompt, env):
            seen.append(a["id"]); return '{"files": []}', {"in": 1000000, "out": 0}
        n = len(L.rungs(d, CF))
        for att in (0, 1, 99):
            L.call("p", att, root=d, env=CF, send=send)
        rungs = [a["id"] for a in L.rungs(d, CF)]; self.assertEqual(seen, [rungs[0], rungs[1], rungs[n - 1]], "attempt N uses author N in routed order, clamped to the last")
        rows = [json.loads(l) for l in (d / L.COST).read_text().splitlines()]; self.assertEqual(len(rows), 3); self.assertTrue(all(r["ok"] and r["role"] == "author" for r in rows)); self.assertAlmostEqual(rows[0]["usd"], 0.0605, places=4); self.assertTrue(rows[0]["priced"])
        L.DOWN.clear(); calls = []
        def dead(a, p, e):
            calls.append(a["id"]); raise RuntimeError("non-JSON response (HTTP 200, text/plain)")
        with self.assertRaises(RuntimeError) as cm:
            L.call("p", 0, root=d, env=CF, send=dead)
        self.assertIn("every code agent rung failed", str(cm.exception)); self.assertIn(rungs[0], L.DOWN, "a rung whose transport failed is down for the rest of the run")
        L.DOWN.clear(); verdict = lambda ok: (lambda a, p, e: (json.dumps({"approve": ok, "reasons": ["breaks x"]}), {}))
        rv = L.review({"title": "t"}, {"summary": "s", "files": [{"path": "a.py", "content": "x"}]}, "glm", root=d, env=CF, send=verdict(False))
        self.assertFalse(rv["approve"]); self.assertEqual(rv["reasons"], ["breaks x"]); self.assertNotEqual(rv["family"], "glm")
        rv = L.review({"title": "t"}, {"files": []}, "glm", root=d, env={"CLOUDFLARE_API_TOKEN": "t"}, send=verdict(False)); self.assertTrue(rv["approve"]); self.assertIn("no reviewer of another family", rv["skipped"])
        def boom(a, p, e):
            raise OSError("down")
        rv = L.review({"title": "t"}, {"files": []}, "glm", root=d, env=CF, send=boom); self.assertTrue(rv["approve"], "a reviewer that cannot answer never blocks the loop"); self.assertIn("skipped", rv)

    def test_us_33_r68_a_model_the_provider_retired_keeps_its_rung_the_call_moves_to_the_catalogs_successor_and_the_retirement_is_recorded_for_a_credential_free_rewrite(self):
        """US-33-R68"""
        d = tmp(self); write(d, "doctrine/models.json", {"available": ["@cf/zai-org/glm-5.0-flash", "@cf/meta/llama-x", "@cf/zai-org/glm-4.7-flash"], "retired": {}, "refused": {}, "fallback_order": ["@cf/meta/llama-x"]})
        a = {"id": "workers-ai-glm", "model": "@cf/zai-org/glm-4.7-flash", "route": "workers-ai"}
        alt = agents.heal(a, d); self.assertEqual((alt["model"], alt["id"]), ("@cf/zai-org/glm-5.0-flash", "workers-ai-glm@glm-5.0-flash"), "the same vendor first")
        row = json.loads((d / "ops/models-observed.jsonl").read_text().splitlines()[0]); self.assertEqual((row["model"], row["status"], row["successor"], row["adapter"]), ("@cf/zai-org/glm-4.7-flash", 410, "@cf/zai-org/glm-5.0-flash", "workers-ai-glm"))
        write(d, "doctrine/models.json", {"available": ["@cf/zai-org/glm-4.7-flash"], "retired": {}, "refused": {}, "fallback_order": []}); self.assertIsNone(agents.heal(a, d), "a catalog with no other model has no successor")
        self.assertIsNone(agents.heal(a, tmp(self)), "no catalog: nothing to heal with")
        write(d, "doctrine/models.json", {"available": ["@cf/zai-org/glm-5.0-flash", "@cf/zai-org/glm-4.7-flash"], "retired": {"@cf/zai-org/glm-4.7-flash": {"successor": "@cf/zai-org/glm-9"}}, "refused": {}, "fallback_order": []}); self.assertEqual(agents.heal(a, d)["model"], "@cf/zai-org/glm-9", "a named successor wins")
        seen = []

        def transport(url, headers, body, timeout=300):
            seen.append(url)
            if "glm-4.7" in url:
                raise urllib.error.HTTPError(url, 410, "gone", {}, None)
            return {"result": {"response": '{"summary":"healed","files":[]}'}}
        out, who = agents.complete("p", CF, transport, d); self.assertEqual(out["summary"], "healed"); self.assertTrue(who.startswith("workers-ai-glm@")); self.assertIn("glm-4.7", seen[0])


class Reply(unittest.TestCase):
    def test_us_33_r69_a_reply_is_json_or_file_and_edit_blocks_an_edit_places_exactly_or_loosely_never_ambiguously_and_the_golden_set_must_pass_in_full(self):
        """US-33-R69"""
        self.assertEqual(agents.parse_json('x {"summary":"s","files":[{"path":"a","content":"c"}]} y')["files"][0]["path"], "a")
        out = agents.parse_json("SUMMARY: fix it\n<<<EDIT a/b.py>>>\n<<<FIND>>>\nold\n<<<REPLACE>>>\nnew\n<<<END>>>\n<<<FILE c.txt>>>\nhello\n<<<END>>>")
        self.assertEqual(out["summary"], "fix it"); self.assertEqual(out["files"], [{"path": "c.txt", "content": "hello\n"}, {"path": "a/b.py", "edits": [{"find": "old", "replace": "new"}]}])
        with self.assertRaises(ValueError):
            agents.parse_json("only prose")
        self.assertEqual(agents.apply_edit("a\nb\nc\n", "b", "B"), "a\nB\nc\n")
        self.assertEqual(agents.apply_edit("  if x:\n      y()\n", "if x:\n    y()", "if z:\n    w()"), "  if z:\n      w()\n", "a model that drops the indentation is placed and re-indented")
        with self.assertRaises(ValueError) as c1:
            agents.apply_edit("a\na\n", "a", "b", "f.py")
        self.assertIn("f.py", str(c1.exception))
        with self.assertRaises(ValueError):
            agents.apply_edit("a\n", "zzz", "b", "f.py")
        r = evals.run(); self.assertGreaterEqual(r["cases"], 1); self.assertEqual((r["pass_rate"], r["failed"]), (1.0, [])); self.assertEqual(evals.FLOOR, 1.0); self.assertEqual(evals.main([]), 0)
        py = (ROOT / "seed/worker/src/codeagent.js").read_text(); self.assertIn("mirrors foundation/agents.py", py, "the Worker's reply format is the twin of this one")


class Caps(unittest.TestCase):
    def cfg_root(self, **cfg):
        d = tmp(self); base = json.loads((ROOT / "doctrine/agent-budget.json").read_text()); write(d, "doctrine/agent-budget.json", {**base, **cfg}); return d

    def test_us_33_r70_the_actions_hosted_agent_runs_only_inside_its_kill_switches_and_caps_and_an_unreadable_cap_input_stops_it(self):
        """US-33-R70"""
        cfg = json.loads((ROOT / "doctrine/agent-budget.json").read_text()); self.assertEqual((cfg["max_open_agent_prs"], cfg["max_runs_per_day"], cfg["max_usd_per_day"]), (6, 48, 1.0))
        d = self.cfg_root(); ok = lambda *a: (0, "2\n")
        self.assertEqual(agentwork.gate(d, env={}, gh=ok, now=NOW, repo="o/r"), {"go": True, "why": "within caps"})
        for env in ({"AGENT_KILL": "1"}, {"HALT": "1"}):
            self.assertFalse(agentwork.gate(d, env=env, gh=ok, now=NOW, repo="o/r")["go"], env)
        write(d, "ops/agent-kill", ""); self.assertIn("kill switch", agentwork.gate(d, env={}, gh=ok, now=NOW)["why"]); (d / "ops/agent-kill").unlink()
        write(d, "ops/halt.json", {"halted": True}); self.assertFalse(agentwork.gate(d, env={}, gh=ok, now=NOW)["go"]); write(d, "ops/halt.json", {"halted": False}); self.assertTrue(agentwork.gate(d, env={}, gh=ok, now=NOW)["go"])
        write(d, "ops/agent-cost.jsonl", json.dumps({"at": "2026-11-26T01:00:00Z", "usd": 0.6}) + "\n" + json.dumps({"at": "2026-11-26T02:00:00Z", "usd": 0.5}) + "\n" + json.dumps({"at": "2026-11-25T02:00:00Z", "usd": 9}) + "\n")
        self.assertEqual(agentwork.gate(d, env={"AGENT_KILL": "1"}, gh=ok, now=NOW)["why"][:11], "kill switch", "a kill switch wins over a cap"); self.assertEqual(agentwork.gate(d, env={}, gh=ok, now=NOW), {"go": False, "why": "cap: spend today reached $1.0"})
        d2 = self.cfg_root(); write(d2, "ops/agentwork.jsonl", "".join(json.dumps({"at": "2026-11-26T0%d:00:00Z" % (i % 10), "go": True}, separators=(",", ":")) + "\n" for i in range(48)))
        self.assertEqual(agentwork.gate(d2, env={}, gh=ok, now=NOW)["why"], "cap: 48 runs today")
        self.assertEqual(agentwork.gate(d, env={}, gh=lambda *a: (0, "6\n"), now=dt.datetime(2026, 11, 27, tzinfo=dt.timezone.utc), repo="o/r")["why"], "cap: 6 agent PRs already open; the lane merges them first")
        bad = agentwork.gate(d, env={}, gh=lambda *a: (1, "HTTP 502"), now=dt.datetime(2026, 11, 27, tzinfo=dt.timezone.utc), repo="o/r"); self.assertFalse(bad["go"]); self.assertIn("cap input unreadable", bad["why"], "fail closed")


class SelfCode(unittest.TestCase):
    def test_us_33_r71_the_self_code_loop_files_a_bounded_number_of_findings_of_enabled_unpaused_kinds_and_a_kind_whose_changes_are_mostly_reverted_is_paused(self):
        """US-33-R71"""
        c = selfcode.cfg(ROOT); R = c["rails"]; self.assertEqual((R["max_new_per_run"], R["max_open"], R["max_filed_per_day"], R["refile_cooldown_hours"], R["capacity_share"], c["learning"]["min_kept_rate"], c["learning"]["pause_hours"]), (1, 3, 8, 48, 0.34, 0.5, 72))
        f = lambda kind, key, n=1: {"kind": kind, "key": key, "count": n, "detail": ["d"]}
        found = [f("bare_except", "foundation/a.py"), f("unused_import", "foundation/b.py"), f("bare_except", "foundation/c.py", 5)]
        got = selfcode.pick_findings(found, [], set(), ROOT, NOW); self.assertEqual(len(got), 1, "at most one new item a run"); self.assertEqual(got[0]["kind"], "bare_except", "a disabled kind is never filed")
        self.assertEqual(selfcode.pick_findings(found, [], {"a", "b", "c"}, ROOT, NOW), [], "three open items fill the open cap")
        iid = selfcode.item_for(found[0])["id"]; self.assertEqual(iid, "Q-SELF-bare-except-foundation-a-py"); self.assertEqual(selfcode.pick_findings([found[0]], [], {iid}, ROOT, NOW), [], "an item already open is not filed again")
        stamp = lambda h: (NOW - dt.timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M:%SZ")
        self.assertEqual(selfcode.pick_findings([found[0]], [{"id": iid, "status": "kept", "kind": "bare_except", "at": stamp(10)}], set(), ROOT, NOW), [], "an item settled inside the cooldown is not re-filed")
        self.assertEqual(len(selfcode.pick_findings([found[0]], [{"id": iid, "status": "kept", "kind": "bare_except", "at": stamp(60)}], set(), ROOT, NOW)), 1)
        rows = [{"id": f"x{i}", "kind": "bare_except", "status": "reverted" if i < 3 else "kept", "at": stamp(5)} for i in range(4)]
        self.assertEqual(selfcode.kept_rate(rows, "bare_except"), (4, 0.25)); self.assertTrue(selfcode.paused(rows, "bare_except", ROOT, NOW)); self.assertFalse(selfcode.paused(rows, "bare_except", ROOT, NOW + dt.timedelta(hours=73)), "the pause lapses after 72 hours")
        self.assertFalse(selfcode.paused(rows[:2], "bare_except", ROOT, NOW), "fewer than three settled changes is not enough to pause"); self.assertEqual(selfcode.pick_findings(found, rows, set(), ROOT, NOW), [], "a paused kind files nothing")
        self.assertEqual(selfcode.scope_violation(["foundation/a.py", "tests/t.py", "docs/issues/x.json", ".github/workflows/x.yml", "autonomy/policy.json", "doctrine/x.json"], ROOT), [".github/workflows/x.yml", "autonomy/policy.json", "doctrine/x.json"], "a self-code change writes only inside the allowlist")
        own = [I("Q-SELF-bare-except-a"), I("Q-INTAKE-5"), I("Q-SELF-hand-filed"), I("Q-GROW-1")]; self.assertTrue(selfcode.is_own("Q-INTAKE-5")); self.assertFalse(selfcode.is_own("Q-SELF-hand-filed"))
        self.assertEqual([i["number"] for i in selfcode.prefer(own, ROOT, rows=[{"issue": "Q-GROW-1"}] * 6)], ["Q-SELF-bare-except-a", "Q-INTAKE-5"], "below its capacity share the loop's own items are the only candidates")
        self.assertEqual(selfcode.prefer(own, ROOT, rows=[{"issue": "Q-SELF-bare-except-a"}] * 6), own, "at its share the whole queue is open again")

    def test_us_33_r72_a_finding_the_syntax_tree_fully_determines_is_fixed_by_code_with_no_model_and_a_name_another_file_reaches_is_left_alone(self):
        """US-33-R72"""
        d = tmp(self); write(d, "foundation/m.py", "import os\nimport sys, json\nfrom a import b, c\n\nprint(sys.argv, c)\n"); write(d, "foundation/user.py", "from foundation.m import json\n")
        self.assertEqual(sorted(mechfix.unused_names((d / "foundation/m.py").read_text())), ["b", "json", "os"]); self.assertTrue(mechfix.externally_used(d, "foundation/m.py", "json")); self.assertFalse(mechfix.externally_used(d, "foundation/m.py", "os"))
        e = mechfix.fix_file(d, "foundation/m.py"); self.assertEqual(sorted(e["names"]), ["b", "os"], "json is reached through the module and stays")
        self.assertEqual(e["content"], "import sys, json\nfrom a import c\n\nprint(sys.argv, c)\n"); compile(e["content"], "m.py", "exec")
        issue = {"number": "Q-SELF-unused-import-foundation-m-py", "body": "SELFCODE-1 signal `unused_import` on `foundation/m.py` (3 finding(s))."}; call = mechfix.call_for(issue, d)
        out = call("any prompt"); self.assertEqual([f["path"] for f in out["files"]], ["foundation/m.py"]); self.assertIn("no model call", out["summary"])
        self.assertIsNone(mechfix.call_for({"number": "Q-SELF-unused-import-x", "body": "no key"}, d), "an item with no file is the model's"); self.assertIsNone(mechfix.call_for({"number": "Q-SELF-unused-import-x", "body": "signal `unused_import` on `foundation/none.py`"}, d))
        write(d, "foundation/ok.py", "import os\nprint(os)\n"); self.assertIsNone(mechfix.call_for({"number": "Q-1", "body": "signal `unused_import` on `foundation/ok.py`"}, d), "nothing to remove is not a fix")

    def test_us_33_r73_the_executor_is_judged_by_whether_its_model_calls_answer_so_a_run_of_items_shelved_for_dead_rungs_is_a_dead_ladder_and_no_evidence_is_unmeasured(self):
        """US-33-R73"""
        d = tmp(self); now = dt.datetime(2026, 11, 26, 12, 0, tzinfo=dt.timezone.utc); self.assertEqual(ladderwatch.read(d, 24, now)["state"], "unmeasured", "no executor disposition in the window is never healthy")
        item = lambda n, hours, dead: write(d, f"docs/issues/Q-{n}.json", {"body": f"**Disposition:** shelved (executor-failed, {(now - dt.timedelta(hours=hours)).strftime('%Y-%m-%dT%H:%M:%SZ')} x). " + ("every code agent rung failed: workers-ai-glm: HTTPError: HTTP Error 401 | github-models-gpt: RuntimeError: non-JSON response (HTTP 200, text/plain)" if dead else "checks failed after 3 attempts")})
        for n in range(3):
            item(n, 2, True)
        item(9, 400, True)
        r = ladderwatch.read(d, 24, now); self.assertEqual((r["executor_shelved"], r["ladder_dead"], r["state"]), (3, 3, "dead")); self.assertEqual(r["rungs_failing"], ["github-models-gpt", "workers-ai-glm"])
        for n in range(3, 7):
            item(n, 1, False)
        self.assertEqual(ladderwatch.read(d, 24, now)["state"], "ok", "three dead of seven is under half: the ladder answers")
        for n in range(7, 12):
            item(n, 1, True)
        self.assertEqual(ladderwatch.read(d, 24, now)["state"], "dead")
        with mock.patch.object(ladderwatch, "read", return_value={"state": "dead"}):
            self.assertEqual(ladderwatch.main(["--check"]), 1)
        with mock.patch.object(ladderwatch, "read", return_value={"state": "unmeasured"}):
            self.assertEqual(ladderwatch.main(["--check"]), 0)


class Watch(unittest.TestCase):
    def test_us_33_r83_a_deploy_gate_that_is_red_on_main_is_repaired_by_bisection_and_the_smallest_revert_with_no_model_and_a_test_is_never_reverted(self):
        """US-33-R83"""
        c = redmain.cfg(ROOT); self.assertTrue(all(p in c["never_revert"] for p in ("*.test.js", "*.test.mjs", "tests/*", "test/*"))); self.assertEqual(redmain.check(ROOT), [], "the gate script exists and the workflows run exactly the gate's command")
        patcher = mock.patch.dict(os.environ, {"PYTHONDONTWRITEBYTECODE": "1"}); patcher.start(); self.addCleanup(patcher.stop)  # two writes in one second of the same size would otherwise hit a stale .pyc
        d = tmp(self); git(d, "init", "-q", "-b", "main")
        write(d, "doctrine/redmain.json", {"max_commits_back": 10, "max_candidates": 20, "gate_timeout_s": 30, "never_revert": ["tests/*"], "gates": {"g": {"cmd": "bash gate.sh", "paths": ["src", "tests"], "workflows": []}}})
        write(d, "gate.sh", "python3 tests/t.py\n"); write(d, "tests/t.py", "import sys; sys.path.insert(0, 'src'); import a\nassert a.f() == 1\n"); write(d, "src/a.py", "def f():\n    return 1\n")
        commit = lambda msg: (git(d, "add", "-A"), git(d, "commit", "-qm", msg)); commit("good")
        self.assertEqual(redmain.find_repair(d, "g"), {"gate": "g", "state": "green"})
        write(d, "src/other.py", "x = 1\n"); commit("unrelated"); write(d, "src/a.py", "def f():\n    return 2\n"); commit("break the gate"); write(d, "src/later.py", "y = 1\n"); commit("later")
        ok, tail = redmain.gate_ok("bash gate.sh", d, 30); self.assertFalse(ok)
        r = redmain.find_repair(d, "g"); self.assertEqual(r["state"], "red"); self.assertEqual((r["repair"]["kind"], r["repair"]["path"]), ("hunk", "src/a.py"), "the smallest revert that turns the gate green, with no model")
        subject = lambda rev: git(d, "log", "-1", "--format=%s", rev).strip(); self.assertEqual((subject(r["good"]), subject(r["bad"])), ("unrelated", "break the gate"), "bisected to the first bad commit")
        self.assertEqual((d / "src/a.py").read_text(), "def f():\n    return 2\n", "a repair is found in a scratch worktree: the working tree is not touched until it is applied")
        d2 = tmp(self); git(d2, "init", "-q", "-b", "main"); shutil.copytree(d / "doctrine", d2 / "doctrine"); write(d2, "gate.sh", "python3 tests/t.py\n"); write(d2, "tests/t.py", "import sys\n"); git(d2, "add", "-A"); git(d2, "commit", "-qm", "good")
        write(d2, "tests/t.py", "raise SystemExit(1)\n"); git(d2, "add", "-A"); git(d2, "commit", "-qm", "bad test")
        r2 = redmain.find_repair(d2, "g"); self.assertEqual(r2["state"], "red"); self.assertIsNone(r2["repair"], "a test file is never reverted: a guard is not weakened to pass"); self.assertIn("no single hunk, file or full revert", r2["why"])

    def test_us_33_r84_a_pull_request_merged_without_a_green_full_suite_on_its_head_becomes_one_queue_item_and_an_unreadable_answer_raises(self):
        """US-33-R84"""
        def run(table):
            def f(*a):
                path = a[1]
                if "check-runs" in path:
                    sha = path.split("/commits/")[1].split("/")[0]; return 0, json.dumps(table[sha])
                if "/pulls?" in path:
                    return 0, json.dumps([{"number": n, "head": {"sha": "s%d" % n}, "title": "t%d" % n, "merged_at": (NOW - dt.timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")} for n in (1, 2, 3)] + [{"number": 4, "head": {"sha": "s4"}, "title": "closed", "merged_at": None}])
                return 1, "x"
            return f
        table = {"s1": ["success"], "s2": ["failure"], "s3": []}
        self.assertEqual([mergeaudit.gate(s, run(table)) for s in ("s1", "s2", "s3")], ["success", "failure", "missing"])
        d = tmp(self); (d / "docs/issues").mkdir(parents=True)
        rows = mergeaudit.scan(d, apply=True, run=run(table), now=NOW); self.assertEqual({(r["pr"], r["checks"]) for r in rows}, {(2, "failure"), (3, "missing")}, "a merge whose head passed the full suite is not a finding")
        item = json.loads((d / "docs/issues/Q-CIFAIL-mergeaudit-2.json").read_text()); self.assertEqual(item["milestone"], "Now"); self.assertIn("Done check:** cmd:python3 -m foundation mergeaudit --probe 2", item["body"]); self.assertIn("MERGE-AUDIT-1: PR #2", item["body"])
        again = mergeaudit.scan(d, apply=True, run=run(table), now=NOW); self.assertTrue(all(r["known"] and not r["filed"] for r in again), "one item per merge, however many passes")
        with self.assertRaises(RuntimeError):
            mergeaudit.gate("s1", lambda *a: (1, "HTTP 502"))

    def test_us_33_r85_the_newest_conclusive_run_of_every_workflow_is_watched_a_transient_failure_is_rerun_once_and_any_other_becomes_one_item_with_a_probe(self):
        """US-33-R85"""
        cfg = json.loads((ROOT / "doctrine/ciwatch.json").read_text()); self.assertEqual((cfg["max_reruns_per_run"], cfg["max_items_per_run"]), (1, 6)); self.assertEqual(cfg["failing"], ["failure", "timed_out", "startup_failure"])
        for log in ("HTTP 503 from registry", "ECONNRESET", "API rate limit exceeded", "the runner lost communication"):
            self.assertTrue(ciwatch.is_transient(log, cfg), log)
        self.assertFalse(ciwatch.is_transient("AssertionError: 3 != 4", cfg))
        runs = [{"id": 11, "name": "checks", "conclusion": "failure", "created_at": "t", "html_url": "u", "head_sha": "a"}, {"id": 12, "name": "checks", "conclusion": "success", "created_at": "t0", "html_url": "u", "head_sha": "b"}, {"id": 13, "name": "deploy", "conclusion": "cancelled", "created_at": "t", "html_url": "u", "head_sha": "c"}, {"id": 14, "name": "deploy", "conclusion": "success", "created_at": "t0", "html_url": "u", "head_sha": "d"}]
        def gh(*a):
            if a[:2] == ("api", "repos/o/r"):
                return 0, "main"
            if "actions/runs" in a[1]:
                return 0, json.dumps(runs)
            return 0, "AssertionError: 3 != 4"
        got = ciwatch.latest("o/r", gh); self.assertEqual([(r["name"], r["conclusion"]) for r in got], [("checks", "failure"), ("deploy", "success")], "a cancelled run is passed over for the next conclusive one, so the probe never reads a cancelled run as green")
        self.assertEqual(ciwatch.slug("ultrastable/practical-solutions", "deploy tenant"), "practical-solutions-deploy-tenant"); it = ciwatch.item("o/r", runs[0], "tail text"); self.assertEqual(it["id"], "Q-CIFAIL-r-checks"); self.assertIn("Done check:** cmd:python3 -m foundation ciwatch --probe o/r checks", it["body"]); self.assertIn("tail text", it["body"])
        d = tmp(self); (d / "docs/issues").mkdir(parents=True); write(d, "doctrine/ciwatch.json", {**cfg, "repos": ["o/r"]})
        rows = ciwatch.scan(d, apply=True, run=gh, now=NOW); self.assertEqual([(r["workflow"], r["result"]) for r in rows if "workflow" in r], [("checks", "filed"), ("deploy", "green")]); self.assertTrue((d / "docs/issues/Q-CIFAIL-r-checks.json").is_file()); self.assertTrue((d / "ops/ciwatch.jsonl").is_file(), "passes are recorded as well as failures")
        def transient(*a):
            return (0, "HTTP 503 Service Unavailable") if a[0] == "run" and a[1] == "view" else (0, "ok") if a[0] == "run" else gh(*a)
        rows = ciwatch.scan(d, apply=True, run=transient, now=NOW); self.assertEqual([r["result"] for r in rows if r.get("workflow") == "checks"], ["rerun"])
        def unread(*a):
            return (1, "HTTP 404") if a[0] == "api" else (0, "")
        self.assertEqual(ciwatch.scan(d, apply=False, run=unread, now=NOW)[0]["result"], "unmeasured", "an unreadable repository is a finding, not a pass")


class Mirror(unittest.TestCase):
    def test_us_33_r93_every_open_issue_is_a_loop_with_a_probe_a_passing_probe_closes_it_with_the_evidence_and_an_issue_that_cannot_be_probed_is_never_counted_as_passed(self):
        """US-33-R93"""
        self.assertEqual(issueloop.parse_probe("text\n- Closing probe: `file:docs/a.md`\n"), ("local", "file:docs/a.md", None)); self.assertEqual(issueloop.parse_probe("Done check: grep:a.py::x"), ("local", "grep:a.py::x", None))
        self.assertEqual(issueloop.parse_probe('Probe: GET https://a.b/c expect "ok"'), ("get", "https://a.b/c", "ok")); self.assertIsNone(issueloop.parse_probe("no probe here")); self.assertIsNone(issueloop.parse_probe("Probe: see the dashboard"))
        iss = lambda body: {"number": 1, "body": body}
        self.assertEqual(issueloop.evaluate("o/r", iss("nothing")), ("unprobed", "no probe line in the body"))
        self.assertEqual(issueloop.evaluate("o/r", iss('Probe: GET https://a.b/c expect "ok"'), fetch=lambda u: "all ok")[0], "pass"); self.assertEqual(issueloop.evaluate("o/r", iss('Probe: GET https://a.b/c expect "ok"'), fetch=lambda u: "nope")[0], "fail")
        def down(u):
            raise OSError("refused")
        self.assertEqual(issueloop.evaluate("o/r", iss('Probe: GET https://a.b/c expect "ok"'), fetch=down)[0], "unmeasured", "unreachable is unmeasured, never passed")
        self.assertEqual(issueloop.evaluate("other/repo", iss("Closing probe: file:docs/a.md"))[0], "unmeasured", "a local probe cannot judge another repository's issue")
        self.assertEqual(issueloop.evaluate("ultrastable/ultrastable", iss("Closing probe: file:README.md"), ROOT)[0], "pass"); self.assertEqual(issueloop.evaluate("ultrastable/ultrastable", iss("Closing probe: file:docs/none-such.md"), ROOT)[0], "fail")

    def test_us_33_r94_the_queue_is_mirrored_one_way_onto_issues_the_file_wins_a_duplicate_is_closed_and_an_item_gone_from_the_queue_is_closed_as_an_orphan(self):
        """US-33-R94"""
        item = {"id": "Q-A-1", "title": "do a thing", "body": "b", "labels": ["role:staff", "p1"], "milestone": "Now"}
        w = ghmirror.desired(item, "o/r"); self.assertEqual((w["title"], w["state"], w["milestone"]), ("Q-A-1: do a thing", "open", "Now")); self.assertIn(ghmirror.SYNC, w["labels"]); self.assertIn("<!-- us-item:Q-A-1 -->", w["body"])
        closed = ghmirror.desired({**item, "body": "**Status:** closed\nx"}, "o/r"); self.assertEqual((closed["state"], closed["milestone"]), ("closed", "Now"))
        self.assertEqual(ghmirror.desired({**item, "milestone": "Weird"}, "o/r")["milestone"], "Later"); self.assertEqual(ghmirror.desired({**item, "title": "Q-A-1: already prefixed"}, "o/r")["title"], "Q-A-1: already prefixed")
        have = lambda number, **o: {"number": number, "state": "open", "title": w["title"], "body": w["body"], "labels": [{"name": n} for n in w["labels"]], "milestone": {"title": "Now"}, **o}
        self.assertEqual(ghmirror.plan([w], [have(5)], set(w["labels"]), {"Now": 1}), [], "an issue already equal to its file is left alone")
        acts = ghmirror.plan([w], [have(5, title="edited on GitHub")], set(w["labels"]), {"Now": 1}); self.assertEqual([(a[0], a[2]) for a in acts], [("update", 5)], "an edit made on GitHub is put back: the file wins")
        acts = ghmirror.plan([w], [], set(), {}); self.assertEqual([a[0] for a in acts][:3], ["label", "label", "label"]); self.assertEqual(acts[-1][0], "create"); self.assertIn(("milestone", "Now"), acts)
        dup = ghmirror.plan([w], [have(9), have(5)], set(w["labels"]), {"Now": 1}); self.assertEqual(dup, [("orphan", 9)], "the lowest open number is the mirror and every other open copy is closed")
        gone = ghmirror.plan([], [have(5)], set(w["labels"]), {"Now": 1}); self.assertEqual(gone, [("orphan", 5)])
        self.assertEqual(ghmirror.check(), [], "every item maps to a valid issue shape")


class Siblings(unittest.TestCase):
    def test_us_33_r92_the_executor_takes_a_sibling_repositorys_issue_only_with_a_machine_readable_probe_and_no_hold_within_a_daily_cap_and_its_pull_request_carries_the_contract_record(self):
        """US-33-R92"""
        ok = {"title": "add a thing", "labels": [{"name": "p2"}], "body": "Closing probe: file_exists: docs/a.md"}
        self.assertTrue(crossrepo.eligible(ok)); self.assertTrue(crossrepo.eligible({**ok, "labels": ["p2"]}), "a label is a name or an object")
        self.assertFalse(crossrepo.eligible({**ok, "body": "Closing probe: see the dashboard"}), "the loop must be able to close it by itself")
        self.assertFalse(crossrepo.eligible({**ok, "body": ""})); self.assertFalse(crossrepo.eligible({**ok, "body": None}))
        for held in ("hold", "blocked", "owner", "gate", "identity-bound", "wontfix", "in-progress", "executor-failed", "protected-change", "extraction-epic"):
            self.assertFalse(crossrepo.eligible({**ok, "labels": [{"name": held}]}), held)
        for title in ("EPIC: all of it", "gate: sign here", "Incident 4"):
            self.assertFalse(crossrepo.eligible({**ok, "title": title}), title)
        with mock.patch.dict(os.environ, {"EXECUTOR_TARGET_REPOS": " a/b, c/d ,"}):
            self.assertEqual(crossrepo.targets(), ["a/b", "c/d"])
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("EXECUTOR_TARGET_REPOS", None); self.assertEqual(crossrepo.targets(), [], "no target is named in code: a deployment names its own")
        recent = (NOW - dt.timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%SZ"); old = (NOW - dt.timedelta(hours=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
        rows = json.dumps([{"headRefName": "agent/x", "createdAt": recent}, {"headRefName": "agent/y", "createdAt": old}, {"headRefName": "feature/z", "createdAt": recent}])
        with mock.patch.object(crossrepo, "_gh", return_value=(0, rows)):
            self.assertEqual(crossrepo.prs_today("o/r", NOW), 1, "only agent branches opened in the last day count")
        with mock.patch.object(crossrepo, "_gh", return_value=(1, "boom")):
            self.assertEqual(crossrepo.prs_today("o/r", NOW), crossrepo.MAX_PRS_PER_DAY, "a count that cannot be read is read as the cap, never as zero")
        issues = json.dumps([{"number": 1, "title": "a", "body": "Closing probe: pr_merged: 1", "labels": [], "updatedAt": "u1"}, {"number": 2, "title": "b", "body": "none", "labels": [], "updatedAt": "u2"}])
        with mock.patch.object(crossrepo, "prs_today", return_value=crossrepo.MAX_PRS_PER_DAY), mock.patch.object(crossrepo, "_gh", return_value=(0, issues)):
            self.assertEqual(crossrepo.takeable("o/r"), [], "the daily cap is spent")
        with mock.patch.object(crossrepo, "prs_today", return_value=0), mock.patch.object(crossrepo, "_gh", return_value=(0, issues)):
            self.assertEqual([i["number"] for i in crossrepo.takeable("o/r")], [1])
        with mock.patch.object(crossrepo, "prs_today", return_value=0), mock.patch.object(crossrepo, "_gh", return_value=(1, "denied")):
            with self.assertRaises(RuntimeError): crossrepo.takeable("o/r")
        body = crossrepo.pr_body(7, {"models": ["m1", "m2"], "review": {"model": "other", "approve": True}}, "2026-11-26T12:00:00Z")
        for field in ("Item: #7", "Spec:", "Prediction: issue_7_closed = 1 within 24 h", "Evidence:", "Author: ultrastable executor (m1, m2)", "Reviewer: independent model other (verdict: approve)", "Closes #7"):
            self.assertIn(field, body)
        self.assertIn("a different agent than the author", crossrepo.pr_body(7, {}, "t").split("Reviewer:")[1], "with no model review the required checks are the reviewer")


if __name__ == "__main__":
    unittest.main()

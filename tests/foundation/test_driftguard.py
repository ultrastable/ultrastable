# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""DRIFT-GUARD-1: each class of the 2026-11-25 failures is caught by a check (foundation/driftguard.py)."""
import json, subprocess, tempfile, time, unittest
from pathlib import Path
from unittest import mock

from foundation import driftguard as dg

REPO = Path(__file__).resolve().parents[2]


class Registry(unittest.TestCase):
    def test_every_incident_has_class_check_detector_and_mode(self):
        self.assertEqual(dg.check(REPO), [])


class Crons(unittest.TestCase):
    def test_the_repository_fits_the_account_cron_budget_and_every_tenant_clock_has_a_pulse(self):
        self.assertEqual(dg.crons(REPO), [])

    def test_a_tenant_whose_only_route_to_run_is_its_own_cron_fails(self):
        topo = json.loads((REPO / "doctrine/topology.json").read_text())
        for w in topo["workers"]:
            if w["id"] == "ultrastable-unlearn":
                w.pop("pulse")
        real = dg._j
        with mock.patch.object(dg, "_j", side_effect=lambda p, root=REPO: topo if p == "doctrine/topology.json" else real(p, root)):
            errs = dg.crons(REPO)
        self.assertTrue(any("ultrastable-unlearn: a tenant back end whose only route to run is its own cron" in e for e in errs), errs)

    def test_over_the_free_plan_limit_fails(self):
        real = dg._j
        def j(p, root=REPO):
            d = real(p, root)
            if p == "instances/ultrastable/instance.json":
                d = dict(d); d["budget"] = dict(d.get("budget", {}), plan="free")
            return d
        with mock.patch.object(dg, "_j", side_effect=j):
            errs = dg.crons(REPO)
        self.assertTrue(any("cron triggers declared on the account, over 4" in e for e in errs), errs)

    def test_live_without_a_token_is_unmeasured_never_in_order(self):
        errs = dg.crons(REPO, live=True, env={})
        self.assertTrue(any(e.startswith("unmeasured") for e in errs))


class Triggers(unittest.TestCase):
    def test_push_paths_are_read_from_workflows(self):
        wf = dg._workflow_paths(REPO)
        self.assertIn("tenant-repos.yml", wf)
        self.assertIn(".github/workflows/tenant-repos.yml", wf["tenant-repos.yml"])

    def test_a_matching_push_with_no_run_is_found_and_dispatched(self):
        with tempfile.TemporaryDirectory() as d:
            r = Path(d)
            (r / ".github/workflows").mkdir(parents=True); (r / "doctrine").mkdir()
            (r / "doctrine/driftguard.json").write_text(json.dumps({"missed_trigger": {"window_hours": 24, "grace_minutes": 0}}))
            (r / ".github/workflows/w.yml").write_text('name: w\non:\n  push:\n    branches: [main]\n    paths: ["a/**"]\n  workflow_dispatch:\njobs: {}\n')
            run = lambda *a: subprocess.run(["git", "-C", d, *a], check=True, capture_output=True)
            run("init", "-q", "-b", "main"); run("config", "user.email", "t@t"); run("config", "user.name", "t")
            (r / "a").mkdir(); (r / "a/x").write_text("1"); run("add", "-A"); run("commit", "-qm", "change a")
            calls = []
            def http(url, token=None, method="GET", body=None, auth="Bearer"):
                calls.append((method, url))
                return (204, {}) if method == "POST" else (200, {"workflow_runs": []})
            with mock.patch.object(dg, "_http", side_effect=http):
                found = dg.triggers(r, env={"GH_TOKEN": "t", "GITHUB_REPOSITORY": "o/r"})
                self.assertTrue(any("w.yml: push" in e and "started no run" in e for e in found), found)
                fixed = dg.triggers(r, apply=True, env={"GH_TOKEN": "t", "GITHUB_REPOSITORY": "o/r"})
            self.assertEqual(fixed, [])
            self.assertTrue(any(m == "POST" and u.endswith("/actions/workflows/w.yml/dispatches") for m, u in calls))


class EmptyLoop(unittest.TestCase):
    def test_a_branch_with_a_loop_of_empty_commits_fails(self):
        with tempfile.TemporaryDirectory() as d:
            r = Path(d); (r / "doctrine").mkdir()
            (r / "doctrine/driftguard.json").write_text(json.dumps({"empty_loop": {"max_empty_per_branch": 3}}))
            run = lambda *a: subprocess.run(["git", "-C", d, *a], check=True, capture_output=True)
            run("init", "-q", "-b", "main"); run("config", "user.email", "t@t"); run("config", "user.name", "t")
            (r / "f").write_text("1"); run("add", "-A"); run("commit", "-qm", "real")
            self.assertEqual(dg.empty_commits(r), [])
            for i in range(5):
                run("commit", "-q", "--allow-empty", "-m", f"noop {i}")
            errs = dg.empty_commits(r)
            self.assertTrue(any("5 empty commits" in e for e in errs), errs)


class AccountDrift(unittest.TestCase):
    def test_a_retired_account_is_named_by_its_hash_only(self):
        import hashlib
        fake = "0" * 31 + "1"  # a stand-in id: the real retired id is never written (SINGLE-ACCOUNT-1)
        real = dg._j
        def j(p, root=REPO):
            d = real(p, root)
            if p == dg.REG:
                d = json.loads(json.dumps(d)); d["account_drift"]["retired_account_sha256"] = [hashlib.sha256(fake.encode()).hexdigest()]
            return d
        with mock.patch.object(dg, "_j", side_effect=j), mock.patch.object(dg, "_http", return_value=(200, {})):
            errs = dg.accounts_live(REPO, env={"CLOUDFLARE_ACCOUNT_ID": fake, "CLOUDFLARE_API_TOKEN": "t"})
        self.assertTrue(any("a retired account" in e for e in errs), errs)
        self.assertFalse(any(fake in e for e in errs))

    def test_a_token_minted_on_another_account_fails(self):
        with mock.patch.object(dg, "_http", return_value=(403, {})):
            errs = dg.accounts_live(REPO, env={"CLOUDFLARE_API_TOKEN": "t"})
        self.assertTrue(any("cannot read the topology's account" in e for e in errs), errs)

    def test_the_right_account_passes(self):
        acct = json.loads((REPO / "doctrine/topology.json").read_text())["account_id"]
        with mock.patch.object(dg, "_http", return_value=(200, {})):
            self.assertEqual(dg.accounts_live(REPO, env={"CLOUDFLARE_ACCOUNT_ID": acct, "CLOUDFLARE_API_TOKEN": "t"}), [])


class Visibility(unittest.TestCase):
    def test_declarations_cover_tenants_and_the_template(self):
        v = dg.declared_visibility(REPO)
        self.assertIs(v["ultrastable/replication-ledger"], False)
        self.assertIs(v["ultrastable/seed"], False)

    def test_a_private_repository_declared_public_is_drift(self):
        def http(url, token=None, **k):
            return (200, {"private": url.endswith("/replication-ledger")})
        with mock.patch.object(dg, "_http", side_effect=http):
            errs = dg.visibility_live(REPO, env={"GH_TOKEN": "t"})
        self.assertIn("ultrastable/replication-ledger: private, declared public", errs)


class LiveEvidence(unittest.TestCase):
    def test_a_built_graph_with_no_nodes_fails(self):
        def http(url, *a, **k):
            return (200, {"nodes": 0}) if "tenant-ps" in url else (200, {"counts": {"nodes": 12}})
        with mock.patch.object(dg, "_http", side_effect=http):
            errs = dg.built_live(REPO)
        self.assertTrue(any(e.startswith("practical-solutions: marked built") and "no nodes" in e for e in errs), errs)
        self.assertFalse(any(e.startswith("unlearn") for e in errs))

    def test_a_deploy_verified_only_by_the_tick_health_is_refused(self):
        body = "## Handoff\nitem: X\nagent: claude-code\nverify: GET https://ultrastable-tick.ultrastable.workers.dev/health\nexpect \"last_tick\"\ndeploy: ultrastable-site, ultrastable-tick\n"
        self.assertTrue(dg.handoff_lint(body))
        self.assertEqual(dg.handoff_lint(body.replace("ultrastable-tick.ultrastable.workers.dev/health", "ultrastable.io/claims")), [])
        self.assertEqual(dg.handoff_lint(body.replace("deploy: ultrastable-site, ultrastable-tick", "deploy: none")), [])
        self.assertTrue(dg.handoff_lint("## Handoff\nitem: X\ndeploy: ultrastable-site\n"))


if __name__ == "__main__":
    unittest.main()

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""US-SPEC-11 requirements the platform meets in foundation/: R25 (every watcher is watched by another on an independent host) and R19 (the cron budget)."""
import copy, json, unittest
from pathlib import Path
from unittest import mock

from foundation import driftguard as dg
from foundation import resilience as R

REPO = Path(__file__).resolve().parents[2]


class Resilience(unittest.TestCase):
    def _check_with(self, edit):
        cfg = copy.deepcopy(R.load(REPO))
        edit(cfg)
        with mock.patch.object(R, "load", return_value=cfg):
            return R.check(REPO)

    def test_US_11_R25_the_repository_has_no_watcher_that_is_watched_by_itself_or_only_from_its_own_host(self):
        self.assertEqual(R.check(REPO), [])
        ws = R.load(REPO)["watchers"]
        self.assertGreaterEqual(len({w["host"] for w in ws}), 2)                       # independent hosts
        ids = {w["id"] for w in ws}
        for w in ws:
            self.assertIn(w["watched_by"], ids); self.assertNotEqual(w["watched_by"], w["id"])

    def test_US_11_R25_a_watcher_watched_by_itself_fails(self):
        def edit(cfg):
            w = cfg["watchers"][0]; w["watched_by"] = w["id"]
        errs = self._check_with(edit)
        self.assertTrue(any("itself, which is a single point of failure" in e for e in errs), errs)

    def test_US_11_R25_a_watcher_watched_by_nobody_and_a_single_host_fail(self):
        def nobody(cfg): cfg["watchers"][0]["watched_by"] = "no-such-watcher"
        self.assertTrue(any("is not a watcher" in e for e in self._check_with(nobody)))
        def one_host(cfg):
            for w in cfg["watchers"]: w["host"] = "github-actions"
        self.assertTrue(any("watchers run on one host only" in e for e in self._check_with(one_host)))


class CronBudget(unittest.TestCase):
    def test_US_11_R19_the_declared_cron_triggers_fit_the_plan_and_every_tenant_back_end_has_a_second_route(self):
        self.assertEqual(dg.crons(REPO), [])

    def test_US_11_R19_a_tenant_whose_only_route_to_run_is_its_own_cron_fails(self):
        topo = json.loads((REPO / "doctrine/topology.json").read_text())
        victim = next(w for w in topo["workers"] if w.get("state") == "live" and w.get("crons") and w.get("source") and w.get("pulse"))
        victim.pop("pulse")
        real = dg._j
        with mock.patch.object(dg, "_j", side_effect=lambda p, root=REPO: topo if p == "doctrine/topology.json" else real(p, root)):
            errs = dg.crons(REPO)
        self.assertTrue(any(f"{victim['id']}: a tenant back end whose only route to run is its own cron" in e for e in errs), errs)

    def test_US_11_R19_declared_triggers_over_the_headroom_of_the_plan_limit_fail(self):
        real = dg._j
        def j(p, root=REPO):
            d = real(p, root)
            if p == "instances/ultrastable/instance.json":
                d = dict(d); d["budget"] = dict(d.get("budget", {}), plan="free")
            return d
        with mock.patch.object(dg, "_j", side_effect=j):
            errs = dg.crons(REPO)
        self.assertTrue(any("cron triggers declared on the account, over" in e for e in errs), errs)

    def test_US_11_R19_an_unreadable_account_is_unmeasured_never_in_order(self):
        errs = dg.crons(REPO, live=True, env={})
        self.assertTrue(any(e.startswith("unmeasured") for e in errs), errs)


if __name__ == "__main__":
    unittest.main()

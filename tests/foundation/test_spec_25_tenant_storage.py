# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-SPEC-25 (tenant storage): the requirements proven by the platform's Python checks.

US-25-R22 (TS-12): every deployed tenant Worker binds only its own stores and no core service, and no core Worker binds a tenant's store
(foundation/tenantrepos.py `isolation`, over doctrine/tenant-repos.json and doctrine/topology.json). US-25-R24 (TS-14): the storage decision, the
default budget, the tenant list and the monthly ceiling are declared as data (doctrine/tenant-storage.json) and the check fails when the
declaration is incomplete or the full-budget worst case passes the ceiling (foundation/tenantstorage.py).
"""
import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _repo  # noqa: E402
from foundation import tenantrepos as tr  # noqa: E402
from foundation import tenantstorage as ts  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def scratch(reg, topo):
    d = _repo.scratch()
    (d / "doctrine").mkdir()
    (d / "doctrine/tenant-repos.json").write_text(json.dumps(reg))
    (d / "doctrine/topology.json").write_text(json.dumps(topo))
    return d


class TenantWorkerIsolation(unittest.TestCase):
    REG = {"org": "o", "tenants": {"a": {"repo": "o/a", "state": "own-repo", "worker": "w-a",
                                         "sandbox": {"stores": ["ultrastable-a"], "secrets": [],
                                                     "budget": {"requests_per_day": 1, "d1_reads_per_day": 1, "ai_neurons_per_day": 1}}}}}

    def test_us_25_r22_the_declared_topology_has_no_shared_binding(self):
        self.assertEqual(tr.isolation(ROOT), [])

    def test_us_25_r22_a_tenant_worker_that_binds_a_core_store_or_service_fails(self):
        topo = {"workers": [{"id": "w-a", "source": {"repo": "o/a"},
                             "bindings": {"d1": {"DB": "ultrastable-a", "ORG": "ultrastable-org"}, "services": {"TICK": "ultrastable-tick"}}}]}
        errs = tr.isolation(scratch(self.REG, topo), self.REG, topo)
        self.assertTrue(any("binds ultrastable-org" in e for e in errs), errs)
        self.assertTrue(any("binds services" in e for e in errs), errs)

    def test_us_25_r22_a_core_worker_that_binds_a_tenant_store_fails(self):
        topo = {"workers": [{"id": "w-a", "source": {"repo": "o/a"}, "bindings": {"d1": {"DB": "ultrastable-a"}}},
                            {"id": "core", "bindings": {"d1": {"X": "ultrastable-a"}}}]}
        errs = tr.isolation(scratch(self.REG, topo), self.REG, topo)
        self.assertTrue(any("core worker core binds ultrastable-a" in e for e in errs), errs)
        ok = {"workers": [topo["workers"][0]]}
        self.assertEqual(tr.isolation(scratch(self.REG, ok), self.REG, ok), [])


class StorageDeclaration(unittest.TestCase):
    def test_us_25_r24_the_declaration_is_complete_and_the_worst_case_is_under_the_ceiling(self):
        self.assertEqual(ts.check(), [])
        c = ts.load()
        self.assertLessEqual(ts.worst_case(c), c["monthly_ceiling_usd"])

    def test_us_25_r24_a_full_budget_over_the_ceiling_is_a_breach(self):
        c = copy.deepcopy(ts.load())
        c["default_budget"]["month"]["requests"] = 50_000_000
        self.assertGreater(ts.worst_case(c), c["monthly_ceiling_usd"])


if __name__ == "__main__":
    unittest.main()

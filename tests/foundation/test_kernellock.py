# SPDX-License-Identifier: LicenseRef-Ultrastable
import unittest
import _repo  # noqa: E402  (tests/foundation is on sys.path under discover)
from foundation import kernellock

class KernelLock(unittest.TestCase):
    def test_every_live_tenant_has_a_row(self):
        self.assertEqual(kernellock.check(), [])

    def test_status_orders_canary_first_and_reads_pins(self):
        cur = "a" * 40
        rows = kernellock.status(current=cur)
        self.assertTrue(rows[0]["canary"])
        self.assertTrue(all(r["state"] in ("unpinned", "current", "behind") for r in rows))

class Bump(unittest.TestCase):
    def _root(self, canary_pin):
        import json
        from pathlib import Path
        d = _repo.scratch(); (d / "doctrine").mkdir()
        (d / "doctrine/kernel-lock.json").write_text(json.dumps({"canary": "c", "tenants": {"c": {"pin": canary_pin}, "t": {"pin": None}, "p": {"pin": None}}}))
        (d / "doctrine/tenant-repos.json").write_text(json.dumps({"tenants": {"c": {"state": "own-repo"}, "t": {"state": "moved"}, "p": {"state": "planned"}}}))
        return d

    def test_canary_moves_alone_first(self):
        self.assertEqual(kernellock.bump(self._root(None), "b" * 40), {"c": "b" * 40})

    def test_rest_follow_once_canary_is_current_and_planned_waits(self):
        self.assertEqual(kernellock.bump(self._root("b" * 40), "b" * 40), {"t": "b" * 40})

if __name__ == "__main__": unittest.main()

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

    def _gh(self, pins, calls):
        import base64, json
        def gh(args, token=None):
            calls.append(args[0])
            if "contents/kernel.lock?ref=" in args[0]:
                ref = args[0].rsplit("=", 1)[1]
                if ref not in pins: return 1, ""
                if ".sha" in args: return 0, "s"
                return 0, base64.b64encode(json.dumps({"seed_tree": pins[ref]}).encode()).decode()
            return 0, "7" if "pulls" in args[0] else "x"
        return gh

    def test_open_pr_opens_then_waits_then_syncs(self):
        import json
        cur = "b" * 40; d = self._root(None)
        tr = json.loads((d / "doctrine/tenant-repos.json").read_text()); tr["tenants"]["c"]["repo"] = "o/c"
        (d / "doctrine/tenant-repos.json").write_text(json.dumps(tr))
        calls = []
        r = kernellock.open_pr(d, apply=True, gh=self._gh({"main": None}, calls), current=cur, commit="c" * 40)
        self.assertEqual((r["action"], r["pr"]), ("opened", "7"))
        br = "agent/kernel-lock-" + cur[:12]
        self.assertEqual(kernellock.open_pr(d, apply=True, gh=self._gh({"main": None, br: cur}, []), current=cur)["action"], "open")
        self.assertEqual(kernellock.open_pr(d, apply=True, gh=self._gh({"main": cur}, []), current=cur)["action"], "synced")
        self.assertEqual(kernellock.load(d)["tenants"]["c"]["pin"], cur)
        self.assertEqual(kernellock.open_pr(d, apply=True, gh=self._gh({}, []), current=cur)["action"], "none")

if __name__ == "__main__": unittest.main()

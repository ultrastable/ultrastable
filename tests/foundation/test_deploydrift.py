# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import unittest
from foundation import deploydrift as d

TOPO = {"workers": [
    {"id": "a", "state": "live", "main": "seed/worker/src/index.js"},
    {"id": "b", "state": "live", "main": "site/worker.js"},
    {"id": "c", "state": "live", "main": "x/src/i.js", "source": "ultrastable/c"},
    {"id": "d", "state": "live", "main": "dashboard/worker.js"},
]}


class DeployDrift(unittest.TestCase):
    def test_states(self):
        rows = {r["worker"]: r for r in d.read(TOPO, {"a": "1" * 40, "b": "2" * 40}, behind=lambda sha, p: 3 if sha[0] == "2" else 0)}
        self.assertEqual(rows["a"]["status"], "current")
        self.assertEqual(rows["b"]["status"], "drift")
        self.assertEqual(rows["c"]["status"], "unmeasured")  # a tenant Worker with no recorded deploy is unmeasured, not external
        self.assertEqual(rows["d"]["status"], "unmeasured")

    def test_a_tenant_worker_is_drift_when_its_repo_has_a_commit_newer_than_its_deploy(self):
        """The Base Rates miss: the Worker served 3 entries while its repository's main held 7."""
        topo = {"workers": [{"id": "t", "state": "live", "main": "worker/index.js", "source": {"repo": "o/t", "ref": "main"}}]}
        t = {"t": "2026-11-27T17:01:29.411Z"}
        late = d.read(topo, {}, ext=lambda r, ref: "2026-11-28T06:12:43Z" if (r, ref) == ("o/t", "main") else "x", times=t)[0]
        self.assertEqual((late["status"], late["behind"]), ("drift", 1))
        self.assertEqual(d.read(topo, {}, ext=lambda r, ref: "2026-11-27T16:00:00Z", times=t)[0]["status"], "current")
        self.assertEqual(d.read(topo, {}, ext=lambda r, ref: "2026-11-28T06:12:43Z", times={})[0]["status"], "unmeasured")
        def boom(r, ref): raise RuntimeError("404")
        self.assertEqual(d.read(topo, {}, ext=boom, times=t)[0]["status"], "unmeasured")

    def test_unknown_sha_is_unmeasured(self):
        def boom(sha, p):
            raise RuntimeError("bad object")
        self.assertEqual(d.read(TOPO, {"a": "1" * 40}, behind=boom)[0]["status"], "unmeasured")


if __name__ == "__main__":
    unittest.main()


class Redeploy(unittest.TestCase):
    def test_dispatches_only_drifted(self):
        calls = []

        class P:
            returncode = 0
            stderr = ""

        def run(cmd, **k):
            calls.append(cmd)
            return P()
        rows = [{"worker": "a", "status": "drift"}, {"worker": "b", "status": "current"}]
        self.assertEqual(d.redeploy(rows, run=run), 0)
        self.assertIn("workers=a", calls[0])
        self.assertEqual(d.redeploy([{"worker": "b", "status": "current"}], run=run), 0)
        self.assertEqual(len(calls), 1)

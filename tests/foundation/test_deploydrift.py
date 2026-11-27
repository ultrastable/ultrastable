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
        self.assertEqual(rows["c"]["status"], "external")
        self.assertEqual(rows["d"]["status"], "unmeasured")

    def test_unknown_sha_is_unmeasured(self):
        def boom(sha, p):
            raise RuntimeError("bad object")
        self.assertEqual(d.read(TOPO, {"a": "1" * 40}, behind=boom)[0]["status"], "unmeasured")


if __name__ == "__main__":
    unittest.main()

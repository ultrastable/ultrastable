# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import json, shutil, tempfile, unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
import _repo  # noqa: E402
from foundation import selfmodel as sm

REPO = Path(__file__).resolve().parents[2]


class T(unittest.TestCase):
    def test_repo_model_is_consistent(self):
        self.assertEqual(sm.check(REPO), [])

    def test_model_answers_what_it_is(self):
        m = sm.build(REPO)
        for k in ("self", "essential_variables", "fast_loop", "slow_loop", "parts", "clocks", "boundary", "inheritance", "readings"):
            self.assertIn(k, m)
        self.assertIn("improve all", m["inheritance"]["rule"].lower())
        self.assertTrue(m["fast_loop"]["regulators"])
        self.assertTrue(m["boundary"]["egress"])

    def test_every_workflow_is_in_the_model(self):
        ids = {w["id"] for w in sm.build(REPO)["parts"]["workflows"]}
        self.assertEqual(ids, set(sm.workflows(REPO)))

    def test_new_workflow_without_a_loop_fails_and_stale_data_fails(self):
        d = Path(_repo.scratch())
        for f in ("doctrine/ultrastability.json", "doctrine/topology.json", "doctrine/boundary.json", "doctrine/clocks.json", "doctrine/self-baseline.json", "site/self-data.js", "instances/ultrastable/loop-registry.json"):
            (d / f).parent.mkdir(parents=True, exist_ok=True); shutil.copy(REPO / f, d / f)
        shutil.copytree(REPO / ".github/workflows", d / ".github/workflows")
        for f in json.loads((d / "doctrine/ultrastability.json").read_text())["self"]["inheritance"]["carriers"]:
            (d / f).parent.mkdir(parents=True, exist_ok=True); shutil.copy(REPO / f, d / f)
        for st in ("doctrine/clocks.json",):
            pass
        self.assertEqual([e for e in sm.check(d) if "does not exist" not in e], [])
        (d / ".github/workflows/rogue.yml").write_text("name: rogue\n")
        errs = sm.check(d)
        self.assertTrue(any("rogue belongs to no loop" in e for e in errs))
        self.assertTrue(any("stale" in e for e in errs))


if __name__ == "__main__":
    unittest.main()

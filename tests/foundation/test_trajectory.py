# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# TRAJECTORY-1 on the platform: findings become items that close when the shape clears.
import json, sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import scratch  # removed when the test ends
from foundation import trajectory as tr

REPO = Path(__file__).resolve().parents[2]


class T(unittest.TestCase):
    def test_check(self):
        self.assertEqual(tr.check(REPO), [])

    def test_regen_renders_the_page_from_the_committed_ledger(self):
        self.assertIn("trajectory --page", (REPO / "scripts/regen_generated.sh").read_text(encoding="utf-8"))
        self.assertEqual(tr.main(["--page"]), 0)
        self.assertEqual(tr.check(REPO), [])

    def test_item_then_close_when_cleared(self):
        d = Path(scratch())
        (d / "docs/issues").mkdir(parents=True)
        f = {"kind": "neglected", "id": "loop:beat", "why": "w", "evidence": "e"}
        iid = tr._item(d, f)
        self.assertEqual(iid, "Q-TRAJ-neglected-loop-beat")
        self.assertIsNone(tr._item(d, f))  # idempotent
        self.assertEqual(tr._close_cleared(d, set(), "t"), [iid])
        self.assertIn("**Status:** closed", json.loads((d / "docs/issues" / (iid + ".json")).read_text())["body"])

    def test_probe_exit_codes(self):
        self.assertEqual(tr.probe(REPO, "hotspot:no/such/file"), 0)


if __name__ == "__main__":
    unittest.main()

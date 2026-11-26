import json, sys, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import prsize

CFG = json.loads((ROOT / "autonomy" / "prsize.json").read_text())


class PrSize(unittest.TestCase):
    def test_small_change_passes(self):
        self.assertEqual(prsize.measure("10\t2\tworker/src/a.js\n", CFG)["errors"], [])

    def test_too_many_files_fails(self):
        rows = "".join(f"1\t0\tsrc/f{i}.js\n" for i in range(CFG["max_files"] + 1))
        self.assertTrue(prsize.measure(rows, CFG)["errors"])

    def test_too_many_lines_fails(self):
        self.assertTrue(prsize.measure(f"{CFG['max_lines'] + 1}\t0\tsrc/a.js\n", CFG)["errors"])

    def test_scratch_is_banned(self):
        r = prsize.measure("1\t0\twip/session/t1/core/x.js\n", CFG)
        self.assertEqual(r["banned"], 1)
        self.assertTrue(r["errors"])

    def test_lockfile_ignored(self):
        self.assertEqual(prsize.measure("90000\t0\tpackage-lock.json\n", CFG)["errors"], [])


if __name__ == "__main__":
    unittest.main()

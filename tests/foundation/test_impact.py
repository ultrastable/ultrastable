# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import tempfile, unittest
from pathlib import Path

from foundation import impact


def _tree(d: Path):
    (d / "foundation").mkdir(); (d / "tests/foundation").mkdir(parents=True)
    (d / "foundation/a.py").write_text('"""A."""\n')
    (d / "foundation/b.py").write_text('"""B."""\nfrom . import a\n')
    (d / "foundation/c.py").write_text('"""C."""\n')
    (d / "tests/foundation/test_b.py").write_text("from foundation import b\n")
    (d / "tests/foundation/test_c.py").write_text("from foundation import c\n")


class ImpactTest(unittest.TestCase):
    def test_transitive_and_scoped(self):
        with tempfile.TemporaryDirectory() as t:
            d = Path(t); _tree(d)
            self.assertEqual(impact.affected(["foundation/a.py"], d), ["tests/foundation/test_b.py"])
            self.assertEqual(impact.affected(["foundation/c.py"], d), ["tests/foundation/test_c.py"])
            self.assertEqual(impact.affected(["tests/foundation/test_c.py"], d), ["tests/foundation/test_c.py"])

    def test_unscoped_change_runs_everything(self):
        with tempfile.TemporaryDirectory() as t:
            d = Path(t); _tree(d)
            self.assertEqual(impact.affected(["doctrine/x.json"], d), "ALL")
            self.assertEqual(impact.affected(["scripts/new.py"], d), "ALL")


if __name__ == "__main__":
    unittest.main()

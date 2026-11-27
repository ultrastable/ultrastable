# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import tempfile, unittest
from pathlib import Path

from foundation import repomap


def _tree(d: Path):
    (d / "foundation").mkdir()
    (d / "foundation/a.py").write_text('def run():\n    pass\n')
    (d / "foundation/b.py").write_text('from . import a\ndef go():\n    pass\n')
    (d / "foundation/c.py").write_text('from .a import run\n')


class RepoMapTest(unittest.TestCase):
    def test_map_and_keep(self):
        with tempfile.TemporaryDirectory() as t:
            d = Path(t); _tree(d)
            m = repomap.model(d, ":memory:")
            self.assertEqual([r["path"] for r in m.files()], ["foundation/a.py", "foundation/b.py", "foundation/c.py"])
            self.assertTrue(m.render_map(budget_tokens=1024).startswith("foundation/a.py"))  # most imported first
        self.assertFalse(repomap.keep("foundation/tests/x.py"))
        self.assertTrue(repomap.keep("seed/worker/src/tick.js"))

    def test_check_on_a_tree_and_the_real_repo(self):
        with tempfile.TemporaryDirectory() as t:
            d = Path(t); _tree(d)
            self.assertEqual(repomap.check(d), [])
        self.assertEqual(repomap.check(), [])  # P11: the real map is byte-stable across two builds


if __name__ == "__main__":
    unittest.main()

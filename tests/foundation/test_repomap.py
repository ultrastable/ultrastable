# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import tempfile, unittest
from pathlib import Path

from foundation import repomap


def _tree(d: Path):
    (d / "foundation").mkdir()
    (d / "foundation/a.py").write_text('"""A does the base work."""\ndef run():\n    pass\n')
    (d / "foundation/b.py").write_text('"""B leans on A."""\nfrom . import a\ndef go():\n    pass\n')
    (d / "foundation/c.py").write_text('"""C also leans on A."""\nfrom .a import run\n')


class RepoMapTest(unittest.TestCase):
    def test_cards_rank_and_incremental_rebuild(self):
        with tempfile.TemporaryDirectory() as t:
            d = Path(t); _tree(d)
            cards, parsed = repomap.build(d)
            self.assertEqual(parsed, 3)
            self.assertEqual(cards["foundation/a.py"]["purpose"], "A does the base work.")
            self.assertIn("foundation/a.py", cards["foundation/b.py"]["imports"])
            self.assertEqual(repomap.rank(cards)[0][0], "foundation/a.py")
            _, parsed = repomap.build(d)
            self.assertEqual(parsed, 0)  # nothing changed, nothing re-parsed
            (d / "foundation/c.py").write_text('"""C changed."""\n')
            cards, parsed = repomap.build(d)
            self.assertEqual(parsed, 1)
            self.assertEqual(cards["foundation/c.py"]["purpose"], "C changed.")
            self.assertEqual(repomap.check(d), [])

    def test_render_respects_budget_and_focus(self):
        with tempfile.TemporaryDirectory() as t:
            d = Path(t); _tree(d)
            cards, _ = repomap.build(d)
            self.assertEqual(len(repomap.render(cards, budget=16).splitlines()), 1)
            self.assertTrue(repomap.render(cards, focus=["foundation/c.py"]).startswith("foundation/c.py"))
            self.assertEqual(repomap.render(cards), repomap.render(cards))

    def test_js_imports_resolve(self):
        c = repomap.card("seed/worker/src/x/y.js", "// Y routes things.\nimport { a } from '../z.js';\nexport function route() {}\n")
        self.assertEqual(c["imports"], ["seed/worker/src/z.js"])
        self.assertEqual(c["defs"], ["route"])
        self.assertEqual(c["purpose"], "Y routes things.")


if __name__ == "__main__":
    unittest.main()

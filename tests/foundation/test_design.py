"""DESIGN-LANGUAGE-1: every theme is proven, a tenant theme derives from one colour, variation stays inside its layer, experiments are decided by rule."""
import json, random, sys, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import design as D  # noqa: E402
from tests.foundation._repo import copy_repo  # noqa: E402


class Language(unittest.TestCase):
    def test_declaration_is_complete_and_every_pair_passes(self):
        self.assertEqual(D.check(), [])

    def test_any_seed_derives_a_passing_theme(self):
        rnd = random.Random(7)
        for _ in range(150):
            seed = "#%06X" % rnd.randrange(0x1000000)
            self.assertEqual(D.prove(D.derive_theme(seed)), [], seed)

    def test_a_broken_neutral_is_caught(self):
        root = copy_repo()
        p = root / "doctrine/design.json"
        c = json.loads(p.read_text())
        c["portfolios"]["ultrastable"]["neutrals"]["light"]["ink2"] = "#BBBBBB"
        p.write_text(json.dumps(c))
        self.assertTrue(any("ink2" in b for b in D.check(root)))

    def test_product_cannot_vary_what_the_portfolio_fixes(self):
        root = copy_repo()
        p = root / "doctrine/design.json"
        c = json.loads(p.read_text())
        c["products"]["ultrastable-site"]["neutrals"] = {}
        c["products"]["ultrastable-cockpit"]["accent_seed"] = "#2F6FED"   # blue: outside the orange family
        p.write_text(json.dumps(c))
        bad = " ".join(D.check(root))
        self.assertIn("may not", bad)
        self.assertIn("degrees from the portfolio hue", bad)

    def test_css_carries_the_shared_token_contract(self):
        out = D.css(D.product_theme("ultrastable-site"))
        for k in ("--ds-accent:", "--ds-on-accent:", "--ds-surface-2:", "prefers-color-scheme:dark"):
            self.assertIn(k, out)

    def test_lint_flags_small_text_and_off_theme_colour(self):
        f = D.lint_text("<style>.a{font-size:12px;color:#123456}</style>")
        self.assertIn("text-under-14px:12px", f)
        self.assertIn("off-theme-colour:#123456", f)
        self.assertEqual(D.lint_text("<style>.a{font-size:16px;color:#14120F}</style>"), [])

    def test_lint_baseline_is_shrink_only(self):
        new, stale = D.lint_gate()
        self.assertEqual((new, stale), ([], []))


class Experiments(unittest.TestCase):
    def test_registry_is_valid(self):
        self.assertEqual(D.experiments_check(), [])

    def test_an_experiment_cannot_vary_an_invariant(self):
        root = copy_repo()
        p = root / "doctrine/design-experiments.json"
        c = json.loads(p.read_text())
        c["experiments"][0]["arms"][1]["overrides"] = {"tap_px": 30}
        p.write_text(json.dumps(c))
        self.assertTrue(any("not an allowed axis" in b for b in D.experiments_check(root)))

    def test_assignment_is_sticky_and_roughly_even(self):
        arms = ["control", "v"]
        self.assertEqual(D.assign("e", "u1", arms), D.assign("e", "u1", arms))
        n = sum(D.assign("e", f"u{i}", arms) == "v" for i in range(4000))
        self.assertTrue(1800 < n < 2200, n)

    def test_no_verdict_before_the_planned_sample(self):
        self.assertEqual(D.evaluate(100, 10, 100, 40)["verdict"], "continue")
        self.assertEqual(D.evaluate(100, 10, 100, 40, days=40)["verdict"], "inconclusive")

    def test_verdicts_follow_the_rule(self):
        self.assertEqual(D.evaluate(1000, 100, 1000, 150)["verdict"], "kept")
        self.assertEqual(D.evaluate(1000, 100, 1000, 150, guards_ok=False)["verdict"], "replaced")
        self.assertEqual(D.evaluate(1000, 100, 1000, 60)["verdict"], "replaced")
        self.assertEqual(D.evaluate(1000, 100, 1000, 102)["verdict"], "no-effect")


if __name__ == "__main__":
    unittest.main()

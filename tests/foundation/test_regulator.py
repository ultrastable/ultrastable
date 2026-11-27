# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import os
import tempfile
import unittest

from foundation.regulator import (Store, RepoModel, ConclusionCache, EssentialVariable, Registry,
                       affected_tests, ActionLedger)


def make_repo(files):
    d = tempfile.mkdtemp()
    for rel, body in files.items():
        p = os.path.join(d, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w") as f:
            f.write(body)
    return d


REPO = {
    "core/util.py": "def helper(x):\n    return x\n",
    "core/__init__.py": "",
    "api/handler.py": "from core.util import helper\n\ndef handle(req):\n    return helper(req)\n",
    "api/__init__.py": "",
    "tests/test_api.py": "from api.handler import handle\n\ndef test_h():\n    assert handle(1) == 1\n",
    "tests/test_core.py": "from core.util import helper\n\ndef test_c():\n    assert helper(2) == 2\n",
    "tools/lone.py": "def lone():\n    pass\n",
    "tests/test_lone.py": "from tools.lone import lone\n\ndef test_l():\n    lone()\n",
}


class P1RepoModel(unittest.TestCase):
    def test_incremental_update_parses_only_changed(self):
        d = make_repo(REPO)
        m = RepoModel(Store(), d)
        first = m.update()
        self.assertEqual(first["unchanged"], 0)
        again = m.update()
        self.assertEqual((again["parsed"], again["removed"]), (0, 0))
        with open(os.path.join(d, "core/util.py"), "a") as f:
            f.write("\ndef extra():\n    pass\n")
        third = m.update()
        self.assertEqual(third["parsed"], 1)
        os.remove(os.path.join(d, "tools/lone.py"))
        self.assertEqual(m.update()["removed"], 1)

    def test_module_root_changes_only_for_touched_module(self):
        d = make_repo(REPO)
        m = RepoModel(Store(), d)
        m.update()
        api_before, core_before = m.module_root("api"), m.module_root("core")
        with open(os.path.join(d, "core/util.py"), "a") as f:
            f.write("\n# edit\n")
        m.update()
        self.assertEqual(m.module_root("api"), api_before)
        self.assertNotEqual(m.module_root("core"), core_before)

    def test_map_is_byte_stable_and_budgeted(self):
        d = make_repo(REPO)
        m = RepoModel(Store(), d)
        m.update()
        a, b = m.render_map(["api/handler.py"]), m.render_map(["api/handler.py"])
        self.assertEqual(a, b)
        self.assertLessEqual(len(m.render_map(budget_tokens=20)) // 4, 40)
        self.assertIn("def helper(x)", m.render_map())


class RelativeImports(unittest.TestCase):
    def test_relative_imports_resolve(self):
        d = make_repo({"pkg/__init__.py": "from .a import f\n", "pkg/a.py": "def f():\n    pass\n",
                       "pkg/b.py": "from . import a\n", "tests/test_x.py": "from pkg import f\n"})
        m = RepoModel(Store(), d)
        m.update()
        e = m.import_edges()
        self.assertIn("pkg/a.py", e["pkg/__init__.py"])
        self.assertIn("pkg/a.py", e["pkg/b.py"])
        self.assertEqual(affected_tests(m, ["pkg/a.py"])[0], ["tests/test_x.py"])


class AbsoluteFromImport(unittest.TestCase):
    def test_from_pkg_import_module_is_an_edge(self):
        d = make_repo({"pkg/__init__.py": "", "pkg/a.py": "def f():\n    pass\n",
                       "tests/test_y.py": "from pkg import a\n"})
        m = RepoModel(Store(), d)
        m.update()
        self.assertEqual(affected_tests(m, ["pkg/a.py"])[0], ["tests/test_y.py"])


class P2Conclusions(unittest.TestCase):
    def test_hit_then_stale_on_evidence_change_then_audit_evicts(self):
        d = make_repo(REPO)
        c = ConclusionCache(Store(), d)
        c.put("Where is helper defined?", "core/util.py", ["core/util.py"])
        self.assertEqual(c.get("where is  helper defined?"), "core/util.py")  # normalized key
        with open(os.path.join(d, "core/util.py"), "a") as f:
            f.write("\n")
        self.assertIsNone(c.get("Where is helper defined?"))
        c.put("q", "a", ["core/util.py"])
        c.record_audit("q", ok=False)
        self.assertIsNone(c.get("q"))
        self.assertEqual(c.stats()["audited_bad"], 0)  # evicted row takes its counters with it


class P3Essential(unittest.TestCase):
    def setUp(self):
        self.s = Store()
        self.r = Registry(self.s, [EssentialVariable("tests_pass_rate", lo=1.0),
                                   EssentialVariable("claude_md_tokens", hi=4000)])

    def test_in_bounds_is_noop(self):
        self.r.record("global", "tests_pass_rate", 1.0)
        self.r.record("global", "claude_md_tokens", 3000)
        self.assertEqual(self.r.step(), [])

    def test_missing_reading_counts_as_breach(self):
        fired = self.r.step()
        self.assertEqual({f["why"] for f in fired}, {"missing"})

    def test_breach_walks_menu_and_resolves(self):
        self.r.record("global", "tests_pass_rate", 1.0)
        self.r.record("global", "claude_md_tokens", 9000)
        f1 = self.r.step()
        self.assertEqual(f1[0]["action"], "swap_prompt_variant")
        f2 = self.r.step()
        self.assertEqual(f2[0]["action"], "add_tool")  # first untried
        self.r.record("global", "claude_md_tokens", 2000)
        self.assertTrue(self.r.resolve("global", "claude_md_tokens"))
        self.assertEqual(self.r.step(), [])


class P7Impact(unittest.TestCase):
    def test_affected_set_is_local(self):
        d = make_repo(REPO)
        m = RepoModel(Store(), d)
        m.update()
        tests, mode = affected_tests(m, ["core/util.py"])
        self.assertEqual(mode, "impact_set")
        self.assertEqual(tests, ["tests/test_api.py", "tests/test_core.py"])  # not test_lone

    def test_unknown_file_falls_back_to_full_suite(self):
        d = make_repo(REPO)
        m = RepoModel(Store(), d)
        m.update()
        tests, mode = affected_tests(m, ["brand_new.py"])
        self.assertEqual(mode, "full_suite_fallback")
        self.assertEqual(len(tests), 3)


class P10NegativeLearning(unittest.TestCase):
    def test_retires_after_five_falling_windows_and_flags_negative_learning(self):
        l = ActionLedger(Store())
        for w, (eff, effic) in enumerate([(0.5, 1.0), (0.6, 0.9), (0.7, 0.8), (0.8, 0.7), (0.9, 0.6), (0.95, 0.5)]):
            l.record("skip_test", w, eff, effic)
            l.record("add_helper", w, 0.5, 0.5)
        self.assertEqual(l.retired(), ["skip_test"])
        self.assertTrue(l.negative_learning("skip_test"))
        self.assertFalse(l.negative_learning("add_helper"))


class Experiment1Instrumentation(unittest.TestCase):
    def test_read_share_and_cache_share(self):
        s = Store()
        s.log_tokens("t1", "api", "read", 760, 0, cache_read=500)
        s.log_tokens("t1", "api", "execute", 120, 0)
        s.log_tokens("t1", "api", "edit", 118, 2)
        self.assertAlmostEqual(s.token_share_by_kind()["read"], 0.76, places=2)
        self.assertGreater(s.cache_read_share(), 0.5)


if __name__ == "__main__":
    unittest.main()

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""MECH-FIX-1: mechanical findings are fixed by code, with no model call."""
import unittest
from pathlib import Path

from foundation import executor, mechfix
from tests.foundation._repo import scratch

ISSUE = {"number": "Q-SELF-unused-import-foundation-x-py", "title": "Q-SELF-unused-import-foundation-x-py: unused import in foundation/x.py",
         "body": "SELFCODE-1 signal `unused_import` on `foundation/x.py` (1 finding(s))."}


class Strip(unittest.TestCase):
    def test_whole_statement_goes_and_partial_statement_keeps_the_rest(self):
        src = "import os, sys\nfrom pathlib import Path\nimport json as j, re  # kept\nprint(os.sep, j)\n"
        self.assertEqual(mechfix.strip_imports(src, ["sys", "Path", "re"]), "import os\nimport json as j  # kept\nprint(os.sep, j)\n")

    def test_multi_line_from_import_is_rewritten(self):
        src = "from a import (\n    b,\n    c,\n)\nprint(b)\n"
        self.assertEqual(mechfix.strip_imports(src, ["c"]), "from a import b\nprint(b)\n")

    def test_relative_import_keeps_its_level_and_future_is_left_alone(self):
        src = "from __future__ import annotations\nfrom . import filing, ladder, queue\nqueue.run()\n"
        self.assertEqual(mechfix.strip_imports(src, ["filing", "ladder"]), "from __future__ import annotations\nfrom . import queue\nqueue.run()\n")

    def test_a_result_that_does_not_parse_raises(self):
        with self.assertRaises(SyntaxError):
            mechfix.strip_imports("import os\nprint(os.sep\n", ["os"])


class Fix(unittest.TestCase):
    def _root(self, files):
        d = Path(scratch())
        for rel, text in files.items():
            (d / rel).parent.mkdir(parents=True, exist_ok=True); (d / rel).write_text(text, encoding="utf-8")
        return d

    def test_fix_file_removes_only_what_no_other_file_reaches(self):
        d = self._root({"foundation/x.py": "import re, sys\nimport os\nprint(os.sep)\n", "tests/t.py": "from foundation import x\nx.re.compile('a')\n"})
        e = mechfix.fix_file(d, "foundation/x.py")
        self.assertEqual(e["names"], ["sys"]); self.assertEqual(e["content"], "import re\nimport os\nprint(os.sep)\n")

    def test_nothing_removable_gives_no_call_so_the_model_ladder_takes_it(self):
        d = self._root({"foundation/x.py": "import re\n", "tests/t.py": "from foundation.x import re\n"})
        self.assertIsNone(mechfix.call_for(ISSUE, d))

    def test_call_for_returns_the_edit_and_ignores_other_items(self):
        d = self._root({"foundation/x.py": "import re\nimport os\nprint(os.sep)\n"})
        out = mechfix.call_for(ISSUE, d)("prompt")
        self.assertEqual(out["files"], [{"path": "foundation/x.py", "content": "import os\nprint(os.sep)\n"}]); self.assertIn("no model call", out["summary"])
        self.assertIsNone(mechfix.call_for({**ISSUE, "number": "Q-GAP-1"}, d))
        self.assertIsNone(mechfix.call_for({**ISSUE, "body": "signal `unused_import` on `foundation/missing.py`"}, d))

    def test_executor_asks_mechfix_before_the_model_ladder(self):
        src = Path(executor.__file__).read_text(encoding="utf-8")
        self.assertLess(src.index("mechfix.call_for(issue, root)\n            if model_call"), src.index("out, meta = ladder_call(prompt, attempt, lroot)"))

    def test_every_current_finding_in_the_repository_is_fixable(self):
        from foundation import selfcode
        for f in selfcode.sense_files(mechfix.REPO):
            if f["kind"] == "unused_import":
                e = mechfix.fix_file(mechfix.REPO, f["key"])
                if e:
                    compile(e["content"], f["key"], "exec")


if __name__ == "__main__":
    unittest.main()

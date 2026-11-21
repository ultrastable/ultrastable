# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""TEMPLATE-CODE-ONLY-1: the template carries code and agent instructions only. Ultrastable is the foundation for any autonomous system."""
import json, shutil, tempfile, unittest
from pathlib import Path
from foundation import template

REPO = Path(__file__).resolve().parents[2]


class Template(unittest.TestCase):
    def test_repo_is_code_only(self):
        self.assertEqual(template.check(REPO), [])

    def test_admin_material_coming_back_fails(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            d = template.load(REPO)
            for f in d["seed_generic"]["files"] + d["agent_files"]:
                (root / f).parent.mkdir(parents=True, exist_ok=True); shutil.copy(REPO / f, root / f)
            for inst in d["instance_data"]:
                if not inst.startswith("_"):
                    (root / inst).parent.mkdir(parents=True, exist_ok=True)
                    (root / inst).mkdir() if inst.endswith("/") else (root / inst).write_text("{}")
            self.assertEqual(template.check(root, d), [])
            (root / "ip").mkdir(); (root / "ip/provisional-specification.md").write_text("x")
            (root / "seed/docs/PROJECT-MEMORY.template.md").write_text("Repo holds patent drafts.")
            bad = template.check(root, d)
            self.assertTrue(any(b.startswith("ip/:") for b in bad))
            self.assertTrue(any("provisional-specification.md" in b for b in bad))
            self.assertTrue(any("patent drafts" in b for b in bad))


if __name__ == "__main__":
    unittest.main()

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""TENANT-SYNC-1: every organization repository has a role, and the core tool the tenants vendor is present."""
import sys, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import tenantsync  # noqa: E402


class Registry(unittest.TestCase):
    def test_repository_holds(self):
        self.assertEqual(tenantsync.check(ROOT), [])

    def test_unclassified_repository_fails(self):
        import json, shutil, tempfile
        d = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, d, True)
        shutil.copytree(ROOT / "doctrine", d / "doctrine", ignore=shutil.ignore_patterns("*.jsonl")); (d / "org").mkdir()
        shutil.copy(ROOT / "org/repos.json", d / "org/repos.json"); (d / "workers/tools").mkdir(parents=True); (d / "workers/tools/tenant_sync.py").write_text("")
        reg = json.loads((d / "org/repos.json").read_text()); reg["repos"].append({"name": "newrepo"}); (d / "org/repos.json").write_text(json.dumps(reg))
        self.assertTrue(any("newrepo" in b for b in tenantsync.check(d)))

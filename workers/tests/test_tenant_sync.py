# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""TENANT-SYNC-1: drift, unregistered generic code, send-up, revendor and shim settling, on throwaway repositories."""
import json, subprocess, sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import tenant_sync as ts  # noqa: E402


def git(d, *a):
    subprocess.run(["git", "-C", str(d), "-c", "user.email=a@b", "-c", "user.name=t", *a], check=True, capture_output=True)


def mk(files, d):
    for f, t in files.items():
        p = Path(d) / f
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(t)
    git(d, "init", "-q"); git(d, "add", "-A"); git(d, "commit", "-qm", "x")


BODY = "\n".join(f"export const f{i} = {i};" for i in range(12)) + "\n"


class Sync(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.TemporaryDirectory(); self.addCleanup(self.t.cleanup)
        r = Path(self.t.name)
        self.core, self.ten = r / "core", r / "ten"
        mk({"core/a/index.js": "export const a = 1;\n", "package.json": "{}", "LICENSE": "x"}, self.core)
        mk({"ps/own.js": "// practical-solutions wellby countries\n" * 12, "ps/generic.js": BODY,
            "upstream.json": json.dumps({"schema": ts.SCHEMA, "scan_roots": ["ps"], "tokens": ["wellby"]})}, self.ten)
        ts.revendor(self.ten, self.core, apply=True)

    def test_clean_vendor_and_unregistered_generic_code_fails(self):
        bad = ts.check(self.ten)
        self.assertEqual(len(bad), 1)
        self.assertIn("ps/generic.js", bad[0])

    def test_register_then_hand_edit_is_caught(self):
        cfg = ts.load(self.ten); cfg["lifting"]["ps/generic.js"] = {"core": "core/g/generic.js", "item": "Q-1"}; ts.save(self.ten, cfg)
        self.assertEqual(ts.check(self.ten), [])
        (self.ten / "vendor/ultrastable/core/a/index.js").write_text("fork\n")
        self.assertIn("core/a/index.js", ts.check(self.ten)[0])
        self.assertEqual(ts.drift(self.ten)["tampered"], ["core/a/index.js"])

    def test_send_up_then_revendor_settles_a_shim(self):
        cfg = ts.load(self.ten); cfg["lifting"]["ps/generic.js"] = {"core": "core/g/generic.js", "item": "Q-1"}; ts.save(self.ten, cfg)
        self.assertEqual(len(ts.send_up(self.ten, self.core, apply=True)), 1)
        git(self.core, "add", "-A"); git(self.core, "commit", "-qm", "lift")
        r = ts.revendor(self.ten, self.core, apply=True)
        self.assertEqual(r["settled"], ["ps/generic.js"])
        self.assertIn("export * from", (self.ten / "ps/generic.js").read_text())
        self.assertEqual(ts.load(self.ten)["lifted"], {"ps/generic.js": "core/g/generic.js"})
        self.assertEqual(ts.check(self.ten), [])

    def test_held_entry_is_not_sent(self):
        cfg = ts.load(self.ten); cfg["lifting"]["ps/generic.js"] = {"core": "core/g/generic.js", "item": "Q-1", "hold": "other thread"}; ts.save(self.ten, cfg)
        self.assertEqual(ts.send_up(self.ten, self.core), [])

    def test_import_rewrite(self):
        cfg = {"vendor_dir": "vendor/ultrastable"}
        out = ts.rewrite_imports("import { a } from '../vendor/ultrastable/core/_shared/x.js';", "ps/m.js", "core/auth/m.js", cfg)
        self.assertIn("'../_shared/x.js'", out)


if __name__ == "__main__":
    unittest.main()

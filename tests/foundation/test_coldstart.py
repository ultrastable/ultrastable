# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""COLDSTART-1: the cold-start contract holds on this repository, and each guard fails on the defect it names."""
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from foundation import coldstart as cs
from foundation.__main__ import resolve, ARGPARSE_COMMANDS

ROOT = Path(__file__).resolve().parents[2]


class Repo(unittest.TestCase):
    def test_contract_holds(self):
        self.assertEqual(cs.check(), [])

    def test_every_module_with_main_is_a_command(self):
        # the root cause behind detector static-content: a module existed but the CLI's hand-kept list never named it
        self.assertIsNotNone(resolve("staticcontent"))
        self.assertIsNone(resolve("no_such_module"))
        self.assertIsNone(resolve("../etc"))
        self.assertIn("doctrine", ARGPARSE_COMMANDS)

    def test_health_only_seed_opens_every_live_path(self):
        opened = cs.public_reads()
        for cap in cs.load()["capabilities"]:
            if cap.get("live"):
                self.assertIn(cap["live"]["path"], opened, cap["id"])


class Guards(unittest.TestCase):
    def _copy(self):
        d = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, d, True)
        for rel in ["doctrine/coldstart.json", "doctrine/schemas/coldstart.schema.json", "docs/doctrine/SYSTEM.md", "seed/doctrine/SYSTEM.md", "seed/worker/src/ignition.js", "seed/worker/src/visibility.js", "seed/worker/src/index.js", "agents/AGENTS.md", "seed/agents/AGENTS.md", "CLAUDE.md", "seed/CLAUDE.md"]:
            (d / rel).parent.mkdir(parents=True, exist_ok=True); shutil.copy(ROOT / rel, d / rel)
        return d

    def test_missing_seed_file_and_hidden_path_fail(self):
        d = self._copy()
        c = json.loads((d / cs.CONTRACT).read_text())
        c["capabilities"] = [{"id": "x", "rule": "R-1", "seed": ["seed/nope.js"], "live": {"path": "/secret", "status": [200]}, "step": "nope"}]
        bad = cs.check_capabilities(c, d)
        self.assertTrue(any("seed/nope.js" in b for b in bad)); self.assertTrue(any("/secret" in b for b in bad)); self.assertTrue(any("'nope'" in b for b in bad))

    def test_unresolvable_command_fails(self):
        d = self._copy()
        (d / "doctrine" / "x.json").write_text('{"run": "python3 -m foundation hostsync --check"}')
        c = cs.load(d); c["command_refs"]["globs"] = ["doctrine/x.json"]
        self.assertTrue(any("hostsync" in b for b in cs.check_commands(c, d)))

    def test_rule_missing_from_seed_and_duplicate_bullet_fail(self):
        d = self._copy()
        p = d / "agents/AGENTS.md"
        p.write_text(p.read_text() + "\n- **New rule (BRAND-NEW-1, Rowan 2026-11-25).** x\n- **New rule (BRAND-NEW-1, Rowan 2026-11-25).** x\n")
        bad = cs.check_instructions(cs.load(d), d)
        self.assertTrue(any("BRAND-NEW-1" in b and "not in the seed" in b for b in bad)); self.assertTrue(any("appears 2 times" in b for b in bad))

    def test_broken_import_fails(self):
        d = self._copy()
        (d / "CLAUDE.md").write_text("@docs/missing.md\n")
        self.assertTrue(any("@docs/missing.md" in b for b in cs.check_instructions(cs.load(d), d)))


class Definition(unittest.TestCase):
    _copy = Guards._copy

    def test_seed_copy_must_match_and_name_every_stage(self):
        d = self._copy()
        (d / "seed/doctrine/SYSTEM.md").write_text("an older definition\n")
        p = d / "docs/doctrine/SYSTEM.md"
        p.write_text(p.read_text().replace("`self-sustaining`", "self sustaining"))
        bad = cs.check_definition(cs.load(d), d)
        self.assertTrue(any("differs" in b for b in bad)); self.assertTrue(any("`self-sustaining`" in b for b in bad))

    def test_claude_md_must_import_it(self):
        d = self._copy()
        (d / "seed/CLAUDE.md").write_text("@agents/AGENTS.md\n")
        self.assertTrue(any("seed/CLAUDE.md" in b for b in cs.check_definition(cs.load(d), d)))

    def test_contract_is_schema_valid_and_a_bad_one_is_not(self):
        d = self._copy()
        self.assertEqual(cs.check_schema(cs.load(d), d), [])
        c = cs.load(d); c["capabilities"][0]["live"] = {"path": "no-slash", "status": []}
        self.assertTrue(cs.check_schema(c, d))

    def test_stages_come_from_the_code(self):
        self.assertEqual(cs.ignition_stages()[-2:], ["critical", "self-sustaining"])


class Live(unittest.TestCase):
    def test_probe_reads_each_live_path(self):
        seen = []
        def get(url):
            seen.append(url)
            if url.endswith("/"):
                return 200, "text/html; charset=utf-8", b"<html></html>"
            if url.endswith("/.well-known/ultrastable.json"):
                return 404, "text/plain", b"Not found"
            return 200, "application/json", b"{}"
        rows = cs.live("https://seed.example", get=get)
        self.assertEqual(len(seen), sum(1 for c in cs.load()["capabilities"] if c.get("live")))
        bad = [r for r in rows if not r["ok"]]
        self.assertEqual([r["capability"] for r in bad], ["discoverable"])


if __name__ == "__main__":
    unittest.main()

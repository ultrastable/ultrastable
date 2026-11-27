# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SYSTEM-SPEC-1: the kit carries its own definition, generated from its code, and every clause is probed here."""
import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path

KIT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("system", KIT / "scripts" / "system.py")
system = importlib.util.module_from_spec(spec)
spec.loader.exec_module(system)


class SystemSpec(unittest.TestCase):
    def test_kit_passes_its_own_definition(self):
        self.assertEqual(system.check(KIT), [])

    def test_definition_covers_identity_run_bootstrap_autonomy_and_rules(self):
        md = (KIT / "SYSTEM.md").read_text()
        for h in ("## What an Ultrastable system is", "## How it runs", "## How it bootstraps", "## How it becomes autonomous and reaches criticality", "## Standing rules"):
            self.assertIn(h, md)
        for word in ("`self-sustaining`", "`year_gate`", "`ignition`", "k_eff"):
            self.assertIn(word, md)

    def test_every_agent_entry_point_loads_it(self):
        # AGENT-ENTRY-1: CLAUDE.md loads the short entry, and the entry names the definition for the work that needs it
        self.assertEqual((KIT / "CLAUDE.md").read_text().strip(), "@AGENTS.md")
        self.assertIn("](SYSTEM.md)", (KIT / "AGENTS.md").read_text())

    def _copy(self):
        d = Path(tempfile.mkdtemp()); self.addCleanup(shutil.rmtree, d, True)
        dst = d / "kit"
        shutil.copytree(KIT, dst, ignore=shutil.ignore_patterns("node_modules", "__pycache__", "org"))
        return dst

    def test_files_a_boot_writes_do_not_make_the_definition_stale(self):
        k = self._copy()  # CLEANROOM-1 finding: org/owner-status.json appears at boot and used to change a rule's citation list
        (k / "org").mkdir(exist_ok=True)
        (k / "org" / "owner-status.json").write_text("{}\n")
        self.assertEqual(system.check(k), [])

    def test_a_clause_whose_code_is_gone_fails(self):
        k = self._copy()
        (k / "worker" / "src" / "ignition.js").write_text("// removed\n")
        errs = system.check(k)
        self.assertTrue(any(e.startswith("AUT-1") for e in errs), errs)

    def test_a_new_rule_with_no_enforcement_in_the_kit_fails(self):
        k = self._copy()
        a = k / "agents" / "AGENTS.md"
        a.write_text(a.read_text() + "\n- **A new rule (NEW-RULE-1, test).** Enforced by `foundation/nowhere.py`.\n")
        self.assertTrue(any(e.startswith("NEW-RULE-1") for e in system.check(k)))

    def test_not_in_kit_only_shrinks(self):
        k = self._copy()
        p = k / "autonomy" / "system.json"
        d = json.loads(p.read_text()); d["not_in_kit"].append("CLAIMS-1"); p.write_text(json.dumps(d))
        self.assertTrue(any("not_in_kit lists rules" in e for e in system.check(k)))

    def test_stale_document_fails(self):
        k = self._copy()
        (k / "SYSTEM.md").write_text("# hand edited\n")
        self.assertTrue(any("SYSTEM.md is stale" in e for e in system.check(k)))


if __name__ == "__main__":
    unittest.main()

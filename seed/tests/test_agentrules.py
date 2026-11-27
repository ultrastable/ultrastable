# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# AGENT-ENTRY-1 in the seed: an agent loads one short entry file and fetches the standing rules for the paths it will change.
import json, sys, tempfile, unittest
from pathlib import Path
SEED = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SEED / "scripts"))
import agentrules as A

RULES = """# rules
- **Words match code (CLAIMS-1, Rowan 2026-11-17).** Statements are bound to probes. `python3 scripts/claims.py --check` runs on every change. Code: `seed/scripts/claims.py`, `doctrine/claims.json`.
- **Never handle secret values.** Reference secrets by binding name.
- **The lane merges on green (LANE-1, GREEN-GUARD-1, Rowan 2026-11-18).** Code: `seed/worker/src/lane.js`, `seed/worker/src/greenguard.js`, workflow `checks.yml`; tests `seed/worker/test/`.
> CLOSED-LOOP-AXIOM: Every loop is closed by the system itself. Enforced by `python3 -m foundation closedloop --check` (doctrine/closed-loop.json).
- **Words match code (CLAIMS-1, Rowan 2026-11-17).** The same bullet restated lower in the file.
"""


def kit(d, agents="# AGENTS.md\nRun `python3 scripts/agentrules.py --for PATH`. Read [`SYSTEM.md`](SYSTEM.md) and `agents/AGENTS.md`.\n", claude="@AGENTS.md\n", **cfg):
    d = Path(d)
    (d / "agents").mkdir(); (d / "autonomy").mkdir()
    (d / "agents/AGENTS.md").write_text(RULES)
    (d / "AGENTS.md").write_text(agents); (d / "CLAUDE.md").write_text(claude); (d / "SYSTEM.md").write_text("# system\n")
    c = {"entries": ["CLAUDE.md", "AGENTS.md"], "rules": "agents/AGENTS.md", "path_prefix": "seed/", "max_closure_bytes": 2000, "max_lines": 20,
         "min_rules": 3, "must_name": ["SYSTEM.md", "agents/AGENTS.md"], "must_say": ["agentrules.py --for"], **cfg}
    (d / A.CONFIG).write_text(json.dumps(c))
    return d


class Rules(unittest.TestCase):
    def test_parse_gives_each_rule_an_id_its_paths_and_its_checks(self):
        rs = A.parse(RULES)
        self.assertEqual([r["id"] for r in rs], ["CLAIMS-1", "never-handle-secret-values", "LANE-1", "CLOSED-LOOP-AXIOM"])  # the restated bullet is not a second rule
        claims = rs[0]
        self.assertEqual((claims["title"], claims["line"]), ("Words match code", 2))
        self.assertEqual(claims["paths"], ["doctrine/claims.json", "seed/scripts/claims.py"])
        self.assertEqual(claims["checks"], ["python3 scripts/claims.py --check"])
        self.assertEqual(rs[2]["ids"], ["LANE-1", "GREEN-GUARD-1"])

    def test_rules_are_found_by_file_directory_bare_name_and_kit_relative_path(self):
        rs = A.parse(RULES)
        ids = lambda *p, prefix="": [r["id"] for _, r in A.for_paths(rs, list(p), prefix)]
        self.assertEqual(ids("seed/worker/src/greenguard.js"), ["LANE-1"])
        self.assertEqual(ids("worker/src/greenguard.js", prefix="seed/"), ["LANE-1"], "a kit spells the path without the platform's seed/ prefix")
        self.assertEqual(ids("seed/worker/test/lane.test.js"), ["LANE-1"], "a file under a directory the rule names")
        self.assertEqual(ids("seed/worker"), ["LANE-1"], "a directory above a file the rule names")
        self.assertEqual(ids(".github/workflows/checks.yml"), ["LANE-1"], "the rule names the file without its directory")
        self.assertEqual(ids("doctrine/claims.json", "seed/worker/src/lane.js"), ["LANE-1", "CLAIMS-1"], "most specific match first")
        self.assertEqual(ids("README.md"), [])

    def test_find_by_any_id_or_a_word_of_the_title(self):
        rs = A.parse(RULES)
        self.assertEqual(A.find(rs, "green-guard-1")[0]["id"], "LANE-1")
        self.assertEqual(A.find(rs, "secret")[0]["id"], "never-handle-secret-values")
        self.assertEqual(A.find(rs, "NOPE-9"), [])


class Entry(unittest.TestCase):
    def test_a_short_entry_that_names_its_documents_passes(self):
        with tempfile.TemporaryDirectory() as d:
            root = kit(d)
            self.assertEqual(A.check(root), [])
            b = A.budget(root)["entries"]
            self.assertEqual(b["CLAUDE.md"]["files"], ["CLAUDE.md", "AGENTS.md"], "an @import is loaded, so it is counted")
            self.assertIn("SYSTEM.md", A.named(root, "CLAUDE.md"))

    def test_an_import_of_the_rule_file_breaks_the_budget(self):
        with tempfile.TemporaryDirectory() as d:
            root = kit(d, claude="@AGENTS.md\n@agents/AGENTS.md\n", max_closure_bytes=600)
            self.assertTrue(any("CLAUDE.md: loads" in b and "agents/AGENTS.md" in b for b in A.check(root)))

    def test_too_many_lines_a_missing_document_and_a_missing_command_each_fail(self):
        with tempfile.TemporaryDirectory() as d:
            root = kit(d, agents="# AGENTS.md\n" + "line\n" * 30)
            bad = "\n".join(A.check(root))
            self.assertIn("lines, over the 20-line budget", bad)
            self.assertIn("does not name SYSTEM.md", bad)
            self.assertIn("does not say `agentrules.py --for`", bad)

    def test_a_rule_file_that_changed_shape_fails(self):
        with tempfile.TemporaryDirectory() as d:
            root = kit(d, min_rules=50)
            self.assertTrue(any("the rule file changed shape" in b for b in A.check(root)))

    def test_the_cli_prints_rules_for_a_path_and_one_rule_in_full(self):
        import contextlib, io
        with tempfile.TemporaryDirectory() as d:
            root = kit(d)
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(A.main(["--for", "worker/src/lane.js"], root=root), 0)
                self.assertEqual(A.main(["--show", "CLAIMS-1"], root=root), 0)
                self.assertEqual(A.main(["--show", "NOPE-9"], root=root), 1)
                self.assertEqual(A.main(["--chekc"], root=root), 2)
            self.assertIn("LANE-1: The lane merges on green (4)", out.getvalue())
            self.assertIn("Statements are bound to probes.", out.getvalue())


class Kit(unittest.TestCase):
    def test_this_kit_is_inside_its_budget_and_its_rules_are_fetchable(self):
        self.assertEqual(A.check(SEED), [])
        self.assertEqual((SEED / "CLAUDE.md").read_text().strip(), "@AGENTS.md")
        cfg = A.load(SEED)
        self.assertLessEqual(cfg["max_closure_bytes"], 32768, "Codex stops reading project instructions at 32 KiB")
        self.assertLessEqual(cfg["max_lines"], 200, "Claude Code's guidance for one instruction file")
        hits = [r["id"] for _, r in A.for_paths(A.rules(SEED), ["worker/src/greenguard.js"], cfg["path_prefix"])]
        self.assertIn("WORK-NOT-PULSE-1", hits)


if __name__ == "__main__":
    unittest.main()

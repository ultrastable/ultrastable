# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gaplint.cli import main, run  # noqa: E402
from gaplint.config import load  # noqa: E402

GOOD_GAP = """# Gaps
## BG-1: portal down (2026-11-10)
Symptom: portal answers 503. Surfaces tried: web, API. Fix in code: retry with backoff.
Default in effect: draft stays local. Closing probe: curl returns 200.
"""
BAD_GAP = "# Gaps\n## BG-2: thing broke\nSymptom: it broke.\n"
RULES_OK = ("Code is all that matters.\nIf it is not in code, it does not exist.\nNever swallow an error.\n")


def make(files):
    d = tempfile.TemporaryDirectory()
    for rel, text in files.items():
        p = Path(d.name) / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    return d


def ids(root, **over):
    cfg = load(root)
    cfg.update(over)
    return [f.rule for f in run(root, cfg)]


class Tagline(unittest.TestCase):
    def test_missing_tagline_flagged_and_present_passes(self):
        d = make({"README.md": "Ultrastable is the foundation for any autonomous system.\n", "x/README.md": "nothing\n"})
        cfg = load(Path(d.name))
        cfg["rules"] = ["GL008"]
        cfg["tagline"]["files"] = ["README.md", "x/README.md"]
        got = [(f.rule, f.path) for f in run(Path(d.name), cfg)]
        self.assertEqual(got, [("GL008", "x/README.md")])


class Rules(unittest.TestCase):
    def test_clean_repo(self):
        d = make({"docs/BOOTSTRAP-GAPS.md": GOOD_GAP, "agents/AGENTS.md": RULES_OK,
                  "docs/PROJECT-MEMORY.md": "Last updated: 2026-11-10\n"})
        self.assertEqual(ids(Path(d.name)), [])

    def test_incomplete_gap_flags_three_fields(self):
        d = make({"docs/BOOTSTRAP-GAPS.md": BAD_GAP})
        f = [x for x in run(Path(d.name), load(Path(d.name))) if x.rule == "GL001"]
        self.assertEqual(len(f), 3)  # fix, default, probe

    def test_closed_gap_is_skipped(self):
        d = make({"docs/BOOTSTRAP-GAPS.md": "## BG-3: old (closed)\nSymptom: x\n"})
        self.assertNotIn("GL001", ids(Path(d.name)))

    def test_owner_card_needs_default_and_probe(self):
        d = make({"a/OWNER-CARD.md": "Do the thing.\n"})
        self.assertEqual(ids(Path(d.name)).count("GL002"), 2)
        d2 = make({"a/OWNER-CARD.md": "Default in effect: none. Closing probe: file exists.\n"})
        self.assertNotIn("GL002", ids(Path(d2.name)))

    def test_missing_code_first_rule(self):
        d = make({"agents/AGENTS.md": "If it is not in code, it does not exist. Never swallow an error.\n"})
        msgs = [f.message for f in run(Path(d.name), load(Path(d.name))) if f.rule == "GL003"]
        self.assertEqual(len(msgs), 1)
        self.assertIn("code is all that matters", msgs[0])

    def test_agent_rules_accepts_a_list_of_specs(self):
        d = make({"a/AGENTS.md": "Code is all that matters.\n", "b/AGENTS.md": "nothing\n"})
        root = Path(d.name)
        cfg = load(root)
        cfg["rules"] = ["GL003"]
        cfg["agent_rules"] = [{"files": ["a/AGENTS.md"], "required": {"code": "code is all"}},
                              {"files": ["b/AGENTS.md"], "required": {"code": "code is all"}}]
        self.assertEqual([f.path for f in run(root, cfg)], ["b/AGENTS.md"])

    def test_person_as_actor(self):
        d = make({"docs/handoff/x.md": "Next: needs you to click.\nAll good.\nLet me know if ok.\n"})
        self.assertEqual(ids(Path(d.name)).count("GL004"), 2)

    def test_secret_detected(self):
        d = make({"x.txt": "token=" + "ghp_" + "a" * 36 + "\n"})
        self.assertIn("GL006", ids(Path(d.name)))

    def test_memory_needs_date(self):
        d = make({"docs/PROJECT-MEMORY.md": "no date\n"})
        self.assertIn("GL007", ids(Path(d.name)))

    def test_public_safe_banned_terms(self):
        d = make({"public/a.html": "<p>safe</p>\n<p>secret sauce</p>\n"})
        root = Path(d.name)
        cfg = load(root)
        cfg["rules"] = ["GL005"]
        cfg["public_safe"] = {"files": ["public/*"], "banned": ["secret sauce"]}
        f = run(root, cfg)
        self.assertEqual([(x.rule, x.line) for x in f], [("GL005", 2)])

    def test_config_override_and_cli_exit_code(self):
        d = make({"docs/BOOTSTRAP-GAPS.md": BAD_GAP,
                  "gaplint.json": json.dumps({"rules": ["GL001"], "gap_entries": {"required": {"symptom": ["symptom"]}}})})
        self.assertEqual(main([d.name]), 0)
        d2 = make({"docs/BOOTSTRAP-GAPS.md": BAD_GAP, "gaplint.json": json.dumps({"rules": ["GL001"]})})
        self.assertEqual(main([d2.name]), 1)


class SelfClosed(unittest.TestCase):
    """GL010 (SELF-CLOSED-LOOPS-1), US-23-R04: agent files carry the rule; handoff files do not wait on a person."""

    def cfg(self, d, **extra):
        cfg = load(Path(d.name))
        cfg["rules"] = ["GL010"]
        cfg["self_closed"] = {"required_in": ["agents/AGENTS.md"], "scan": ["docs/handoff/*.md"], **extra}
        return cfg

    def test_a_missing_rule_and_text_that_waits_on_a_person_are_flagged(self):
        d = make({"agents/AGENTS.md": "x\n", "docs/handoff/a.md": "pending owner decision on X\n"})
        self.assertEqual([f.rule for f in run(Path(d.name), self.cfg(d))], ["GL010", "GL010"])

    def test_a_clean_repository_passes_and_an_identity_gate_line_is_exempt(self):
        d = make({"agents/AGENTS.md": "SELF-CLOSED-LOOPS-1\n", "docs/handoff/a.md": "system proceeds on the default\nIC-GATE-001: pending owner decision on signing\n"})
        self.assertEqual(list(run(Path(d.name), self.cfg(d))), [])

    def test_owner_to_decide_is_matched(self):
        d = make({"agents/AGENTS.md": "SELF-CLOSED-LOOPS-1\n", "docs/handoff/a.md": "waiting for the owner to decide\nleft for the owner to approve\n"})
        self.assertEqual(len(list(run(Path(d.name), self.cfg(d)))), 2)

    def test_gl010_is_off_by_default_and_named_in_the_rule_table(self):
        from gaplint.rules import RULES
        self.assertIn("GL010", RULES)
        self.assertNotIn("GL010", load(Path(tempfile.mkdtemp()))["rules"])


class AutonomyLine(unittest.TestCase):
    """GL008: with a doctrine file that carries an `autonomy` block, the autonomy line must be present in its files."""

    def test_the_autonomy_line_is_required_where_the_doctrine_says(self):
        doctrine = {"tagline": "Ultrastable is the foundation for any autonomous system", "pattern": r"foundation\s+for\s+any\s+autonomous\s+system",
                    "inject": {"md_files": ["README.md"], "check_only": []},
                    "autonomy": {"tagline": "A system is autonomous if it has self-referential loops", "pattern": r"self-referential\s+loops", "md_files": ["README.md"], "check_only": []}}
        d = make({"doctrine/positioning.json": json.dumps(doctrine), "README.md": "Ultrastable is the foundation for any autonomous system.\n"})
        cfg = load(Path(d.name)); cfg["rules"] = ["GL008"]; cfg["tagline"]["doctrine"] = "doctrine/positioning.json"
        found = list(run(Path(d.name), cfg))
        self.assertEqual([(f.rule, f.message[:21]) for f in found], [("GL008", "autonomy line missing")])
        (Path(d.name) / "README.md").write_text("Ultrastable is the foundation for any autonomous system. It has self-referential loops.\n", encoding="utf-8")
        self.assertEqual(list(run(Path(d.name), cfg)), [])


class SelfApplication(unittest.TestCase):
    """US-23-R04, US-23-R07: gaplint run on the checkout it ships in, with the configuration that names what this repository's contract carries."""
    ROOT = Path(__file__).resolve().parents[3]

    def test_gaplint_with_configs_workers_exits_0_on_this_checkout(self):
        cfg = Path(__file__).resolve().parents[1] / "configs" / "workers.json"
        if not (self.ROOT / "agents" / "CONTRACT.md").exists():
            self.skipTest("not inside the workers checkout")
        self.assertEqual(main([str(self.ROOT), "--config", str(cfg)]), 0)

    def test_the_workers_configuration_fails_when_the_contract_loses_a_rule(self):
        cfg = Path(__file__).resolve().parents[1] / "configs" / "workers.json"
        d = make({"AGENTS.md": "Work is an item. Nothing exists only in chat.\n", "agents/CONTRACT.md": "x\n"})
        found = list(run(Path(d.name), load(Path(d.name), cfg)))
        self.assertTrue(any(f.rule == "GL003" for f in found))
        self.assertTrue(any(f.rule == "GL010" for f in found))


if __name__ == "__main__":
    unittest.main()

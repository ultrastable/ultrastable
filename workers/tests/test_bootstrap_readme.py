# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""US-19-R17, T19-6 and US-10-R15: the owner README has five parts in plain words, and every owner card carries a plain `say` line."""
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bootstrap"))
sys.path.insert(0, str(ROOT / "tests"))
import bootstrap as bs  # noqa: E402
from ownerdoc import parse_help  # noqa: E402
from test_seed import Hermetic, copy_seed  # noqa: E402

HELP_TITLES = [s["title"] for s in parse_help((ROOT / "docs" / "help.md").read_text(encoding="utf-8"))]
PARTS = ["What is running", "What it costs and what stops it", "What only you can do", "How to stop and delete it"]
ENV_NAME = re.compile(r"\b[A-Z][A-Z0-9]+_[A-Z0-9_]+\b")
DEVELOPER_WORDS = re.compile(r"\b(mint|token|secret|wrangler|npm|npx|command|terminal|env)\b|`|\.py\b|\.json\b", re.I)


def boot(budget: str):
    t = tempfile.TemporaryDirectory()
    d = Path(t.name)
    copy_seed(d)
    idea = d / "IDEA.md"
    idea.write_text(idea.read_text().replace("50 USD", f"{budget} USD"))
    assert bs.main(["--root", str(d), "--dry-run"]) == 0
    return t, d


def own_part(readme: str) -> str:
    """Everything before the first help section: the part this module writes."""
    cut = min(readme.index("## " + t) for t in HELP_TITLES)
    return readme[:cut]


class OwnerReadmeParts(Hermetic):
    def test_US_19_R17_readme_has_the_five_parts_in_order(self):
        t, d = boot("50")
        with t:
            r = (d / "org/README.md").read_text(encoding="utf-8")
            heads = [r.index("## " + p) for p in PARTS]
            self.assertEqual(heads, sorted(heads))
            self.assertIn("## The idea", r)
            self.assertLess(heads[-1], min(r.index("## " + h) for h in HELP_TITLES))

    def test_US_19_R17_cost_part_states_the_budget_and_the_free_default(self):
        for budget, expect in (("50", "up to 50 USD a month"), ("0", "limit of zero")):
            t, d = boot(budget)
            with t:
                r = (d / "org/README.md").read_text(encoding="utf-8")
                cost = r[r.index("## What it costs and what stops it"):r.index("## What only you can do")]
                self.assertIn(expect, cost)
                self.assertIn("free", cost)
                self.assertIn("stops at its daily limits", cost)

    def test_US_19_R17_stop_part_names_where_to_delete_it(self):
        t, d = boot("50")
        with t:
            r = (d / "org/README.md").read_text(encoding="utf-8")
            stop = r[r.index("## How to stop and delete it"):]
            stop = stop[:stop.index("\n## ", 5)]
            for word in ("sign in", "Workers", "delete", "database", "repositories"):
                self.assertIn(word, stop)

    def test_US_10_R15_readme_has_no_variable_names_and_no_developer_words_outside_the_help_sections(self):
        for budget in ("50", "0"):
            t, d = boot(budget)
            with t:
                mine = own_part((d / "org/README.md").read_text(encoding="utf-8"))
                self.assertIsNone(ENV_NAME.search(mine), ENV_NAME.search(mine))
                self.assertIsNone(DEVELOPER_WORDS.search(mine), DEVELOPER_WORDS.search(mine))

    def test_US_10_R15_every_card_has_plain_say_and_keeps_id_default_and_probe(self):
        t, d = boot("50")
        with t:
            cards = json.loads((d / "org/gate-cards.json").read_text())
            self.assertTrue(cards)
            for c in cards:
                self.assertTrue(c.get("say"), f"{c['id']} lacks say")
                self.assertTrue(c["default_in_effect"] and c["closing_probe"], c["id"])
                self.assertIsNone(ENV_NAME.search(c["say"]), c["say"])
                self.assertIsNone(DEVELOPER_WORDS.search(c["say"]), c["say"])
            by_id = {c["id"]: c for c in cards}
            self.assertEqual(by_id["GATE-SECRET-CLOUDFLARE_API_TOKEN"]["closing_probe"], "env:CLOUDFLARE_API_TOKEN")
            self.assertIn("CLOUDFLARE_API_TOKEN", by_id["GATE-SECRET-CLOUDFLARE_API_TOKEN"]["what"])  # the machine text is unchanged
            self.assertEqual(by_id["GATE-SECRET-ANTHROPIC_API_KEY"]["say"],
                             "Let the system use an AI model provider (free models are used until you do)")
            self.assertEqual(by_id["GATE-BUDGET"]["say"], "Approve what the system may spend a month: 50 USD")

    def test_US_10_R15_the_boot_report_names_no_flag_mode_or_variable(self):
        t, d = boot("50")
        with t:
            rep = (d / "org/boot-report.md").read_text(encoding="utf-8")
            self.assertEqual(len(rep.strip().splitlines()), 4, rep)
            self.assertIsNone(ENV_NAME.search(rep), rep)
            self.assertNotRegex(rep, r"--\w|(?i:dry[- ]?run)|\{'", "no flag, no machine mode and no raw dictionary")
            self.assertIn("Sign in to your hosting account so the system can run it", rep)

    def test_US_10_R15_the_readme_lists_the_say_lines_not_the_machine_text(self):
        t, d = boot("50")
        with t:
            r = (d / "org/README.md").read_text(encoding="utf-8")
            self.assertIn("Sign in to your hosting account so the system can run it", r)
            self.assertNotIn("CLOUDFLARE_API_TOKEN", r)

    def test_US_10_R15_every_card_has_a_plain_default_and_the_whole_readme_is_free_of_capability_jargon(self):
        t, d = boot("50")
        with t:
            cards = json.loads((d / "org/gate-cards.json").read_text())
            r = (d / "org/README.md").read_text(encoding="utf-8")
            jargon = re.compile(r"dry[- ]run|stay in dry|\brepo\b|\bdns\b|\bruntime\b", re.I)
            for c in cards:
                self.assertTrue(c.get("say_default"), f"{c['id']} lacks say_default")
                self.assertIsNone(jargon.search(c["say_default"]), c["say_default"])
                self.assertIsNone(DEVELOPER_WORDS.search(c["say_default"]), c["say_default"])
                self.assertIn(c["say_default"], r, f"{c['id']} is missing from the owner README, even when added after the write stage")
            self.assertIn("GATE-LADDER", {c["id"] for c in cards}, "this scenario needs a card added after write()")
            self.assertIsNone(ENV_NAME.search(r), ENV_NAME.search(r))
            self.assertIsNone(jargon.search(own_part(r)), jargon.search(own_part(r)))
            self.assertNotRegex(r, r"(?i)paste (it|a (new )?key)")


if __name__ == "__main__":
    unittest.main()

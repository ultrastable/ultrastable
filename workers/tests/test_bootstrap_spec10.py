# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""US-SPEC-10 requirements that the older bootstrapper tests prove without naming them: the ladder (R26, T10), the temporary account
route (R28), the case library (R29) and the scaffold stage (R30). Hermetic: no wrangler session, no credential, no network."""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bootstrap"))
sys.path.insert(0, str(ROOT / "tests"))
import bootstrap as bs  # noqa: E402
import cases as case_library  # noqa: E402
import ladder  # noqa: E402
from test_seed import Hermetic, copy_seed  # noqa: E402

ACCT, OTHER = "a" * 32, "b" * 32


def fake(outputs):
    calls = []

    def run(cmd, env=None, timeout=None):
        calls.append(cmd[-1])
        return SimpleNamespace(returncode=0, stdout=outputs.get(cmd[-1], ""), stderr="")
    return run, calls


class LadderRoutes(unittest.TestCase):
    def test_US_10_R26_the_routes_are_tried_in_order_and_each_failure_has_a_recorded_reason(self):
        run, _ = fake({"whoami": "You are not authenticated. Please run `wrangler login`."})
        r = ladder.run_ladder(run, {})
        self.assertIsNone(r["route"])
        self.assertEqual([a["rung"] for a in r["attempts"]], ["connect", "temporary", "scoped-token"])
        self.assertTrue(all(a["reason"] for a in r["attempts"]))
        self.assertEqual(ladder.gate_card(r)["id"], "GATE-LADDER")
        self.assertIn("say", ladder.gate_card(r))

    def test_US_10_T10_US_10_R26_a_token_for_another_account_is_refused_and_nothing_is_deployed(self):
        run, _ = fake({"whoami": f"logged in OAuth {OTHER}"})
        r = ladder.run_ladder(run, {"CLOUDFLARE_API_TOKEN": "x", "CLOUDFLARE_ACCOUNT_ID": OTHER}, target=ACCT)
        self.assertIsNone(r["route"])
        failed = [a for a in r["attempts"] if a.get("code") == "account_mismatch"]
        self.assertTrue(failed, r["attempts"])
        self.assertEqual(r["account_guard"]["target"], ACCT)
        self.assertTrue(r["account_guard"]["mismatch"])
        self.assertEqual(r["env"], {}, "no environment extra is carried for a refused account")

    def test_US_10_R26_a_working_session_for_the_target_account_is_the_route(self):
        run, _ = fake({"whoami": f"You are logged in with an OAuth Token. {ACCT}"})
        r = ladder.run_ladder(run, {}, target=ACCT)
        self.assertEqual((r["route"], r["env"]), ("connect", {"CLOUDFLARE_ACCOUNT_ID": ACCT}))


class TemporaryRoute(Hermetic):
    def test_US_10_R28_a_temporary_account_gets_no_cron_the_alarm_tick_and_no_database_id(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            copy_seed(root)
            self.assertEqual(bs.main(["--root", str(root), "--dry-run", "--temporary"]), 0)
            wr = (root / "adapters/cloudflare/wrangler.jsonc").read_text()
            self.assertNotIn('"triggers"', wr)
            self.assertIn('"workers_dev": true', wr)
            self.assertIn('"TICK_MODE": "alarm"', wr)
            self.assertNotIn("database_id", wr)

    def test_US_10_R28_the_commands_run_in_the_order_a_temporary_account_needs_with_the_key_on_standard_input(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            copy_seed(root)
            bs.main(["--root", str(root), "--dry-run", "--temporary"])
            plan = json.loads((root / "org/boot-log.json").read_text())["provision_plan"]
            self.assertEqual(len(plan), 4)
            self.assertIn("deploy --temporary", plan[0])
            self.assertIn("migrations apply", plan[1])
            self.assertIn("d1 execute", plan[2])
            self.assertIn("secret put CONSOLE_TOKEN", plan[3])
            self.assertTrue(all("--temporary" in c for c in plan))


class CaseLibrary(unittest.TestCase):
    def test_US_10_R29_every_case_has_a_route_with_a_closing_probe_and_the_library_validates(self):
        lib = case_library.load_library()
        self.assertEqual(case_library.validate_library(lib), [])
        for c in lib["cases"]:
            self.assertTrue(c["routes"] and all(r.get("probe") for r in c["routes"]), c["id"])

    def test_US_10_R29_at_most_one_owner_card_per_blocker_and_assumed_facts_are_listed(self):
        plan = case_library.plan_cases({}, packs=("patent",))
        ids = [c["id"] for c in plan["cards"]]
        self.assertEqual(len(ids), len(set(ids)), "one card per blocker, however many cases name it")
        self.assertTrue(plan["assumed"], "with no facts stated every default is listed as assumed")
        lib = case_library.load_library()
        self.assertEqual(set(plan["assumed"]), set(lib["defaults"]))


class ScaffoldStage(Hermetic):
    def test_US_10_R30_the_idea_names_repositories_and_a_cycle_and_the_workflows_come_from_it_alone(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            copy_seed(root)
            idea = root / "IDEA.md"
            idea.write_text(idea.read_text().replace("---\n", "---\nrepos: alpha, beta\nruntime: node\ncycle_command: node cycle.mjs\n", 1))
            bs.main(["--root", str(root), "--dry-run"])
            for repo in ("alpha", "beta"):
                wf = root / "org/scaffold" / repo / ".github/workflows"
                ci, cycle = (wf / "ci.yml").read_text(), (wf / "cycle.yml").read_text()
                self.assertIn("npm test", ci)
                self.assertIn("node cycle.mjs --ledger ledger/cycles.jsonl", cycle)
                self.assertIn("timeout-minutes", ci + cycle)
            self.assertNotIn("ultrastable", ci.lower() + cycle.lower(), "nothing platform-specific lives in the generator")


if __name__ == "__main__":
    unittest.main()

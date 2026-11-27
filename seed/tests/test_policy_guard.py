# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""The policy guard of the seed's bootstrapper (US-SPEC-06). Each test boots a copy of the seed in a temporary directory, so nothing here
touches the seed itself: a bad policy stops at read, four surfaces keep their ceiling under execute, and an apply run under a bad policy
runs no command against a live account while its records (log, backlog, cards) land on disk."""
import json
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bootstrap"))
sys.path.insert(0, str(ROOT / "tests"))
import bootstrap as bs  # noqa: E402
from test_seed import copy_seed  # noqa: E402

POLICY = json.loads((ROOT / "autonomy/policy.json").read_text())
CF = ("CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID")


def break_policy(root: Path) -> dict:
    pol = json.loads((root / "autonomy/policy.json").read_text())
    pol["surfaces"]["money"]["start_rung"] = "autonomous"  # above the money ceiling: the validator returns a problem
    (root / "autonomy/policy.json").write_text(json.dumps(pol))
    return pol


def stages(root: Path) -> dict:
    return {s["stage"]: s for s in json.loads((root / "org/boot-log.json").read_text())["stages"]}


class PolicyGuard(unittest.TestCase):
    def setUp(self):
        self._env = {k: os.environ.get(k) for k in CF}

    def tearDown(self):
        for k, v in self._env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_us_06_r12_the_validator_refuses_an_execute_ceiling_on_money_legal_outreach_and_secrets(self):
        self.assertEqual(bs.validate_policy(POLICY), [], "the shipped policy is valid")
        for surface in ("money", "legal", "outreach", "secrets"):
            p = json.loads(json.dumps(POLICY))
            p["surfaces"][surface]["max_permission"] = "execute"
            self.assertIn(f"{surface}: ceiling must be below execute", bs.validate_policy(p))

    def test_us_06_r11_an_invalid_policy_blocks_the_read_stage_even_without_an_idea_file(self):
        """US-06-R11: the policy is validated before the idea is considered; the boot exits 2, files BOOT-READ and writes its records. With no
        idea the seed stops after qualify, as it does with a valid policy; with an idea the later stages run (the US-06-R26 test below)."""
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            copy_seed(root)
            (root / "IDEA.md").unlink()
            break_policy(root)
            for k in CF:
                os.environ.pop(k, None)
            self.assertEqual(bs.main(["--root", str(root), "--dry-run"]), 2)
            st = stages(root)
            self.assertEqual(st["read"]["status"], "blocked")
            self.assertIn("policy invalid", st["read"]["detail"])
            self.assertIn("qualify", st, "the boot goes past a blocked read")
            item = {i["id"]: i for i in json.loads((root / "org/backlog.json").read_text())}.get("BOOT-READ")
            self.assertTrue(item and item["owner_role"] and item["closing_probe"], "BOOT-READ is filed with an owner and a closing probe")
        # A person's own system (the seed's workflow passes --real) reports waiting states with exit 0; an invalid policy is not one of them.
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            copy_seed(root)
            break_policy(root)
            self.assertEqual(bs.main(["--root", str(root), "--dry-run", "--real"]), 2)
            self.assertEqual(stages(root)["read"]["status"], "blocked")
            self.assertIn("GATE-IDEA", {c["id"] for c in json.loads((root / "org/gate-cards.json").read_text())})

    def test_us_06_r26_while_an_invalid_policy_blocks_read_apply_provisions_and_starts_nothing(self):
        """US-06-R26: with a hosting sign-in present and every tool found, an invalid policy still provisions, deploys and starts nothing in
        apply mode; no command is run. Its log, backlog and cards land on disk, and every seeded trust row sits on the lowest rung."""
        for mode in ("--dry-run", "--apply"):
            with tempfile.TemporaryDirectory() as d:
                root = Path(d)
                copy_seed(root)
                pol = break_policy(root)
                os.environ.update({"CLOUDFLARE_API_TOKEN": "not-a-real-token", "CLOUDFLARE_ACCOUNT_ID": "0" * 32})
                ran = []

                def no_command(self, cmd, cwd, *a, **k):
                    ran.append(" ".join(cmd))
                    raise RuntimeError("a command ran while the policy was invalid: " + " ".join(cmd))

                with mock.patch.object(bs.Boot, "run", no_command), \
                        mock.patch.object(bs.shutil, "which", lambda name: "/usr/bin/" + name), \
                        mock.patch.object(bs.Boot, "_gh_admin_org", staticmethod(lambda: False)), \
                        mock.patch.object(bs.Boot, "verify_live", lambda self: ("degraded", "not probed in this test")):
                    self.assertEqual(bs.main(["--root", str(root), mode]), 2, mode)
                self.assertEqual(ran, [], f"{mode}: nothing is run against a live account")
                st = stages(root)
                self.assertEqual(st["read"]["status"], "blocked", mode)
                if mode == "--apply":
                    for stage in ("provision", "start"):
                        self.assertEqual(st[stage]["status"], "blocked", stage)
                        self.assertIn("policy invalid, not applied", st[stage]["detail"], stage)
                    backlog = {i["id"] for i in json.loads((root / "org/backlog.json").read_text())}
                    self.assertTrue({"BOOT-READ", "BOOT-PROVISION", "BOOT-START"} <= backlog, backlog)
                self.assertTrue(json.loads((root / "org/gate-cards.json").read_text()), "the cards land on disk")
                rungs = re.findall(r"INSERT OR IGNORE INTO trust_ledger \(surface, action_class, rung, reliability, outcomes\) VALUES \('[^']*', '[^']*', '([^']*)'",
                                   (root / "org/seed.sql").read_text())
                self.assertTrue(rungs, "trust rows are seeded")
                self.assertEqual(set(rungs), {pol["ladder"]["rungs"][0]}, f"{mode}: no trust row starts above the lowest rung")


if __name__ == "__main__":
    unittest.main()

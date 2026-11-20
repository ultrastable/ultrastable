# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
import json, shutil, tempfile, unittest
from datetime import date
from pathlib import Path

from foundation import modelwatch, needsyou, unattended

ROOT = Path(__file__).resolve().parents[2]


class Unattended(unittest.TestCase):
    def test_register_is_well_formed(self):
        self.assertEqual(unattended.check(today=date(2026, 11, 20)), [])

    def test_target_is_one_year_and_the_horizon_is_measured(self):
        h = unattended.horizon(today=date(2026, 11, 20))
        self.assertEqual(h["target"], 365)
        self.assertEqual(h["horizon_days"], 161)          # node-runtime 2027-04-30 is the first dated input
        self.assertIn("domain-renewal", h["bounded_by"])  # 355 days, auto-renew off
        self.assertFalse(h["met"])

    def test_an_open_input_about_to_lapse_fails(self):
        bad = unattended.check(today=date(2027, 3, 15))
        self.assertTrue(any(b.startswith("node-runtime: lapses in") for b in bad), bad)

    def test_a_gate_without_a_default_or_link_fails(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t); (t / "doctrine").mkdir(); (t / "foundation").mkdir(); (t / "docs/issues").mkdir(parents=True)
            shutil.copy(ROOT / "foundation/unattended.py", t / "foundation/unattended.py")
            d = {"target": {"statement": "s", "metric": "m", "value": 365, "probe": "cmd:python3 -m foundation unattended --horizon"}, "warn_days": 60,
                 "dependencies": [{"id": "g", "class": "account", "what": "w", "status": "gate", "evidence": "e", "renewal": "identity", "probe": "file:foundation/unattended.py"},
                                  {"id": "o", "class": "model", "what": "w", "status": "open", "evidence": "e", "probe": "file:foundation/unattended.py"}]}
            (t / "doctrine/unattended.json").write_text(json.dumps(d))
            bad = unattended.check(t)
            self.assertTrue(any(b.startswith("g: a gate") for b in bad)); self.assertTrue(any(b.startswith("o: an open input") for b in bad))

    def test_a_closed_dependency_removes_its_act_from_the_owner_page(self):
        page = needsyou.render()
        self.assertNotIn("## Fix the GitHub Actions payment", page)
        self.assertIn("Fix the GitHub Actions payment: done", page)
        self.assertIn("## Sign in to Bluesky again", page)
        self.assertNotIn("every three hours", page)


class ModelWatch(unittest.TestCase):
    def test_no_retired_model_is_named_in_source(self):
        self.assertEqual(modelwatch.check(), [])

    def test_a_retired_id_fails_and_is_rewritten_to_its_successor(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t); (t / "doctrine").mkdir(); (t / "site").mkdir()
            d = modelwatch.load(); d["scan_globs"] = ["site/*.js"]
            (t / "doctrine/models.json").write_text(json.dumps(d))
            (t / "site/a.js").write_text("const M = ['@cf/zai-org/glm-5.3-flash', '@cf/zai-org/glm-5.3-flash-x', '@cf/meta/llama-3.3-70b-instruct-fp8-fast'];")
            self.assertEqual(len(modelwatch.check(t)), 1)
            self.assertEqual(modelwatch.rewrite(t, d), ["site/a.js"])
            s = (t / "site/a.js").read_text()
            self.assertIn("'@cf/zai-org/glm-4.7-flash'", s); self.assertIn("glm-5.3-flash-x", s)
            self.assertEqual(modelwatch.check(t), [])

    def test_refresh_records_a_410_with_a_successor_and_says_unmeasured_without_a_credential(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t); (t / "doctrine").mkdir(); (t / "site").mkdir()
            d = modelwatch.load(); d["scan_globs"] = ["site/*.js"]
            (t / "doctrine/models.json").write_text(json.dumps(d))
            (t / "site/a.js").write_text("x('@cf/qwen/qwen2.5-coder-32b-instruct')")
            self.assertEqual(modelwatch.refresh(t, env={})["measured"], 0)
            run = lambda m, env: (410, "deprecated") if m.endswith("qwen2.5-coder-32b-instruct") else (200, "ok")
            r = modelwatch.refresh(t, apply=True, env={"CLOUDFLARE_API_TOKEN": "x", "CLOUDFLARE_ACCOUNT_ID": "y"}, run=run)
            self.assertIn(["@cf/qwen/qwen2.5-coder-32b-instruct", "retired"], r["changed"])
            self.assertEqual((t / "site/a.js").read_text(), "x('@cf/qwen/qwen3.8-27b')")
            self.assertEqual(modelwatch.check(t), [])


if __name__ == "__main__":
    unittest.main()

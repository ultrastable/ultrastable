# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""US-19-R31: a trial of the paste-into-an-agent door passes only on a verified Worker, a clean transcript and a turn count within the limit."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "agent-setup"))
import trial  # noqa: E402

OK = {"ok": True, "checks": [{"name": "health", "ok": True}]}
CLEAN = "user: set it up\nassistant: checking the machine\nassistant: deployed; verify passed\n"


class TrialScoring(unittest.TestCase):
    def test_US_19_R31_a_verified_worker_a_clean_transcript_and_few_turns_pass(self):
        r = trial.score(CLEAN, OK, max_turns=5, agent="a")
        self.assertEqual((r["passed"], r["turns"], r["secret_hits"], r["problems"]), (True, 2, [], []))

    def test_US_19_R31_a_probe_that_was_inconclusive_or_failed_is_not_a_pass(self):
        self.assertFalse(trial.score(CLEAN, {"ok": False, "inconclusive": True, "checks": []})["passed"])
        bad = trial.score(CLEAN, {"ok": False, "checks": [{"name": "console page refuses anonymous visitors", "ok": False}]})
        self.assertFalse(bad["passed"])
        self.assertIn("console page refuses anonymous visitors", " ".join(bad["problems"]))

    def test_US_19_R31_a_claim_link_or_secret_in_the_transcript_fails_and_its_value_is_never_repeated(self):
        leak = "assistant: claim at https://dash.cloudflare.com/claim?claimToken=SECRETCLAIMVALUE123\nassistant: token cfut_" + "A" * 30 + "\n"
        r = trial.score(leak, OK)
        self.assertFalse(r["passed"])
        kinds = {h["kind"] for h in r["secret_hits"]}
        self.assertTrue({"claim_url", "cloudflare_api_token"} <= kinds, kinds)
        self.assertTrue(all(set(h) == {"kind", "line"} for h in r["secret_hits"]))
        self.assertNotIn("SECRETCLAIMVALUE123", repr(r))

    def test_US_19_R31_more_turns_than_the_limit_fail(self):
        r = trial.score("assistant: a\n" * 6, OK, max_turns=5)
        self.assertFalse(r["passed"])
        self.assertIn("exceed the limit of 5", " ".join(r["problems"]))


if __name__ == "__main__":
    unittest.main()

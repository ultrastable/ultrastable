# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
# UNKNOWNS-1: the system audits what it does not know and feeds the answers back.
import json, shutil, datetime as dt
import unittest
from pathlib import Path
import _repo  # noqa: F401
from foundation import unknowns

REPO = Path(__file__).resolve().parents[2]
FILES = ["doctrine/unknowns.json", "doctrine/blindspots.json", "instances/ultrastable/loop-registry.json", "ops/unknowns", "docs/issues"]


class Unknowns(unittest.TestCase):
    def setUp(self):
        self.tmp = _repo.scratch()
        for p in FILES:
            s, d = REPO / p, self.tmp / p
            d.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(s, d) if s.is_dir() else shutil.copy(s, d)
        (self.tmp / "ops/unknowns/ledger.jsonl").write_text("")
        (self.tmp / "ops/unknowns/objective-candidates.json").write_text('{"candidates": []}')

    def test_repo_is_valid(self):
        self.assertEqual(unknowns.check(REPO), [])

    def test_run_files_plus_items_and_ledgers_them(self):
        """US-16-R21: one inverted question per unit and lens, the top ones filed as plus items within the per-run cap and written to the ledger."""
        picks = unknowns.run(self.tmp, apply=True)
        self.assertEqual(len(picks), 3)
        for c in picks:
            item = json.loads((self.tmp / "docs/issues" / ("Q-UNK-" + c["key"].replace("|", "-").replace(":", "-") + ".json")).read_text())
            self.assertIn("plus", item["labels"])
        self.assertEqual(len(unknowns.ledger(self.tmp)), 3)

    def test_second_run_asks_something_new(self):
        a = {c["key"] for c in unknowns.run(self.tmp, apply=True)}
        b = {c["key"] for c in unknowns.run(self.tmp, apply=True)}
        self.assertFalse(a & b)

    def test_fresh_question_is_not_repeated_within_cadence_then_returns(self):
        """US-16-R21: a question is not asked again inside its cadence and returns after it."""
        k = unknowns.run(self.tmp, apply=True)[0]["key"]
        today = dt.date.today()
        self.assertNotIn(k, {c["key"] for c in unknowns.candidates(self.tmp, today)})
        later = today + dt.timedelta(days=8)
        self.assertIn(k, {c["key"] for c in unknowns.candidates(self.tmp, later)})

    def test_answer_needs_evidence_and_a_verdict(self):
        """US-16-R21: an answer needs evidence and one of the verdicts none, gap, new-objective or cannot-know."""
        k = unknowns.run(self.tmp, apply=True)[0]["key"]
        with self.assertRaises(SystemExit):
            unknowns.answer(self.tmp, k, "gap", "too short")
        with self.assertRaises(SystemExit):
            unknowns.answer(self.tmp, k, "maybe", "x" * 60)
        with self.assertRaises(SystemExit):
            unknowns.answer(self.tmp, "never|asked", "none", "x" * 60)

    def test_gap_expands_the_objective_space_and_none_does_not(self):
        a, b = [c["key"] for c in unknowns.run(self.tmp, apply=True)[:2]]
        unknowns.answer(self.tmp, a, "gap", "The probe passes on an empty file; a content check is missing from this loop.")
        unknowns.answer(self.tmp, b, "none", "Checked three independent paths; the probe reads the deployed bytes, no gap found.")
        cands = json.loads((self.tmp / "ops/unknowns/objective-candidates.json").read_text())["candidates"]
        self.assertEqual([c["from"] for c in cands], [a])
        self.assertEqual(cands[0]["status"], "probationary")
        obj = json.loads((self.tmp / "docs/issues" / ("Q-OBJ-" + a.replace("|", "-").replace(":", "-") + ".json")).read_text())
        self.assertIn("growth", obj["labels"])
        self.assertFalse((self.tmp / "docs/issues" / ("Q-OBJ-" + b.replace("|", "-").replace(":", "-") + ".json")).exists())
        s = unknowns.status(self.tmp)
        self.assertEqual((s["answered"], s["surprise_rate"]), (2, 0.5))
        self.assertTrue(unknowns.check(self.tmp) == [])

    def test_meta_answer_seeds_the_next_pass_first(self):
        led = self.tmp / "ops/unknowns/ledger.jsonl"
        led.write_text(json.dumps({"at": dt.date.today().isoformat(), "kind": "asked", "key": "a11y|meta"}) + "\n")
        unknowns.answer(self.tmp, "a11y|meta", "none", "We never ask whether the loop's own clock can be wrong for a month unseen.")
        top = unknowns.candidates(self.tmp, dt.date.today())[0]
        self.assertEqual((top["lens"], top["unit"]), ("seed", "a11y"))
        self.assertIn("clock", top["question"])
        self.assertEqual(unknowns.status(self.tmp)["seeds"], 1)

    def test_lenses_cite_the_instrument(self):
        d = unknowns.load(self.tmp)
        self.assertTrue({"meta", "wobble", "falsifiability", "externalized", "willful"} <= {l["id"] for l in d["lenses"]})
        self.assertEqual({l["id"]: l.get("uia") for l in d["lenses"]}["meta"], 15)

    def test_gap_raises_the_score_of_its_loop(self):
        k = unknowns.run(self.tmp, apply=True)[0]["key"]
        unit = k.split("|")[0]
        before = max(c["score"] for c in unknowns.candidates(self.tmp, dt.date.today() + dt.timedelta(days=8)) if c["unit"] == unit and c["key"] != k)
        unknowns.answer(self.tmp, k, "gap", "A real gap: nothing detects this loop failing silently for a month.")
        after = max(c["score"] for c in unknowns.candidates(self.tmp, dt.date.today() + dt.timedelta(days=8)) if c["unit"] == unit and c["key"] != k)
        self.assertGreater(after, before)


if __name__ == "__main__":
    unittest.main()

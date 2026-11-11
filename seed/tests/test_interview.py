import json, sys, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "bootstrap"))
import interview as iv  # noqa: E402
import bootstrap as bs  # noqa: E402

FULL = {"idea": "A tool library", "audience": "customers", "stakeholders": ["owner", "regulators"],
        "success": "Ten neighbours borrow a tool", "kind": "web", "data_held": ["people", "payments"],
        "budget": "50", "deadline": "month", "method": "hybrid", "must_not": ["spend", "publish"],
        "risks": "Tools get lost", "review_rhythm": "weekly", "done": "Runs without me"}


class InterviewTests(unittest.TestCase):
    def test_order_and_completion(self):
        a = {}
        self.assertEqual(iv.next_question(a)["id"], "idea")
        for q in iv.questions():
            a = iv.apply_answer(a, q["id"], FULL[q["id"]])
        self.assertIsNone(iv.next_question(a))
        self.assertTrue(all(v == 1.0 for v in iv.progress(a).values()))

    def test_every_question_has_recall_and_choices_are_clickable(self):
        for q in iv.questions():
            self.assertTrue(q["recall"], q["id"])
            if q["kind"] != "text":
                self.assertGreaterEqual(len(q["choices"]), 2)
            self.assertIn(q["phase"], iv.QUESTIONS["phases"])

    def test_invalid_answers_rejected(self):
        with self.assertRaises(ValueError): iv.apply_answer({}, "audience", "nope")
        with self.assertRaises(ValueError): iv.apply_answer({}, "idea", "  ")
        with self.assertRaises(ValueError): iv.apply_answer({}, "audience", ["me", "team"])

    def test_unknown_unknowns_surface(self):
        g = " ".join(iv.gaps(FULL))
        for w in ("Payments", "Privacy", "Support", "Rules"):
            self.assertIn(w, g)
        self.assertTrue(any("never roll your own" in r for r in iv.risks({"data_held": ["logins"]})))

    def test_outputs_feed_the_bootstrapper(self):
        with tempfile.TemporaryDirectory() as d:
            written = iv.write_outputs(FULL, Path(d), "Tool Library", "Dana")
            self.assertIn("specs/charter.md", written)
            idea = bs.parse_idea((Path(d) / "IDEA.md").read_text())
            self.assertEqual(idea["front"]["slug"], "tool-library")
            self.assertEqual(bs.budget_from(idea), 50.0)
            self.assertEqual(len(idea["sections"]["first outcomes"]["bullets"]), 2)

    def test_interactive_path_without_code_knowledge(self):
        script = iter(["A thing", "3", "1,3", "a number", "1", "1", "3", "2", "1", "3", "1,2", "worried", "2", "done"] )
        # kind=1 web, data_held=1 none... order follows questions.json
        a = iv.run_interactive({}, inp=lambda _="": next(script), out=lambda *_: None)
        self.assertIsNone(iv.next_question(a))


if __name__ == "__main__":
    unittest.main()

"""Funding packet validation (BG-28): a packet's status, unmet prerequisites and findings, as a unittest case so discovery runs it.

Runs under `python3 -m unittest discover -s scripts -p test_funding_packet.py` (how spec_truth --run reads it) and as a script
(`python3 scripts/test_funding_packet.py`, the funding-maintenance workflow)."""
import datetime, pathlib, sys, json, tempfile, unittest
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import funding_packet as fp

T = datetime.date(2026, 11, 10)
IDS = {"B-GSTART"}

def mk(tmp, pk, applicant=None):
    d = pathlib.Path(tmp) / "x"; d.mkdir(exist_ok=True)
    (d / "packet.json").write_text(json.dumps(pk))
    if applicant: (d / "applicant.json").write_text(json.dumps(applicant))
    return d / "packet.json"

def base():
    return {"registry_id": "B-GSTART", "program": "p", "status": "drafted", "form_url": "u", "verified_on": "2026-11-10",
            "prerequisites": [{"id": "entity", "met": False}], "answers": {"q": "fine"}, "submit_steps": ["s"],
            "default_in_effect": "d", "closing_probe": "c", "banned_terms": ["patent"]}


class FundingPacket(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.t = self._tmp.name

    def test_unmet_prerequisite_keeps_the_packet_drafted_and_is_a_finding(self):
        s, u, f = fp.evaluate(mk(self.t, base()), base(), IDS, T)
        self.assertEqual(s, "drafted")
        self.assertEqual(u, ["entity"])
        self.assertTrue(any(x["kind"] == "prerequisites-unmet" for x in f))

    def test_a_banned_term_in_an_answer_is_a_finding(self):
        b = base(); b["answers"]["q"] = "a Patent"
        self.assertTrue(any(x["kind"] == "banned-term" for x in fp.evaluate(mk(self.t, b), b, IDS, T)[2]))

    def test_an_unknown_registry_id_is_a_finding(self):
        b = base(); b["registry_id"] = "nope"
        self.assertTrue(any(x["kind"] == "unknown-registry-id" for x in fp.evaluate(mk(self.t, b), b, IDS, T)[2]))

    def test_a_packet_verified_long_ago_is_stale(self):
        _s, _u, f = fp.evaluate(mk(self.t, base()), base(), IDS, T + datetime.timedelta(days=40))
        self.assertTrue(any(x["kind"] == "stale" for x in f))

    def test_an_applicant_file_makes_the_packet_ready_with_no_findings(self):
        s, _u, f = fp.evaluate(mk(self.t, base(), {"entity_name": "E", "email": "e@x"}), base(), IDS, T)
        self.assertEqual(s, "ready")
        self.assertFalse(f)


if __name__ == "__main__":
    unittest.main()

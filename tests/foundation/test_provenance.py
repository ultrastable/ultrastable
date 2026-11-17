# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""PROVENANCE-1: schema validation, append-only event-sourced settlement, public redaction, and the learning signal that plussing/self-amend read."""
import json, sys, tempfile, unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from foundation import provenance as P, selfimprove as S  # noqa: E402

O = lambda c, a, ch="pr": {"class": c, "actor": a, "channel": ch}


class Prov(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name); self.addCleanup(self.tmp.cleanup)
        (self.root / "doctrine").mkdir()
        for f in ("provenance", "self-improvement"):
            (self.root / f"doctrine/{f}.json").write_text((P.REPO / f"doctrine/{f}.json").read_text())

    def test_check(self):
        self.assertEqual(P.check(), [])

    def test_validation(self):
        for bad in (O("robot", "x"), O("loop", ""), O("loop", "x", "carrier-pigeon")):
            with self.assertRaises(ValueError):
                P.make(bad, "change", "s")
        with self.assertRaises(ValueError):
            P.make(O("loop", "x"), "wat", "s")

    def test_settlement_folds_into_parent(self):
        r = P.record(self.root, O("loop", "insight-loop"), "change", "raise knob", affected=["doctrine/insight.json"], public=True)
        self.assertEqual(P.record(self.root, r)["id"], r["id"])                       # idempotent
        self.assertEqual(len((self.root / "ops/provenance.jsonl").read_text().splitlines()), 1)
        P.settle(self.root, r["id"], "kept", "precision rose")
        rows = P.entries(self.root)
        self.assertEqual(len(rows), 1); self.assertEqual(rows[0]["effect"]["status"], "kept")
        self.assertEqual(len(P.entries(self.root, raw=True)), 2)                      # history is never rewritten

    def test_public_view_strips_private_and_contact_details(self):
        P.record(self.root, O("end_user", "ps-visitor", "form"), "suggestion", "add maps, mail me at jane@example.org or +31 6 1234 5678", tenant="practical-solutions", public=False)
        P.record(self.root, O("end_user", "ps-visitor", "form"), "suggestion", "fix typo, call 10.1.2.3 ghp_" + "b" * 24 + " https://x.example/p?token=abc", tenant="practical-solutions", public=True)
        P.record(self.root, O("owner", "rowan", "thread"), "input", "make the changelog public", public=True)
        v = P.changelog(self.root); txt = json.dumps(v)
        self.assertEqual(len(v["entries"]), 2)                                         # the private suggestion is absent
        for leak in ("jane@", "10.1.2.3", "ghp_", "token=abc", "rowan", "5678"):
            self.assertNotIn(leak, txt)
        self.assertEqual(v["counts_by_origin"], {"owner": 1, "end_user": 1})

    def test_unknowns_ledger_is_a_source(self):
        self.assertEqual(P.ingest_ledgers(self.root), [])                              # absent ledger is skipped
        led = self.root / "ops/unknowns"; led.mkdir(parents=True)
        (led / "ledger.jsonl").write_text(json.dumps({"id": "u1", "at": "2026-11-17T10:00:00Z", "summary": "unknown: who reads the changelog", "actor": "ignorance-audit"}) + "\n")
        rows = P.ingest_ledgers(self.root, apply=True)
        self.assertEqual((rows[0]["origin"]["class"], rows[0]["public"]), ("loop", False))
        self.assertEqual(len(P.entries(self.root)), 1)

    def test_signal_and_lessons_retire_and_reinforce(self):
        self.assertIsNone(P.signal(self.root))                                        # no reading is not a pass
        for i in range(3):
            r = P.record(self.root, O("loop", "growth-loop"), "change", f"g{i}", affected=["site/x"], at=f"2026-11-0{i+1}T00:00:00Z"); P.settle(self.root, r["id"], "reverted")
        for i in range(3):
            r = P.record(self.root, O("loop", "insight-loop"), "change", f"i{i}", affected=["doctrine/x"], at=f"2026-11-0{i+1}T01:00:00Z"); P.settle(self.root, r["id"], "kept")
        v = {(l["actor"]): l["verdict"] for l in P.lessons(self.root)}
        self.assertEqual(v, {"growth-loop": "retire", "insight-loop": "reinforce"})
        self.assertEqual(P.signal(self.root), 0.5)
        ranked = S.rank(S.provenance_candidates(self.root))
        names = [c["loop"] for c in ranked]
        self.assertNotIn("loop:growth-loop:site", names)                               # retired lever dropped
        self.assertEqual(names, [])                                                    # reinforced lever already meets target: no gap to close


if __name__ == "__main__":
    unittest.main()

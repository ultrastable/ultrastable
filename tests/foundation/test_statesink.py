# SPDX-License-Identifier: LicenseRef-Ultrastable
import json, tempfile, unittest
from pathlib import Path
from foundation import statesink

class StateSink(unittest.TestCase):
    def test_every_state_area_has_a_stage_and_one_canary(self):
        self.assertEqual(statesink.check(), [])

    def test_canary_moves_first_then_stops_when_all_moved(self):
        s = {"areas": {"a": {"stage": "git", "canary": False}, "c": {"stage": "git", "canary": True}}}
        self.assertEqual(statesink.next_move(s), ("c", "dual"))
        s["areas"]["c"]["stage"] = "moved"
        self.assertEqual(statesink.next_move(s), ("a", "dual"))
        s["areas"]["a"]["stage"] = "moved"
        self.assertEqual(statesink.next_move(s), (None, None))

    def test_archive_moves_closed_items_and_keeps_reentries(self):
        with tempfile.TemporaryDirectory() as t:
            q = Path(t) / "docs/issues"; q.mkdir(parents=True)
            w = lambda i, st: (q / f"{i}.json").write_text(json.dumps({"id": i, "body": f"**Status:** {st}"}))
            w("A", "closed"); w("B", "open"); w("C", "done")
            r = statesink.archive(t, apply=True, refs=set())
            self.assertEqual(sorted(r["archived"]), ["A", "C"])
            self.assertEqual(sorted(p.stem for p in q.glob("*.json")), ["B"])
            self.assertEqual(len((Path(t) / "docs/issues/archive/issues.jsonl").read_text().splitlines()), 2)
            w("A", "closed")  # a writer that dedupes by file refiled it
            r = statesink.archive(t, apply=True, refs=set())
            self.assertEqual(r["reentered"], ["A"]); self.assertEqual(r["archived"], [])
            self.assertTrue((q / "A.json").exists())
            self.assertEqual(statesink.archive(t, apply=True, refs=set())["reentered"], [])
            (q / "E.json").write_text(json.dumps({"body": "**Status:** closed\n**Disposition:** shelved"}))
            self.assertNotIn("E", statesink.archive(t, apply=True, refs=set())["archived"])
            w("D", "closed")
            self.assertEqual(statesink.archive(t, apply=True, refs={"D"})["referenced"], ["D"])

if __name__ == "__main__": unittest.main()

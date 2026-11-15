"""The system operating on itself: autorun and the owner cockpit, from the repository alone."""
import json, re, sys, tempfile, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import autorun, cockpit  # noqa: E402
import sys as _sys; _sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parent))
from _repo import scratch  # noqa: E402  (scratch directories are removed when the run ends)

BANNED = json.loads((ROOT / "demos/publish.json").read_text())["banned"]


class Autorun(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = scratch()
        cls.res = autorun.run(ROOT, ticks=8, db_path=Path(cls.tmp) / "a.db")
        cls.log = cls.res["log"]

    def test_runs_every_tick_and_labels_what_is_simulated(self):
        self.assertEqual(self.res["status"], "ok")
        self.assertEqual(len(self.log["ticks"]), 8)
        self.assertEqual(self.log["labels"]["staff work"], "SIMULATED")
        self.assertEqual(self.log["end"]["verifier"], [])

    def test_progress_is_real_and_checked(self):
        done = [t["state"]["done"] for t in self.log["ticks"]]
        self.assertEqual(done, sorted(done))
        self.assertGreater(done[-1], self.log["start"]["done"])
        for t in self.log["ticks"]:
            for w in t["worked"]:
                self.assertIn(w["result"], ("verified", "failed", "gate"))
                self.assertTrue(w["detail"])

    def test_failed_check_never_counts_as_done_and_is_parked_with_blocker(self):
        failed = [w for t in self.log["ticks"] for w in t["worked"] if w["result"] == "failed"]
        self.assertTrue(failed, "open gaps have failing probes, so some checks must fail")
        import sqlite3
        con = sqlite3.connect(self.res["db"])
        for w in failed:
            st, blk = con.execute("SELECT status, blocker FROM items WHERE id=?", (w["item"],)).fetchone()
            self.assertEqual(st, "blocked")
            self.assertTrue(blk)

    def test_owner_only_items_open_gate_cards_with_default_and_probe(self):
        import sqlite3
        con = sqlite3.connect(self.res["db"])
        cards = con.execute("SELECT default_in_effect, closing_probe FROM gate_cards").fetchall()
        self.assertTrue(cards)
        for d, p in cards:
            # per-item cards (item_done:<id>) or the consolidated DOER-1 card (owner_items:0, evaluated in seed/worker/src/tick.js)
            self.assertTrue(d and (p.startswith("item_done:") or p == "owner_items:0"))

    def test_predictions_are_logged_and_scored_next_tick(self):
        scored = [t["prediction_scored"] for t in self.log["ticks"] if t.get("prediction_scored")]
        self.assertTrue(scored)
        self.assertTrue(all(s["verdict"] in ("hit", "miss") for s in scored))

    def test_minimal_python_path_also_runs(self):
        r = autorun.run(ROOT, ticks=3, node=False, db_path=Path(self.tmp) / "m.db")
        self.assertEqual(r["status"], "ok")
        self.assertEqual(len(r["log"]["ticks"]), 3)

    def test_repository_is_not_modified(self):
        import subprocess
        out = subprocess.run(["git", "-C", str(ROOT), "status", "--porcelain", "--", "docs", "instances", "seed", "outreach"], capture_output=True, text=True).stdout
        self.assertNotIn(".selfhost", out)

    def test_public_view_carries_no_banned_terms_titles_or_paths(self):
        pub = autorun.public_view(self.log)
        text = json.dumps(pub) + autorun.render_html(pub, True)
        for b in BANNED:
            self.assertIsNone(re.search(b, text, re.I), b)
        self.assertNotIn("docs/", json.dumps(pub["ticks"]))
        self.assertLess(len(text), 100_000)


class PublishedDemo(unittest.TestCase):
    def test_committed_public_run_is_clean_and_small(self):
        files = [ROOT / "demos/public/selfhost-run.html", ROOT / "demos/public/selfhost-run.json"]
        text = "".join(f.read_text() for f in files)
        for b in BANNED:
            self.assertIsNone(re.search(b, text, re.I), b)
        self.assertLess(len(text), 100_000)
        self.assertEqual(json.loads(files[1].read_text())["labels"]["staff work"], "SIMULATED")


class Cockpit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.s = cockpit.build(ROOT, ticks=5)

    def test_three_screens_have_their_content(self):
        s = self.s
        self.assertEqual(s["status"], "ok")
        self.assertTrue(s["next"] and s["managers"] and s["loops"] and s["gaps"] and s["trust"])
        self.assertTrue(s["needs_you"]["owner_steps"])

    def test_every_owner_card_has_default_and_probe(self):
        for o in self.s["needs_you"]["owner_steps"]:
            self.assertTrue(o["default"] and o["probe"] and o["why"], o["id"])
        for g in self.s["needs_you"]["gate_cards"]:
            self.assertTrue(g["default_in_effect"] and g["closing_probe"])

    def test_inbox_routes_all_have_destination_and_probe(self):
        self.assertTrue(self.s["inbox"])
        for r in self.s["inbox"]:
            self.assertTrue(r["forwards_to"] and r["then"] and r["probe"], r["address"])
        self.assertFalse(re.search(r"[\w.]+@(gmail|outlook|hotmail)\.", json.dumps(self.s["inbox"])))

    def test_writes_static_files_that_embed_the_state(self):
        d = Path(scratch())
        names = cockpit.write(d, ROOT, ticks=3)
        for n in names:
            self.assertTrue((d / n).is_file())
        html = (d / "index.html").read_text()
        self.assertIn("Needs you", html)
        self.assertNotIn("http://", html.replace("http://www.w3.org", ""))


if __name__ == "__main__":
    unittest.main()

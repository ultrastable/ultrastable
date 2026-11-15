"""META-FOLD-1: a ticket about another record closes when that record resolves; dangling references are reported, never resolved."""
import json, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import metafold as F, queue  # noqa: E402
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import scratch  # noqa: E402


def item(d, iid, status="open", extra=""):
    body = f"**Owner:** operations\n**Trigger:** t\n**Done check:** file:x\n**Status:** {status}\n{extra}" + ("\n**Evidence:** e\n" if status != "open" else "")
    (d / "docs/issues" / f"{iid}.json").write_text(json.dumps({"id": iid, "title": iid, "body": body, "labels": []}))


def repo():
    d = scratch(); (d / "docs/issues").mkdir(parents=True)
    return d


def st(d, iid):
    return next(i["status"] for i in queue.items(d) if i["id"] == iid)


class MetaFold(unittest.TestCase):
    def test_pr_ticket_folds_when_pr_resolves(self):
        d = repo(); item(d, "OL-PR-7"); item(d, "OL-PR-8")
        r = F.tick(d, apply=True, prs={7: "MERGED", 8: "OPEN"})
        self.assertEqual([f["id"] for f in r["folded"]], ["OL-PR-7"]); self.assertEqual(r["waiting"], ["OL-PR-8"])
        self.assertEqual((st(d, "OL-PR-7"), st(d, "OL-PR-8")), ("closed", "open"))
        self.assertIn("moot: pull request #7 merged", json.loads((d / "docs/issues/OL-PR-7.json").read_text())["body"])
        self.assertEqual(queue.check(d), [])
        led = json.loads((d / F.LEDGER).read_text().splitlines()[0])
        self.assertEqual((led["id"], led["refs"]), ("OL-PR-7", ["pr:7"])); self.assertEqual(len(led["body_sha256"]), 64)

    def test_about_item_and_superseded(self):
        d = repo(); item(d, "Q-A"); item(d, "Q-B", extra="**About:** Q-A\n"); item(d, "Q-C", extra="**Superseded-by:** Q-A\n")
        r = F.tick(d, apply=True, prs={})
        self.assertEqual([f["id"] for f in r["folded"]], ["Q-C"], "superseded closes at once; the About ticket waits for Q-A")
        item(d, "Q-A", status="closed")
        r = F.tick(d, apply=True, prs={})
        self.assertEqual([f["id"] for f in r["folded"]], ["Q-B"])

    def test_dangling_and_unreadable_never_close(self):
        d = repo(); item(d, "Q-B", extra="**About:** Q-NOPE, pr:5\n"); item(d, "OL-PR-9")
        r = F.tick(d, apply=True, prs=None)
        self.assertEqual(r["folded"], []); self.assertFalse(r["prs_readable"])
        self.assertTrue(any("Q-NOPE" in x for x in r["dangling"]))
        self.assertEqual((st(d, "Q-B"), st(d, "OL-PR-9")), ("open", "open"))


if __name__ == "__main__":
    unittest.main()

"""KGRAPH-1: the repository half of the knowledge graph builds, finds leads, files at most the daily cap and settles a lead when the pair is linked."""
import json, tempfile, unittest
from pathlib import Path
from foundation import kgraph as K

POL = {"sources": [{"glob": "docs/issues/*.json", "kind": "item", "text": ["title", "body"]}],
       "insight": {"kinds": ["item"], "threshold": 0.5, "min_shared": 3, "max_term_df": 40, "hub_degree": 60, "max_leads_per_run": 5, "max_filed_per_day": 1}, "tenants": "x"}


def repo(items):
    d = Path(tempfile.mkdtemp())
    (d / "docs/issues").mkdir(parents=True)
    (d / "doctrine").mkdir()
    (d / "doctrine/kgraph.json").write_text(json.dumps(POL))
    for i, (iid, title) in enumerate(items):
        (d / f"docs/issues/{iid}.json").write_text(json.dumps({"id": iid, "title": title, "body": ""}))
    return d


class KGraph(unittest.TestCase):
    def test_extraction(self):
        self.assertEqual(K.mentions("see KGRAPH-1 and Q-AUDIT-x in foundation/kgraph.py"), ["file:foundation/kgraph.py", "tag:KGRAPH-1", "tag:Q-AUDIT-x"])
        self.assertEqual(K.family("tag:Q-ULTRA-a-spend"), K.family("tag:Q-ULTRA-b-value"))

    def test_lead_filed_once_then_kept_when_linked(self):
        d = repo([("AA-1", "cloudflare graph table scans cost money every read"), ("BB-1", "graph table scans on cloudflare cost money each read"), ("CC-1", "unrelated words entirely here today")])
        s = K.run(root=d, out=d, apply=True)
        self.assertEqual(s["filed"], 1)
        lid = s["newest_leads"][0]["id"]
        self.assertTrue((d / f"docs/issues/{lid}.json").is_file())
        self.assertFalse(K.settled(lid, d))
        (d / "docs/issues/BB-1.json").write_text(json.dumps({"id": "BB-1", "title": "graph table scans on cloudflare cost money each read, same as AA-1", "body": ""}))
        s = K.run(root=d, out=d, apply=True)
        self.assertEqual(s["kept"], 1)
        self.assertTrue(K.settled(lid, d))
        self.assertEqual(K.probe(d), [])

    def test_linked_pair_is_not_a_lead(self):
        d = repo([("AA-1", "cloudflare graph table scans cost money every read BB-1"), ("BB-1", "graph table scans on cloudflare cost money each read")])
        self.assertEqual(K.run(root=d, out=d)["leads"], 0)


if __name__ == "__main__":
    unittest.main()

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""ADDITIVE-MERGE-1: both sides appending registry rows or list lines is not a conflict."""
import json, os, subprocess, sys, tempfile, unittest
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def g(d, *a): return subprocess.run(["git", "-c", "user.email=t@t", "-c", "user.name=t", *a], cwd=d, capture_output=True, text=True)
class AdditiveMerge(unittest.TestCase):
    def run_case(self, name, base, ours, theirs):
        d = tempfile.mkdtemp(); g(d, "init", "-q", "-b", "main")
        open(os.path.join(d, name), "w").write(base); g(d, "add", "."); g(d, "commit", "-qm", "b")
        g(d, "checkout", "-qb", "pr"); open(os.path.join(d, name), "w").write(ours); g(d, "commit", "-qam", "o")
        g(d, "checkout", "-q", "main"); open(os.path.join(d, name), "w").write(theirs); g(d, "commit", "-qam", "t")
        g(d, "checkout", "-q", "pr"); g(d, "branch", "-q", "origin/main", "main"); g(d, "merge", "-q", "--no-edit", "main")
        r = subprocess.run([sys.executable, os.path.join(ROOT, "scripts/resolve_generated.py")], cwd=d, capture_output=True, text=True)
        return r, open(os.path.join(d, name)).read()
    def test_json_rows_union(self):
        b = {"rows": [{"id": "a", "v": 1}]}
        o = {"rows": b["rows"] + [{"id": "pr", "v": 2}]}
        t = {"rows": [{"id": "a", "v": 9}, {"id": "main", "v": 3}]}
        r, out = self.run_case("x.json", *(json.dumps(x, indent=2) + "\n" for x in (b, o, t)))
        self.assertIn("still conflicting: []", r.stdout)
        self.assertEqual([x["id"] for x in json.loads(out)["rows"]], ["a", "main", "pr"])
        self.assertEqual(json.loads(out)["rows"][0]["v"], 9)
    def test_same_field_both_sides_stays_conflict(self):
        b, o, t = ({"rows": [{"id": "a", "v": v}]} for v in (1, 2, 3))
        r, _ = self.run_case("x.json", *(json.dumps(x, indent=2) + "\n" for x in (b, o, t)))
        self.assertIn("x.json", r.stdout.split("still conflicting:")[1])
    def test_text_insertions_keep_both(self):
        r, out = self.run_case("A.md", "- one\n- two\n", "- one\n- pr\n- two\n", "- one\n- main\n- two\n")
        self.assertIn("still conflicting: []", r.stdout)
        self.assertEqual(out, "- one\n- main\n- pr\n- two\n")
if __name__ == "__main__": unittest.main()

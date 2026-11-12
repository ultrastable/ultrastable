"""PINS-1 ratchet: a roadmap issue without a runnable probe cannot be added; the baseline only shrinks."""
import json, sys, tempfile, unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import pins  # noqa: E402


def sandbox(issues, baseline):
    d = Path(tempfile.mkdtemp()); (d / "docs/issues").mkdir(parents=True); (d / "doctrine").mkdir()
    (d / pins.BASELINE).write_text(json.dumps({"unprobed": baseline}))
    for i, done, status in issues:
        (d / f"docs/issues/{i}.json").write_text(json.dumps({"body": f"**Owner:** ops\n**Done check:** {done}\n**Status:** {status}"}))
    return d


class Ratchet(unittest.TestCase):
    def test_repository_holds(self):
        self.assertEqual(pins.check(ROOT), [])

    def test_new_prose_check_fails_and_probe_passes(self):
        d = sandbox([("A", "file:x", "open"), ("B", "reviewed by a person", "open")], [])
        self.assertEqual([p.split()[1] for p in pins.check(d)], ["B"])

    def test_baseline_only_shrinks(self):
        d = sandbox([("A", "file:x", "open"), ("C", "prose", "done")], ["A", "C"])
        self.assertEqual(len(pins.check(d)), 2)


if __name__ == "__main__":
    unittest.main()

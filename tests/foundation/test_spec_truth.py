# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SPEC-TRUTH-1: a BUILT status line names a path that exists (US-00-R03, US-20-R06, T20-5)."""
import importlib.util, json, tempfile, unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("spec_truth", REPO / "scripts/spec_truth.py")
st = importlib.util.module_from_spec(spec); spec.loader.exec_module(st)

SPEC = """# US-SPEC-03

## 5. Normative requirements

- Not a status line: BUILT (`core/nowhere.js`).

## 9. Reference implementation status

- Tick: BUILT in `core/src/tick.js` (tests: `core/test/tick.test.js`).
- Console: BUILT in `core/ui/gone.js`.
- Ledger: BUILT, with passing tests.
- Fleet: PLANNED. Built toward it: `core/fleet/absent.js`.

| Capability | Status |
|---|---|
| Seed kit | BUILT (`bootstrap/boot.py`; `bootstrap/missing.py`) |
"""


def tree(d):
    d = Path(d)
    for p in ("specs", "workers/core/src", "workers/core/test", "seed/bootstrap"):
        (d / p).mkdir(parents=True)
    (d / "specs/US-SPEC-03-tick.md").write_text(SPEC)
    for p in ("workers/core/src/tick.js", "workers/core/test/tick.test.js", "seed/bootstrap/boot.py"):
        (d / p).write_text("x\n")
    return d


class SpecTruth(unittest.TestCase):
    def test_repository_has_no_false_built_outside_the_baseline(self):
        self.assertEqual(st.check(), [])

    def test_baseline_only_shrinks(self):
        b = json.loads((REPO / st.BASELINE).read_text("utf-8"))
        self.assertLessEqual(len(b["rows"]), b["ceiling"])
        self.assertLessEqual(b["ceiling"], 1, "the ceiling was 1 when the check was wired and may only fall")

    def test_missing_unnamed_and_partly_missing_paths_are_findings(self):
        with tempfile.TemporaryDirectory() as d:
            d = tree(d)
            keys = sorted(st.key(f) for f in st.findings(d))
            self.assertEqual(len(keys), 3, keys)
            self.assertTrue(any("none of the named paths exist: core/ui/gone.js" in k for k in keys))
            self.assertTrue(any("names no file" in k for k in keys))
            self.assertTrue(any("some named paths do not exist: bootstrap/missing.py" in k for k in keys))
            self.assertFalse(any("nowhere" in k or "absent" in k for k in keys), "only BUILT lines of the status section are read")
            self.assertEqual(len(st.check(d, {"ceiling": 0, "rows": []})), 3)

    def test_a_baselined_row_passes_a_fixed_one_must_leave_and_the_ceiling_holds(self):
        with tempfile.TemporaryDirectory() as d:
            d = tree(d)
            keys = sorted(st.key(f) for f in st.findings(d))
            self.assertEqual(st.check(d, {"ceiling": 3, "rows": keys}), [])
            self.assertTrue(any("above its ceiling" in b for b in st.check(d, {"ceiling": 2, "rows": keys})))
            (d / "workers/core/ui").mkdir(); (d / "workers/core/ui/gone.js").write_text("x\n")
            bad = st.check(d, {"ceiling": 3, "rows": keys})
            self.assertEqual(len(bad), 1); self.assertIn("no longer failing", bad[0])


if __name__ == "__main__":
    unittest.main()

"""US-SPEC-03: the L3 kernel step list is an executable registry (doctrine/kernel.json), the specification's section 5 table is that registry, and the
seed runtime tick's step table in section 3.4 is the code's own step list. Words match code (CLAIMS-1): none of the tables below is typed apart from the
code it describes, and this test fails when one drifts.

Run from the repository root: python3 -m unittest discover -s tests/foundation -p test_spec_03_kernel_steps.py"""
import json
import re
import unittest
from pathlib import Path

from _repo import ROOT, spec_files
from foundation import kernel

TICK_STATES = ["done", "remediated", "backlogged_with_trigger"]


def section(text: str, start: str, end: str) -> str:
    a = text.index(start)
    b = text.index(end, a + len(start))
    return text[a:b]


def table_rows(block: str):
    """Rows of a markdown table as lists of cells, header and separator rows left out."""
    out = []
    for line in block.splitlines():
        if not line.startswith("|") or set(line.replace("|", "").strip()) <= set("-: "):
            continue
        out.append([c.strip() for c in line.strip().strip("|").split("|")])
    return out[1:]


class KernelSteps(unittest.TestCase):
    def setUp(self):
        self.reg = json.loads((ROOT / "doctrine/kernel.json").read_text())
        self.text = spec_files("US-SPEC-03-*.md")[0].read_text()

    def test_us_03_t09_every_kernel_step_names_code_that_exists(self):
        steps = self.reg["tick_steps"]
        self.assertEqual(len(steps), 20)
        self.assertEqual(len({s["id"] for s in steps}), 20, "step ids are unique")
        for s in steps:
            self.assertTrue((ROOT / s["implemented_by"]).is_file(), f"{s['id']} -> {s['implemented_by']}")
            self.assertTrue(s["paths"] and s["paths"][0]["id"] == "primary", s["id"])
            how = s["paths"][0]["how"]
            self.assertTrue((ROOT / how).is_file(), f"{s['id']} primary path {how}")
            self.assertTrue(any(p["id"] == "degraded" for p in s["paths"]), f"{s['id']} has a degraded path (no single route)")
        self.assertEqual(self.reg["tick_states"], TICK_STATES)

    def test_us_03_t09_the_registry_is_the_one_foundation_kernel_check_reads(self):
        self.assertEqual(kernel.check(ROOT), [])

    def test_us_03_t09_the_specification_table_of_section_5_is_the_registry(self):
        rows = table_rows(section(self.text, "## 5.", "## 6."))
        got = [(r[1].strip("`"), r[2].strip("`")) for r in rows if len(r) >= 3 and r[1].startswith("`")]
        want = [(s["id"], s["implemented_by"]) for s in self.reg["tick_steps"]]
        self.assertEqual(got, want, "section 5 lists every step of doctrine/kernel.json in order, with the file that implements it")
        for state in TICK_STATES:
            self.assertIn(f"`{state}`", section(self.text, "## 5.", "## 6."))

    def test_us_03_r22_the_specification_table_of_the_seed_tick_is_the_code(self):
        code = (ROOT / "seed/worker/src/tick.js").read_text()
        order = re.search(r"export const STEP_ORDER = \[(.*?)\];", code, re.S).group(1)
        want = re.findall(r"'([a-z_]+)'", order)
        rows = table_rows(section(self.text, "### 3.4", "## 4."))
        got = [r[1].strip("`") for r in rows if len(r) >= 3 and r[1].startswith("`")]
        self.assertEqual(got, want, "section 3.4 lists the steps of seed/worker/src/tick.js STEP_ORDER, in order")
        for r in rows:
            if len(r) >= 3 and r[1].startswith("`"):
                files = re.findall(r"`(seed/worker/src/[A-Za-z0-9_.]+)`", r[2])
                for f in files:
                    self.assertTrue((ROOT / f).is_file(), f"{r[1]} names {f}")

    def test_us_03_r22_the_deferral_constants_the_specification_states_are_the_code_values(self):
        code = (ROOT / "seed/worker/src/tick.js").read_text()
        essential = re.findall(r"'([a-z_]+)'", re.search(r"export const COST_ESSENTIAL_STEPS = \[(.*?)\];", code).group(1))
        lean = int(re.search(r"export const LEAN_EVERY_H = (\d+);", code).group(1))
        block = section(self.text, "### 3.4", "## 4.")
        for step in essential:
            self.assertIn(f"`{step}`", block)
        self.assertIn(f"every {lean} hours", block)
        inflight = int(re.search(r"export const INFLIGHT_MS = (\d+)e3;", code).group(1))
        self.assertIn(f"{inflight // 60} minutes", block)
        cap = int(re.search(r"export const ORIGINATE_MAX_PER_DAY = (\d+);", code).group(1))
        self.assertIn(f"{cap} items", self.text)


if __name__ == "__main__":
    unittest.main()

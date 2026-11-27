# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SPEC-IDS-1: a requirement ID is never renumbered, removed or reused.

The newer fixtures use specification number 77, which no real specification has, and build their IDs from a prefix, so this file
names no requirement that no specification defines."""
import contextlib, importlib.util, io, json, shutil, tempfile, unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("spec_ids", REPO / "scripts/spec_ids.py")
si = importlib.util.module_from_spec(spec); spec.loader.exec_module(si)

P = "US-"
R1, R2, R3, R4, R5, R6, T1 = (f"{P}77-{k}" for k in ("R01", "R02", "R03", "R04", "R05", "R06", "T01"))


def write(root, name, text):
    (root / "specs").mkdir(parents=True, exist_ok=True)
    (root / "specs" / name).write_text(text, encoding="utf-8")


class SpecIds(unittest.TestCase):
    def test_repository_ids_are_stable(self):
        self.assertEqual(si.check(), [])
        d = si.defined()
        self.assertGreater(len(d), 100)
        # the three definition forms the public specifications use: a list item, a table row, a bold paragraph
        self.assertIn("US-03-R01", d); self.assertIn("US-19-R01", d); self.assertIn("US-15-R02", d)

    def test_removed_renumbered_reused_and_misplaced_ids_fail(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d); (d / "specs").mkdir()
            (d / "specs/US-SPEC-03-tick.md").write_text("- **US-03-R01 [L1]** a\n- **US-03-R02 [L1]** b\n")
            self.assertEqual(si.check(d, ["US-03-R01", "US-03-R02"]), [])
            (d / "specs/US-SPEC-03-tick.md").write_text("- **US-03-R01 [L1]** a\n- **US-03-R03 [L1]** b renumbered\n")
            bad = si.check(d, ["US-03-R01", "US-03-R02"])
            self.assertTrue(any(b.startswith("US-03-R02: recorded but no longer defined") for b in bad))
            self.assertTrue(any(b.startswith("US-03-R03: defined but not recorded") for b in bad))
            (d / "specs/US-SPEC-04-plus.md").write_text("- **US-03-R01 [L1]** reused elsewhere\n- **US-03-R09** wrong file\n")
            bad = si.check(d, ["US-03-R01", "US-03-R03", "US-03-R09"])
            self.assertTrue(any("defined 2 times" in b for b in bad)); self.assertTrue(any(b.startswith("US-03-R09: defined in US-SPEC-04") for b in bad))

    def test_us_00_r11_a_requirement_is_defined_by_a_list_item_a_table_row_or_a_bold_paragraph(self):
        text = (f"# US-SPEC-77\n\n- **{R1} [L1]** The gate MUST close when its probe passes.\n\n"
                f"**{R2}.** Each claim MUST carry a heartbeat\nand a time to live.\n\n"
                "| ID | Requirement |\n|---|---|\n"
                f"| {R3} | A reaper MUST release a claim whose heartbeat is stale. |\n\n"
                f"- **{T1}** Stop the clock. Pass: the watch route starts a tick.\n\n"
                # none of these defines: a status table, a first cell naming several ids, a bold mention without its period,
                # an id in a later cell, an id inside a sentence
                f"| Req | Status |\n|---|---|\n| {R4} | BUILT in `a.js` |\n\n"
                f"| ID | Requirement |\n|---|---|\n| {R4} (alias), R05 | covered above |\n| x | {R4} |\n\n"
                f"**{R4}** is covered in Section 5.\n\nSee {R4} for the reaper.\n")
        with tempfile.TemporaryDirectory() as d:
            d = Path(d); write(d, "US-SPEC-77-example.md", text)
            self.assertEqual(si.defined(d), {R1: ["US-SPEC-77-example.md"], R2: ["US-SPEC-77-example.md"], R3: ["US-SPEC-77-example.md"]})
            defs = si.definitions(d, kinds="RT")
            self.assertEqual({i: [(x.form, x.line) for x in v] for i, v in defs.items()},
                             {R1: [("list", 3)], R2: [("bold", 5)], R3: [("table", 10)], T1: [("list", 12)]})
            self.assertIn("time to live", defs[R2][0].text, "a bold paragraph runs to the blank line that ends it")
            self.assertIn("reaper", si.words(defs[R3][0].text))
            self.assertEqual(si.check(d, [R1, R2, R3]), [], "the ledger holds requirement IDs only; a conformance test ID is not required in it")
            self.assertEqual([b.split(":")[0] for b in si.check(d, [R1])], [R2, R3], "an ID in a new form is defined but not recorded")

    def test_us_00_r11_a_restatement_in_one_file_is_one_definition_and_a_second_meaning_is_a_reuse(self):
        para = f"**{R1}.** At initiation the project manager MUST set `delivery_mode` and record the reason.\n\n"
        table = "| ID | Requirement |\n|---|---|\n"
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            write(d, "US-SPEC-77-example.md", para + table + f"| {R1} | `delivery_mode` set and justified at initiation. |\n")
            self.assertEqual(si.check(d, [R1]), [], "a summary table that restates a paragraph is one requirement")
            write(d, "US-SPEC-77-example.md", para + table + f"| {R1} | Every deliverable has a closing probe another agent runs. |\n")
            bad = si.check(d, [R1])
            self.assertEqual(len(bad), 1); self.assertIn("defined 2 times", bad[0]); self.assertIn("US-SPEC-77-example.md:1", bad[0])
            self.assertIn("US-SPEC-77-example.md:5", bad[0]); self.assertIn("share", bad[0])
            # in two files an ID is reused whatever its words: each ID is defined by one specification
            write(d, "US-SPEC-77-example.md", para); write(d, "US-SPEC-77-other.md", para)
            bad = si.check(d, [R1])
            self.assertTrue(any("defined 2 times" in b and "US-SPEC-77-example.md" in b and "US-SPEC-77-other.md" in b for b in bad))
            # a withdrawn line keeps its ID: a live row under the same ID in the same file is a second requirement
            (d / "specs/US-SPEC-77-other.md").unlink()
            write(d, "US-SPEC-77-example.md", f"- **{R1} [L1]** Withdrawn in 0.3.0.\n\n" + table + f"| {R1} | Every deliverable has a closing probe. |\n")
            self.assertTrue(any("defined 2 times" in b for b in si.check(d, [R1])))
            # two list items under one ID in one file are two requirements, however many words they share
            write(d, "US-SPEC-77-example.md", f"- **{R1} [L1]** The scorer MUST grade every due prediction against the measured metric and "
                  f"record the result.\n- **{R1} [L1]** The scorer MUST grade every due prediction against the measured metric within one "
                  f"hour and file a lesson on a miss.\n")
            bad = si.check(d, [R1])
            self.assertEqual(len(bad), 1); self.assertIn("defined 2 times", bad[0]); self.assertIn("one form", bad[0])

    def test_us_00_r11_the_overlap_coefficient_keeps_an_id_extended_in_place_and_jaccard_would_not(self):
        old = si.words("A claim MUST carry a heartbeat and a time to live.")
        new = si.words("A claim MUST carry a heartbeat and a time to live; the reaper releases a stale one, records the release with its "
                       "reason, files an item when the same claim is released three times, and never releases a claim whose holder renewed it.")
        self.assertLess(si.jaccard(old, new), si.REUSE_MIN_OVERLAP)
        self.assertEqual(si.overlap(old, new), 1.0)
        other = si.words("Every deliverable MUST have a closing probe a different agent can run.")
        self.assertLess(si.overlap(old, other), si.REUSE_MIN_OVERLAP)
        self.assertEqual(si.overlap(frozenset(), old), 0.0, "a definition with no words shares nothing")
        self.assertEqual(si.words("The [L2] **gate** MUST close"), frozenset({"gate", "close"}), "markup, level tags, function words and RFC 2119 keywords carry no meaning")

    def test_us_00_r11_reuse_reports_an_id_two_spec_trees_define_with_different_meanings(self):
        a_text = (f"- **{R1} [L1]** A claim MUST carry a heartbeat and a time to live.\n"
                  f"- **{R2} [L1]** The gate MUST close when its probe passes and record the evidence.\n"
                  f"- **{R3} [L1]** A reaper MUST release a claim whose heartbeat is stale.\n"
                  f"- **{R4} [L1]** The dashboard MUST show the age of every open item.\n"
                  f"- **{T1}** Stop the clock for two intervals. Pass: the watch route starts a tick.\n"
                  f"- **{R5} [L1]** The tick MUST record every step it ran.\n"
                  f"- **{R6} [L1]** Withdrawn in 0.1.0.\n")
        b_text = (f"- **{R1} [L1]** A claim MUST carry a heartbeat and a time to live; the reaper releases a stale one, records the release "
                  "with its reason, files an item when the same claim is released three times, and never releases a renewed claim.\n"
                  f"- **{R2} [L1]** Every deliverable MUST have a closing probe a different agent can run.\n"
                  f"- **{R4} [L1]** Withdrawn in 0.2.0.\n"
                  f"- **{T1}** Write a migration that drops a table. Pass: the runner refuses it.\n"
                  # a definition that only mentions the phrase is not a withdrawal; this is another requirement under R05's ID
                  f"- **{R5} [L1]** A requirement that is retired keeps its line, which reads Withdrawn in <version>.\n"
                  # an ID the recorded text withdrew may not come back as another requirement
                  f"- **{R6} [L1]** The console MUST answer within two seconds.\n")
        with tempfile.TemporaryDirectory() as d:
            d = Path(d); a, b = d / "a", d / "b"
            write(a, "US-SPEC-77-example.md", a_text); write(b, "US-SPEC-77-example.md", b_text)
            r = si.compare(a, b / "specs")  # a repository root or its specs directory
            self.assertEqual([x["id"] for x in r["reused"]], [R2, R5, R6, T1], "R01 grew in place and R04 was withdrawn: neither is a reuse")
            self.assertEqual(r["dropped"], [R3])
            self.assertEqual(r["withdrawn"], [R4])
            self.assertEqual(r["shared"], {"R": 5, "T": 1})
            self.assertEqual(r["lowest"]["R"], (0.0, R5), "the lowest same-ID score is reported with its ID")
            first, test = r["reused"][0], r["reused"][-1]
            self.assertLess(first["overlap"], si.REUSE_MIN_OVERLAP)
            self.assertEqual((test["kind"], si.THRESHOLDS["T"]), ("T", si.REUSE_MIN_OVERLAP_TEST), "a test ID is held to the test threshold")
            self.assertGreater(si.REUSE_MIN_OVERLAP_TEST, si.REUSE_MIN_OVERLAP, "tests share a template, so unrelated ones overlap more")
            self.assertEqual((first["a"].split(":")[0], first["b"].split(":")[1]), ("US-SPEC-77-example.md", "2 (list)"))
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                code = si.main(["--reuse", str(a), str(b)])
            self.assertEqual(code, 1)
            text = out.getvalue()
            self.assertIn(f"{R2}: reused", text); self.assertIn(f"{T1}: reused", text); self.assertIn(f"{R3}: dropped", text)
            self.assertNotIn("heartbeat", text, "the report names files and lines, never definition text (DISCLOSE-1)")
            self.assertNotIn("deliverable", text)
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(si.main(["--reuse", str(a), str(a)]), 0)
            self.assertIn("0 reused, 0 dropped", out.getvalue())

    def test_us_00_r11_the_public_tree_needs_only_its_new_ids_recorded(self):
        # every problem the reader finds on this tree is an ID it now reads that the ledger lacks; recording them passes the check
        self.assertEqual([b for b in si.check() if "defined but not recorded" not in b], [])
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            shutil.copytree(REPO / "specs", d / "specs")
            (d / "doctrine").mkdir(); shutil.copy(REPO / si.LEDGER, d / si.LEDGER)
            before = set(json.loads((d / si.LEDGER).read_text("utf-8"))["ids"])
            si.record(d)
            after = set(json.loads((d / si.LEDGER).read_text("utf-8"))["ids"])
            self.assertLessEqual(before, after, "recording only adds")
            self.assertEqual(after - before, {b.split(":")[0] for b in si.check(REPO)})
            self.assertEqual(si.check(d), [])


if __name__ == "__main__":
    unittest.main()

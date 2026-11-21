# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""DISPOSE-1: every open item gets a recorded disposition inside the limit (gate, shelved), a disposed item is never reopened by its failing probe,
a later pass turns it into fixed, and shelved items come back to the executor only when its open queue is empty.
PATCH-EDIT-1: a reply may change part of a file with find-and-replace edits, applied only to an exact or unambiguous place."""
import json, shutil, sys, unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from foundation import agents, contracts as C, dispose as D, executor as E, queue  # noqa: E402
sys.path.insert(0, str(Path(__file__).resolve().parent))
from _repo import scratch  # noqa: E402

T0 = datetime(2026, 11, 20, 12, 0, tzinfo=timezone.utc)


def item(d, iid, owner="executor", probe="file:marker.txt", status="open", labels=()):
    body = f"**Owner:** {owner}\n**Trigger:** t\n**Done check:** {probe}\n**Status:** {status}\n\nx"
    (d / "docs/issues" / f"{iid}.json").write_text(json.dumps({"id": iid, "title": iid, "body": body, "labels": list(labels)}), encoding="utf-8")


def repo():
    d = scratch()
    (d / "docs/issues").mkdir(parents=True); (d / "doctrine").mkdir(); (d / "ops").mkdir()
    for f in ("qnfo-port.json", "dispose.json"):
        shutil.copy(ROOT / "doctrine" / f, d / "doctrine" / f)
    return d


def body(d, iid):
    return json.loads((d / "docs/issues" / f"{iid}.json").read_text(encoding="utf-8"))["body"]


def born(days, *ids, hours=None):
    return {f"{i}.json": (T0 - (timedelta(hours=hours) if hours is not None else timedelta(days=days))).isoformat() for i in ids}


class Dispose(unittest.TestCase):
    def run_pass(self, d, fails=None, born_=None, apply=True):
        return D.run(d, apply=apply, now=T0, fails=fails or {}, born=born_ or {}, details={})

    def test_owner_bound_item_is_gated_at_once_with_the_default(self):
        d = repo(); item(d, "OL-1", owner="ROWAN (identity-bound)"); item(d, "Q-2", labels=["identity-bound"]); item(d, "Q-3")
        rows = self.run_pass(d)
        self.assertEqual({r["id"]: r["disposition"] for r in rows}, {"OL-1": "gate", "Q-2": "gate"})
        b = body(d, "OL-1")
        self.assertIn("**Status:** closed", b); self.assertIn("**Disposition:** gate (owner-bound", b); self.assertIn("Default in effect", b)
        self.assertEqual(queue.check(d), [])  # a disposed item carries evidence, so the queue check accepts it

    def test_three_failed_runs_shelve_and_young_items_stay_open(self):
        d = repo(); item(d, "Q-1"); item(d, "Q-2")
        rows = self.run_pass(d, fails={"Q-1": 3, "Q-2": 2}, born_=born(0, "Q-1", "Q-2", hours=1))
        self.assertEqual([(r["id"], r["rule"]) for r in rows], [("Q-1", "executor-failed")])
        self.assertIn("**Status:** open", body(d, "Q-2"))

    def test_ttl_shelves_every_kind_of_item_file_and_dry_run_writes_nothing(self):
        d = repo(); item(d, "Q-1"); item(d, "WEB-9", owner="Ops", probe="Preview returns 200"); item(d, "Q-NEW")
        b = {**born(0, "Q-1", "WEB-9", hours=7), **born(0, "Q-NEW", hours=5)}  # SLA-8H-1: ttl_hours 6
        self.assertEqual(len(self.run_pass(d, born_=b, apply=False)), 2)
        self.assertIn("**Status:** open", body(d, "Q-1"))
        rows = self.run_pass(d, born_=b)
        self.assertEqual({r["id"] for r in rows}, {"Q-1", "WEB-9"})
        self.assertIn("shelved (ttl", body(d, "WEB-9"))
        self.assertEqual(self.run_pass(d, born_=b), [])  # idempotent: a disposed item is not disposed again
        self.assertEqual(len((d / "ops/dispose.jsonl").read_text(encoding="utf-8").splitlines()), 2)

    def test_a_disposed_item_leaves_the_pins_baseline(self):
        d = repo(); item(d, "OL-1", owner="ROWAN (identity-bound)"); item(d, "WEB-9", owner="Ops")
        (d / "doctrine/pins-baseline.json").write_text(json.dumps({"_doc": "x", "unprobed": ["OL-1", "WEB-9"]}), encoding="utf-8")
        self.run_pass(d)
        self.assertEqual(json.loads((d / "doctrine/pins-baseline.json").read_text(encoding="utf-8"))["unprobed"], ["WEB-9"])

    def test_an_undated_item_is_never_shelved_by_age(self):
        d = repo(); item(d, "Q-1")
        self.assertEqual(self.run_pass(d), [])

    def test_disposed_item_is_not_reopened_and_becomes_fixed_when_its_probe_passes(self):
        d = repo(); item(d, "Q-1")
        C.tick(d, apply=True, now=T0 - timedelta(days=1), probe=lambda s: ("pass", s))  # seen passing once, long ago
        C.tick(d, apply=True, now=T0 - timedelta(hours=20), probe=lambda s: ("fail", s))
        self.run_pass(d, fails={"Q-1": 3})
        r = C.tick(d, apply=True, now=T0 + timedelta(hours=1), probe=lambda s: ("fail", s))
        self.assertEqual([x["action"] for x in r["rows"]], ["disposed"])
        self.assertIn("**Status:** closed", body(d, "Q-1"))
        r = C.tick(d, apply=True, now=T0 + timedelta(hours=2), probe=lambda s: ("pass", s))
        self.assertEqual([x["action"] for x in r["rows"]], ["fulfilled"])
        self.assertIn("**Disposition:** fixed", body(d, "Q-1"))

    def test_revive_only_after_the_wait_and_only_shelved_queue_items(self):
        d = repo(); item(d, "Q-1"); item(d, "Q-2"); item(d, "OL-3", owner="ROWAN"); item(d, "WEB-9", probe="prose")
        self.run_pass(d, fails={"Q-1": 3, "Q-2": 3}, born_=born(20, "WEB-9"))
        rows = [{"issue": "Q-1", "at": "2026-11-20T10:00:00Z", "result": "failed"}, {"issue": "Q-2", "at": "2026-11-19T10:00:00Z", "result": "failed"}]
        self.assertEqual(D.revive(d, now=T0 + timedelta(days=29), rows=rows), [])
        got = D.revive(d, now=T0 + timedelta(days=31), rows=rows)
        self.assertEqual([i["id"] for i in got], ["Q-1"])  # one per pass; both wait from their shelving, ties go by id
        queue.close(d, "Q-1", "closed by the pull request that carries this change")
        self.assertIn("**Disposition:** fixed", body(d, "Q-1"))

    def test_report_and_check(self):
        d = repo(); item(d, "Q-1"); item(d, "Q-2", status="closed")
        self.assertEqual(D.report(d, now=T0)["counts"], {"closed": 1, "open": 1})
        self.assertEqual(D.check(d, now=T0), [])
        cfg = json.loads((d / "doctrine/dispose.json").read_text(encoding="utf-8")); cfg["ttl_days"] = 0; cfg.pop("ttl_hours", None)
        (d / "doctrine/dispose.json").write_text(json.dumps(cfg), encoding="utf-8")
        self.assertTrue(D.check(d, now=T0))

    def test_the_live_rules_are_well_formed_and_the_fleet_pass_calls_them(self):
        c = D.cfg(ROOT)
        self.assertLessEqual(c["ttl_days"], 31)  # "not for months"
        self.assertLessEqual(D.ttl_days(c) * 24, 6)  # SLA-8H-1: shelved before 8 hours with a 10-minute fleet pass to spare
        self.assertIn("dispose.run(root, apply=apply)", (ROOT / "foundation/queue.py").read_text(encoding="utf-8"))
        self.assertIn("queue --run --apply --publish", (ROOT / ".github/workflows/fleet.yml").read_text(encoding="utf-8"))


class PatchEdit(unittest.TestCase):
    SRC = "def a():\n    x = 1\n    return x\n\n\ndef b():\n    y = 1\n    return y\n"

    def test_exact_edit(self):
        self.assertEqual(agents.apply_edit(self.SRC, "    x = 1\n", "    x = 2\n"), self.SRC.replace("x = 1", "x = 2"))

    def test_edit_without_indentation_is_placed_and_reindented(self):
        out = agents.apply_edit(self.SRC, "y = 1\nreturn y", "y = 5\nreturn y + 1")
        self.assertIn("    y = 5\n    return y + 1\n", out); self.assertIn("    x = 1\n", out)

    def test_missing_or_ambiguous_place_is_refused(self):
        for find in ("z = 9", "def"):
            with self.assertRaises(ValueError):
                agents.apply_edit(self.SRC, find, "q")
        with self.assertRaises(ValueError):
            agents.apply_edit("a = 1\nb\na = 1\n", "a = 1", "a = 2")

    def test_reply_with_edit_and_file_blocks_parses(self):
        reply = "SUMMARY: s\n<<<EDIT m.py>>>\n<<<FIND>>>\n    x = 1\n<<<REPLACE>>>\n    x = 2\n<<<END>>>\n<<<EDIT m.py>>>\n<<<FIND>>>\n    y = 1\n<<<REPLACE>>>\n<<<END>>>\n<<<FILE n.txt>>>\nnew\n<<<END>>>"
        out = agents.parse_json(reply)
        self.assertEqual(out["summary"], "s")
        self.assertEqual([f["path"] for f in out["files"]], ["n.txt", "m.py"])
        self.assertEqual(out["files"][1]["edits"], [{"find": "    x = 1", "replace": "    x = 2"}, {"find": "    y = 1", "replace": ""}])

    def test_executor_applies_edits_to_the_file_and_writes_nothing_when_one_fails(self):
        d = scratch(); (d / "m.py").write_text(self.SRC, encoding="utf-8")
        E.apply_edits([{"path": "m.py", "edits": [{"find": "    x = 1", "replace": "    x = 2"}]}], d)
        self.assertIn("x = 2", (d / "m.py").read_text(encoding="utf-8")); self.assertIn("def b():", (d / "m.py").read_text(encoding="utf-8"))
        with self.assertRaises(ValueError):
            E.apply_edits([{"path": "new.txt", "content": "n"}, {"path": "m.py", "edits": [{"find": "nope", "replace": "q"}]}], d)
        self.assertFalse((d / "new.txt").exists())
        with self.assertRaises(ValueError):
            E.apply_edits([{"path": ".github/workflows/x.yml", "edits": [{"find": "", "replace": "q"}]}], d)

    def test_prompt_shows_the_named_file_and_asks_for_edits(self):
        d = scratch(); (d / "site").mkdir(); (d / "site/big.js").write_text("// head\n" + "const filler = 1;\n" * 900 + "export function pilot_form() {\n  return 1;\n}\n", encoding="utf-8")
        (d / "site/small.js").write_text("export const a = 1;\n", encoding="utf-8")
        issue = {"number": "Q-X", "title": "change pilot_form in site/big.js", "body": "see `site/small.js` and docs/issues/Q-X.json and site/missing.js\n**Done check:** grep:site/big.js::pilot_form_v2"}
        self.assertEqual(E.named_files(issue, d), ["site/big.js", "site/small.js"])
        ctx = E.file_context(issue, d)
        self.assertIn("EXCERPT", ctx); self.assertIn("export function pilot_form() {", ctx); self.assertIn("lines not shown", ctx)
        self.assertIn("site/small.js (1 lines, complete)", ctx); self.assertLess(len(ctx), 12000)
        self.assertIn("<<<EDIT relative/path>>>", agents.BLOCK_FORMAT)
        self.assertIn("agents_block_format()", (ROOT / "foundation/executor.py").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-SPEC-32 (open standards and agent-consumable surfaces): the Python side. The standards register and its audit, the config contracts and their validator,
the open-standards gate, the CloudEvents twin, commit titles and versions, the SBOM, the supply-chain reading, the agent-standards register and the findability
reading. Each test is named by the requirement it proves. Every tree is a scratch directory (removed when the test ends), every network read is a fake, and the date
of a reading is a parameter.

Run from the repository root: python3 -m unittest discover -s tests/foundation -p test_spec_32_standards.py"""
import contextlib
import datetime as dt
import importlib.util
import io
import json
import subprocess
import sys
import unittest
from pathlib import Path

from _repo import ROOT, scratch, git, tiny_repo
from foundation import (agentstd, cloudevents, commitlint, configschema, findable, openstd, schemas, semrel, standards, stdgen, supplychain)

sys.path.insert(0, str(ROOT / "scripts"))
import build_site_agentdata  # noqa: E402

_spec = importlib.util.spec_from_file_location("seed_stdkit", ROOT / "seed/scripts/stdkit.py")
kit = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(kit)


def w(root, rel, content):
    p = Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content if isinstance(content, str) else json.dumps(content, indent=1), encoding="utf-8")
    return p


def row(i, **kw):
    r = {"id": i, "name": i.upper(), "body": "a body", "status": "stable", "tracked": "1.0", "why": "because", "support": "not_applicable", "reason": "not needed here",
         "sources": [{"title": "t", "url": "https://example.org/s", "accessed": "2026-11-25"}]}
    r.update(kw)
    return r


SURFACES = {"contract_version": "1.0.0", "surfaces": [{"id": "home", "path": "/", "methods": ["GET"], "kind": "ui", "audience": "owner", "standards": [], "discoverable": False, "reason": "a human screen", "description": "Now screen."}]}


def mini(entries, files=None, surfaces=None, **reg_kw):
    """A scratch tree that passes `standards.check` with the rows given: the register, its schema, one surface, the snapshot, the served entry and the generated table."""
    td = scratch()
    reg = {"version": "1", "checked": "2026-11-25", "stale_after_days": 120, "undecided_ceiling": 99, "bodies": [{"id": "b", "name": "B", "role": "r"}], "entries": entries}
    reg.update(reg_kw)
    w(td, standards.REG, reg)
    w(td, standards.SCHEMA, (ROOT / standards.SCHEMA).read_text(encoding="utf-8"))
    w(td, standards.SURF, surfaces or SURFACES)
    w(td, standards.SNAP, {"contract_version": "1.0.0", "tools": []})
    w(td, standards.ENTRY, "export default { fetch() { return null; } };\n")
    try:
        w(td, standards.DOC, "# Standards\n\n" + standards.table(reg) + "\n")
    except KeyError:  # a row with a support level the table has no word for: the schema check says so before the table is read
        w(td, standards.DOC, "# Standards\n")
    for rel, text in (files or {}).items():
        w(td, rel, text)
    return td


def refresh_doc(td):
    reg = json.loads((td / standards.REG).read_text())
    w(td, standards.DOC, "# Standards\n\n" + standards.table(reg) + "\n")


def edit_reg(td, fn):
    p = td / standards.REG
    reg = json.loads(p.read_text())
    fn(reg)
    p.write_text(json.dumps(reg))
    refresh_doc(td)


SUPPORTED = dict(support="supported", how=["src/a.js"], tests=[{"file": "test/a.test.js", "name": "a thing holds"}])
FILES = {"src/a.js": "x", "test/a.test.js": "test('a thing holds', () => {})"}


class Register(unittest.TestCase):
    def test_us_32_r01_a_register_row_is_a_schema_valid_record_with_a_unique_id_and_a_source(self):
        self.assertEqual(standards.check(mini([row("x")])), [])
        bad = standards.check(mini([{k: v for k, v in row("x").items() if k != "why"}]))
        self.assertEqual(bad, ["$.entries[0]: missing why"], "a schema finding stops the check: nothing else is said until the record is valid")
        self.assertTrue(any("does not match" in b for b in standards.check(mini([row("Bad Id")]))))
        self.assertTrue(any("is not one of" in b for b in standards.check(mini([row("x", support="maybe")]))))
        self.assertTrue(any("needs at least 1 items" in b for b in standards.check(mini([row("x", sources=[])]))))
        self.assertIn("register: duplicate standard id", standards.check(mini([row("x"), row("x")])))
        self.assertEqual(standards.check(ROOT), [], "the repository's own register passes")

    def test_us_32_r02_a_support_level_is_a_claim_that_names_its_code_its_test_and_its_gap(self):
        self.assertEqual(standards.check(mini([row("x", **SUPPORTED)], FILES)), [])
        def f(rows, files=FILES):
            return standards.check(mini(rows, files))
        self.assertTrue(any("x: supported needs `how` paths" in b for b in f([row("x", support="supported", tests=SUPPORTED["tests"])])))
        self.assertTrue(any("x: how path missing: src/none.js" in b for b in f([row("x", **{**SUPPORTED, "how": ["src/none.js"]})])))
        self.assertTrue(any("x: supported needs at least one test" in b for b in f([row("x", support="supported", how=["src/a.js"])])))
        self.assertTrue(any("x: test file missing: test/none.test.js" in b for b in f([row("x", **{**SUPPORTED, "tests": [{"file": "test/none.test.js", "name": "n"}]})])))
        self.assertTrue(any("x: test 'not in the file' not found in test/a.test.js" in b for b in f([row("x", **{**SUPPORTED, "tests": [{"file": "test/a.test.js", "name": "not in the file"}]})])))
        self.assertTrue(any("x: partial support must state the gap" in b for b in f([row("x", **{**SUPPORTED, "support": "partial"})])))
        self.assertEqual(f([row("x", **{**SUPPORTED, "support": "partial", "gap": "the task interface"})]), [])
        self.assertTrue(any("x: planned needs tracked_by" in b for b in f([row("x", support="planned")])))
        self.assertTrue(any("x: planned needs tracked_by" in b for b in f([row("x", support="planned", tracked_by="Q-X")])), "a tracked item alone is not enough: it also needs the file where it will land or an audited decision")
        self.assertEqual(f([row("x", support="planned", tracked_by="Q-X", acl="src/a.js")]), [])
        self.assertTrue(any("x: not_applicable needs a reason" in b for b in f([{k: v for k, v in row("x").items() if k != "reason"}])))

    def test_us_32_r03_a_standard_that_is_not_stable_is_kept_behind_one_named_file(self):
        draft = {**SUPPORTED, "status": "draft"}
        self.assertTrue(any("x: status draft but no anti-corruption layer file named in `acl`" in b for b in standards.check(mini([row("x", **draft)], FILES))))
        self.assertEqual(standards.check(mini([row("x", **draft, acl="src/a.js")], FILES)), [])
        self.assertTrue(any("x: acl file missing: src/none.js" in b for b in standards.check(mini([row("x", **draft, acl="src/none.js")], FILES))))
        self.assertEqual(standards.check(mini([row("x", status="draft")])), [], "a row that is not supported or partial has nothing to isolate")

    def test_us_32_r04_a_register_that_has_not_been_re_read_inside_its_window_fails(self):
        td = mini([row("x")], checked="2026-01-01")
        self.assertEqual(standards.check(td, today=dt.date(2026, 5, 1)), [], "120 days after the check is still inside the window")
        late = standards.check(td, today=dt.date(2026, 5, 2))
        self.assertEqual(len(late), 1); self.assertIn("last checked 2026-01-01 (121 days ago)", late[0])
        short = mini([row("x")], checked="2026-01-01", stale_after_days=30)
        self.assertTrue(standards.check(short, today=dt.date(2026, 2, 2)), "the window is the register's own stale_after_days")
        self.assertFalse(standards.check(short, today=dt.date(2026, 1, 31)))
        no_window = mini([row("x")], checked="2026-01-01"); edit_reg(no_window, lambda r: r.pop("stale_after_days"))
        self.assertTrue(standards.check(no_window, today=dt.date(2026, 5, 2)), "with no stated window the default is 120 days")

    def test_us_32_r05_an_audited_row_carries_its_measured_adoption_and_rows_without_a_decision_only_shrink(self):
        audited = dict(decision="adopt-now", adoption="adopted", conformance="Nothing.", cost="none", probes=["file:src/a.js"], audited="2026-11-25", **SUPPORTED)
        td = mini([row("x", **audited)], FILES); reg = json.loads((td / standards.REG).read_text())
        self.assertEqual(standards.audit(td, reg), [])
        for key in ("adoption", "conformance", "cost", "probes", "audited"):
            r = {k: v for k, v in audited.items() if k != key}
            self.assertIn(f"x: an audited row needs `{key}`", standards.audit(td, {"entries": [row("x", **r)], "undecided_ceiling": 9}), key)
        two = {"entries": [row("a"), row("b")], "undecided_ceiling": 1}
        self.assertTrue(any("2 rows carry no decision, above the ceiling 1" in b for b in standards.audit(td, two)))
        self.assertEqual(standards.audit(td, {"entries": [row("a")], "undecided_ceiling": 1}), [])
        reg_real = json.loads((ROOT / standards.REG).read_text())
        self.assertEqual(sum(1 for e in reg_real["entries"] if "decision" not in e), reg_real["undecided_ceiling"], "the ceiling is the count today: a new row arrives audited")

    def test_us_32_r06_the_probes_of_a_row_are_run_not_read(self):
        td = scratch(); w(td, "a/b.txt", "alpha beta\n")
        P = lambda s: standards.probe(td, s)
        self.assertEqual(P("file:a/b.txt"), ""); self.assertEqual(P("file:a/none.txt"), "a/none.txt is missing")
        self.assertEqual(P("grep:a/b.txt::al.ha"), ""); self.assertEqual(P("grep:a/b.txt::gamma"), "a/b.txt does not match gamma"); self.assertEqual(P("grep:a/none.txt::x"), "a/none.txt is missing")
        self.assertEqual(P("glob:a/*.txt"), ""); self.assertEqual(P("glob:a/*.md"), "nothing matches a/*.md")
        self.assertEqual(P("absent:a/*.md"), ""); self.assertEqual(P("absent:a/*.txt"), "a/b.txt exists", "absent: a homegrown or foreign artefact must not exist")
        self.assertEqual(P("bogus:x"), "unknown probe 'bogus:x'")
        self.assertEqual(standards.probe(ROOT, "schemas"), "", "the schemas probe is the config-schema check of the tree it is given")
        self.assertEqual(standards.probe(ROOT, "commits"), "", "the commits probe is the commit-title lint")
        base = dict(support="not_applicable", reason="r", decision="decline", adoption="homegrown", conformance="c", cost="S", audited="2026-11-25", revisit="when")
        out = standards.audit(td, {"entries": [row("x", **base, probes=["file:a/b.txt"], homegrown=["a/none.txt"])], "undecided_ceiling": 9})
        self.assertIn("x: homegrown path missing: a/none.txt", out)
        out = standards.audit(td, {"entries": [row("x", **base, probes=["file:a/none.txt"], homegrown=["a/b.txt"])], "undecided_ceiling": 9})
        self.assertIn("x: probe file fails: a/none.txt is missing", out)

    def test_us_32_r07_each_decision_is_held_to_its_evidence(self):
        td = scratch(); w(td, "src/a.js", "x"); w(td, "docs/issues/Q-STD-FILED.json", "{}")
        base = dict(conformance="c", cost="S", probes=["file:src/a.js"], audited="2026-11-25")
        def one(**kw):
            e = row("x", **{**base, **kw})
            return [b for b in standards.audit(td, {"entries": [e], "undecided_ceiling": 9}) if b.startswith("x:")]
        self.assertEqual(one(decision="adopt-now", adoption="adopted", support="supported"), [])
        self.assertEqual(one(decision="adopt-now", adoption="partial", support="partial"), [])
        self.assertEqual(one(decision="adopt-now", adoption="homegrown", homegrown=["src/a.js"], support="supported"), ["x: adopt-now means adopted or partial, with support supported or partial"])
        self.assertTrue(one(decision="adopt-now", adoption="adopted", support="planned"))
        self.assertTrue(any("adopt-later needs `tracked_by` naming a filed item" in b for b in one(decision="adopt-later", adoption="homegrown", homegrown=["src/a.js"], support="planned", tracked_by="Q-NOT-FILED")))
        self.assertTrue(any("adopt-later needs" in b for b in one(decision="adopt-later", adoption="homegrown", homegrown=["src/a.js"], support="planned", tracked_by="not an id")))
        self.assertEqual(one(decision="adopt-later", adoption="homegrown", homegrown=["src/a.js"], support="planned", tracked_by="Q-STD-FILED"), [])
        self.assertEqual(one(decision="decline", adoption="homegrown", homegrown=["src/a.js"], reason="r", revisit="when X"), [])
        for kw in ({"reason": "", "revisit": "w"}, {"reason": "r", "revisit": ""}, {"reason": "r", "revisit": "w", "support": "supported"}):
            self.assertTrue(any("a declined row needs a reason" in b for b in one(decision="decline", adoption="homegrown", homegrown=["src/a.js"], **{"support": "not_applicable", **kw})), kw)
        self.assertTrue(any("adoption homegrown must name the homegrown paths" in b for b in one(decision="decline", adoption="homegrown", reason="r", revisit="w")))

    def test_us_32_r08_a_watched_standard_has_its_release_feed_in_the_scout_and_the_scout_names_no_unknown_standard(self):
        td = scratch(); w(td, "src/a.js", "x"); w(td, "doctrine/scout.json", {"sources": [{"id": "mcp-spec", "standard": "mcp"}, {"id": "ghost-spec", "standard": "ghost"}]})
        base = dict(decision="adopt-now", adoption="adopted", support="supported", conformance="c", cost="none", probes=["file:src/a.js"], audited="2026-11-25")
        run = lambda watch: standards.audit(td, {"entries": [row("mcp", **base, watch=watch)], "undecided_ceiling": 9})
        self.assertEqual([b for b in run("mcp-spec") if b.startswith("mcp:")], [])
        self.assertTrue(any("mcp: watch names scout source 'other-spec'" in b for b in run("other-spec")))
        self.assertIn("doctrine/scout.json: source ghost-spec watches standard 'ghost', which is not in the register", run("mcp-spec"))
        no_scout = scratch(); w(no_scout, "src/a.js", "x")
        self.assertEqual(standards.audit(no_scout, {"entries": [row("mcp", **base, watch="anything")], "undecided_ceiling": 9}), [], "with no scout register the link is not checked")
        reg = json.loads((ROOT / standards.REG).read_text()); feeds = {s["standard"]: s["id"] for s in json.loads((ROOT / "doctrine/scout.json").read_text())["sources"] if "standard" in s}
        self.assertEqual(feeds, {e["id"]: e["watch"] for e in reg["entries"] if e.get("watch")}, "in this repository the two sides agree exactly")

    def test_us_32_r09_the_closing_probes_of_a_standards_item_read_the_register_and_not_a_promise(self):
        self.assertEqual(standards.adopted(ROOT, "citation-cff"), [])
        self.assertTrue(any("adoption is 'partial', not adopted" in b for b in standards.adopted(ROOT, "cloudevents")))
        self.assertEqual(standards.adopted(ROOT, "nope"), [f"nope: no such row in {standards.REG}"])
        td = scratch(); w(td, standards.REG, {"entries": [row("x", adoption="adopted", probes=["file:none.txt"])]})
        self.assertEqual(standards.adopted(td, "x"), ["x: probe file fails: none.txt is missing"], "adopted in the data is not adopted when a probe fails")
        def cli(*a):
            out = subprocess.run([sys.executable, "-m", "foundation", "standards", *a], cwd=ROOT, capture_output=True, text=True)
            return out.returncode, out.stdout.strip()
        self.assertEqual(cli("--probe", "mcp"), (0, "mcp: supported")); self.assertEqual(cli("--probe", "a2a"), (1, "a2a: partial")); self.assertEqual(cli("--probe", "no-such-row"), (1, "no-such-row: not in the register"))
        self.assertEqual(cli("--adopted", "citation-cff")[0], 0); self.assertEqual(cli("--adopted", "cloudevents")[0], 1)

    def test_us_32_r10_a_live_reading_names_the_row_the_address_and_what_is_missing_and_an_unreachable_address_is_a_finding(self):
        td = scratch()
        lv = lambda **kw: {"url": "https://example.org/x", **kw}
        w(td, standards.REG, {"entries": [row("a", live=[lv(content_type="json", json_keys=["k"], contains=["hello"])]), row("b", live=[lv(url="https://example.org/gone", status=404)]), row("c", live=[lv(url="https://example.org/down")]), row("d")]})
        pages = {"https://example.org/x": (200, "text/plain", '{"k": "hello"}'), "https://example.org/gone": (404, "text/html", "")}
        def fetch(u):
            if u.endswith("/down"):
                raise ConnectionError("refused " + "x" * 300)
            return pages[u]
        bad = standards.live(td, fetch=fetch)
        self.assertEqual(bad[0], "a: https://example.org/x is text/plain, expected json")
        self.assertEqual(len(bad), 2); self.assertTrue(bad[1].startswith("c: https://example.org/down unreachable: ConnectionError: refused "), "an unreachable address is named, with its error cut to 120 characters")
        self.assertLessEqual(len(bad[1].split("ConnectionError: ")[1]), 120)
        pages["https://example.org/x"] = (200, "application/json", '{"j": 1}')
        bad = standards.live(td, fetch=fetch); self.assertIn("a: https://example.org/x does not contain 'hello'", bad); self.assertIn("a: https://example.org/x lacks 'k'", bad)
        pages["https://example.org/x"] = (200, "application/json", "not json hello")
        self.assertIn("a: https://example.org/x is not JSON", standards.live(td, fetch=fetch))
        pages["https://example.org/x"] = (500, "text/plain", ""); self.assertIn("a: https://example.org/x answered 500, expected 200", standards.live(td, fetch=fetch))
        self.assertEqual([b for b in standards.live(td, fetch=fetch) if b.startswith("b:")], [], "a row that expects 404 passes on 404")

    def test_us_32_r11_the_register_is_rendered_into_the_documentation_table_and_the_agent_data_and_a_stale_copy_fails(self):
        td = mini([row("x")]); self.assertEqual(standards.check(td), [])
        reg = json.loads((td / standards.REG).read_text())
        t = standards.table(reg); self.assertTrue(t.startswith(standards.BEGIN) and t.endswith(standards.END)); self.assertIn("| Standard | Body | Status | Support | Decision | Proof (test) |", t)
        edit_reg(td, lambda r: r["entries"][0].update(name="Renamed")); p = td / standards.DOC; text = p.read_text()
        p.write_text(text.replace("Renamed", "X")); self.assertTrue(any("standards table is out of date; run `python3 -m foundation standards --apply`" in b for b in standards.check(td)))
        standards.REG  # the register is untouched by apply
        self.assertTrue(standards.apply(td)); self.assertEqual(standards.check(td), []); self.assertFalse(standards.apply(td), "applying a current table changes nothing")
        w(td, standards.DOC, "# No markers here\n"); self.assertTrue(standards.apply(td)); self.assertIn(standards.BEGIN, (td / standards.DOC).read_text())
        js = build_site_agentdata.build(ROOT)
        self.assertEqual(js.replace("\r\n", "\n"), (ROOT / "site/agentdata.js").read_text(encoding="utf-8").replace("\r\n", "\n"), "the generated file is current")
        data = json.loads(js.split("export default ", 1)[1].rstrip().rstrip(";"))
        self.assertEqual(set(data), {"standards", "blind_spots"}); self.assertEqual(set(data["standards"]["entries"][0]), {"id", "name", "body", "status", "support", "tracked_by"})
        self.assertEqual(len(data["standards"]["entries"]), len(reg_real_entries()))


def reg_real_entries():
    return json.loads((ROOT / standards.REG).read_text())["entries"]


class SurfaceRegister(unittest.TestCase):
    def test_us_32_r12_a_path_the_worker_serves_is_a_registered_surface_that_says_what_it_is_and_why_an_agent_cannot_find_it(self):
        td = mini([row("x", **SUPPORTED)], FILES); self.assertEqual(standards.check(td), [])
        entry = td / standards.ENTRY; entry.write_text(entry.read_text() + "\nif (url.pathname === '/secret-new') {}\n")
        self.assertIn(f"{standards.ENTRY} serves /secret-new, which is not registered in {standards.SURF} (new surface without discovery)", standards.check(td))
        def surf(**kw):
            s = {"id": "s", "path": "/s", "methods": ["GET"], "kind": "rest", "audience": "public", "standards": ["x"], "discoverable": True, "description": "d", **kw}
            return mini([row("x", **SUPPORTED)], FILES, surfaces={**SURFACES, "surfaces": [s]})
        self.assertEqual(standards.check(surf()), [])
        self.assertIn("surface /s: no description", standards.check(surf(description="")))
        self.assertIn("surface /s: discoverable but names no standard", standards.check(surf(standards=[])))
        self.assertIn("surface /s: not discoverable and no reason", standards.check(surf(discoverable=False)))
        self.assertEqual(standards.check(surf(discoverable=False, reason="owner screen")), [])
        self.assertIn("surface /s: unknown standard ghost", standards.check(surf(standards=["ghost"])))
        td2 = mini([row("x", support="planned", tracked_by="Q-X", acl="src/a.js"), row("y", **SUPPORTED)], FILES, surfaces={**SURFACES, "surfaces": [{**SURFACES["surfaces"][0], "standards": ["x"]}]})
        self.assertIn("surface /: declares x, which is planned in the register", standards.check(td2))
        td3 = surf(); p = td3 / standards.SNAP; p.write_text(json.dumps({"contract_version": "2.0.0", "tools": []}))
        self.assertIn("contract: snapshot and surfaces.json disagree on the major version", standards.check(td3))
        real = json.loads((ROOT / standards.SURF).read_text())["surfaces"]
        self.assertEqual(len({s["id"] for s in real}), len(real)); self.assertTrue(all(s["path"].startswith("/") for s in real))

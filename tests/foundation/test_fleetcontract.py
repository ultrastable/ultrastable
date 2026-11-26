# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""FLEET-CONTRACT-1: one contract per system; every statement holds front to back and back to front; the reading files and closes its own item."""
import json, shutil, unittest
from pathlib import Path
from foundation import fleetcontract as F
from _repo import scratch

REPO = Path(__file__).resolve().parents[2]
FILES = [F.POLICY, "doctrine/tenant-repos.json", "doctrine/topology.json", "seed/worker/src/contract.js", "seed/worker/src/discover.js", "site/contract.js"] + F.RULE_FILES
POL = json.loads((REPO / F.POLICY).read_text())
O = "https://demo.example"
ST = [{"id": "entries", "text": "Every entry lists the studies behind it.", "page": "/", "api": "/api/entries"},
      {"id": "fresh", "text": "The loop reports when it last ran.", "page": "/changes", "api": "/api/freshness"}]


def copy():
    d = scratch()
    for f in FILES:
        (d / f).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / f, d / f)
    (d / "docs/issues").mkdir(parents=True)
    (d / "ops").mkdir()
    return d


def site(over=None, statements=ST):
    pages = {
        "/": (200, "text/html", f'<html><a href="{POL["platform_link"]}/">Ultrastable</a> Every entry lists the studies behind it. <a href="/api/entries">data</a></html>'),
        "/changes": (200, "text/html", "<html>The loop reports when it last ran.</html>"),
        "/.well-known/ultrastable.json": (200, "application/json", json.dumps({"ultrastable": 1, "url": O})),
        "/claims.json": (200, "application/json", json.dumps({"statements": statements})),
        "/health": (200, "application/json", '{"ok": true}'),
        "/social-queue.json": (200, "application/json", '{"posts": []}'),
        "/api/graph": (200, "application/json", '{"ok": true}'),
        "/api/entries": (200, "application/json", "[]"),
        "/api/freshness": (200, "application/json", '{"ok": true}'),
    }
    pages.update(over or {})
    return lambda url, ua, **k: pages.get(url[len(O):]) or (404, "text/html", "<html>not found</html>")


def read(**k):
    return F.read_system({"id": "demo", "origin": O}, POL, site(**k))


class FleetContract(unittest.TestCase):
    def test_repo_is_clean(self):
        self.assertEqual(F.check(REPO), [])

    def test_the_surface_list_is_one_list(self):
        self.assertEqual(F.module_surfaces(REPO), POL["surfaces"])
        d = copy()
        p = json.loads((d / F.POLICY).read_text())
        p["surfaces"] = p["surfaces"][:-1]
        (d / F.POLICY).write_text(json.dumps(p))
        self.assertTrue(any("surfaces differ" in b for b in F.check(d)))

    def test_a_live_tenant_without_the_module_needs_an_open_item(self):
        d = copy()
        t = json.loads((d / "doctrine/tenant-repos.json").read_text())
        del t["tenants"]["unlearn"]["vendor"][POL["module"]]
        (d / "doctrine/tenant-repos.json").write_text(json.dumps(t))
        self.assertTrue(any(b.startswith("unlearn: does not carry") for b in F.check(d)))
        (d / "docs/issues/Q-CONTRACT-unlearn.json").write_text(json.dumps({"id": "Q-CONTRACT-unlearn", "body": "**Status:** open"}))
        self.assertFalse(any(b.startswith("unlearn") for b in F.check(d)))

    def test_every_live_tenant_is_read(self):
        ids = {s["id"] for s in F.systems(REPO)}
        self.assertTrue({"ultrastable", "practical-solutions", "unlearn", "what-works", "replication-ledger"} <= ids)
        self.assertFalse({"base-rates", "spinoffs"} & ids, "planned and retired tenants have nothing deployed to read")
        self.assertTrue(all(s["origin"] and s["origin"].startswith("https://") for s in F.systems(REPO)))

    def test_a_system_that_backs_every_statement_passes(self):
        r = read()
        self.assertEqual(r["failures"], [])
        self.assertTrue(r["ok"] and r["checks"] >= 11)

    def test_a_sentence_missing_from_its_page_fails(self):
        r = read(over={"/changes": (200, "text/html", "<html>The loop says when it ran.<script>The loop reports when it last ran.</script></html>")})
        self.assertEqual([(f["id"], f["direction"]) for f in r["failures"]], [("fresh", "back-to-front")])

    def test_a_sentence_whose_endpoint_is_gone_fails_front_to_back(self):
        r = read(over={"/api/freshness": (404, "text/html", "gone")})
        self.assertEqual([(f["id"], f["direction"]) for f in r["failures"]], [("fresh", "front-to-back")])

    def test_a_dead_api_link_on_a_page_fails_and_a_write_route_answering_405_does_not(self):
        home = f'<html><a href="{POL["platform_link"]}">u</a> Every entry lists the studies behind it. <a href="/api/gone">x</a><script>fetch("/api/vote");fetch("/api/item/" + id)</script></html>'
        r = read(over={"/": (200, "text/html", home), "/api/vote": (405, "application/json", '{"error":"method"}')})
        self.assertEqual([(f["id"], f["direction"]) for f in r["failures"]], [("/api/gone", "front-to-back")])

    def test_missing_surfaces_an_unwell_system_and_a_foreign_manifest_fail(self):
        r = read(over={"/social-queue.json": None, "/health": (503, "application/json", '{"ok": false}'), "/.well-known/ultrastable.json": (200, "application/json", json.dumps({"ultrastable": 1, "url": "https://other.example"}))})
        self.assertEqual(sorted(f["id"] for f in r["failures"]), ["health", "manifest", "social"])

    def test_a_statement_with_no_endpoint_needs_evidence(self):
        bare = [{"id": "contrast", "text": "Every entry lists the studies behind it.", "page": "/"}]
        self.assertEqual([f["direction"] for f in read(statements=bare)["failures"]], ["front-to-back"])
        self.assertEqual(read(statements=[{**bare[0], "evidence": "test/a11y.test.js"}])["failures"], [])

    def test_apply_files_an_item_then_closes_it_and_records_only_a_changed_reading(self):
        d = copy()
        bad, good = read(over={"/api/freshness": (404, "", "")}), read()
        self.assertEqual(F.apply(d, [bad], now="t1"), ["filed Q-CONTRACT-demo.json", f"recorded {F.READING}"])
        item = json.loads((d / "docs/issues/Q-CONTRACT-demo.json").read_text())
        self.assertIn("fleetcontract --probe demo", item["body"])
        self.assertIn("front-to-back: fresh", item["body"])
        self.assertEqual(F.apply(d, [bad], now="t2"), [], "the same reading writes nothing (SUBSTANCE-1)")
        self.assertEqual(F.apply(d, [good], now="t3"), ["closed Q-CONTRACT-demo.json", f"recorded {F.READING}"])
        self.assertIn("**Status:** closed", (d / "docs/issues/Q-CONTRACT-demo.json").read_text())
        self.assertEqual(json.loads((d / F.READING).read_text())["systems"][0]["ok"], True)
        d2 = copy()
        self.assertEqual(F.apply(d2, [bad], now="t1", items=False), [f"recorded {F.READING}"], "the detector route records and files nothing itself")

    def test_the_detector_and_the_failure_mode_are_registered(self):
        det = json.loads((REPO / "doctrine/detectors.json").read_text())["detectors"]
        self.assertTrue(any(x["id"] == "fleet-contract" and x["failure_mode"] == "fm-front-back-drift" and "fleetcontract" in x["run"] for x in det))
        self.assertTrue(any(m["id"] == "fm-front-back-drift" for m in json.loads((REPO / "doctrine/registers.json").read_text())["failure_modes"]))


if __name__ == "__main__":
    unittest.main()

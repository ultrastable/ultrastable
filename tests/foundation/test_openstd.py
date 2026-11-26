# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""OPEN-STANDARDS-1: a new bespoke format fails the check; the baseline only shrinks."""
import json, subprocess, unittest
from pathlib import Path

import _repo
from foundation import openstd

REPO = Path(__file__).resolve().parents[2]


def w(root, rel, s):
    p = Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(s if isinstance(s, str) else json.dumps(s), encoding="utf-8")


class Gate(unittest.TestCase):
    def setUp(self):
        self.root = _repo.scratch()
        for rel in (openstd.REG, openstd.SCHEMA, openstd.CE_SCHEMA, "schemas/doctrine.schema.json"):
            w(self.root, rel, (REPO / rel).read_text(encoding="utf-8"))
        w(self.root, openstd.BASE, {"config": [], "ledgers": [], "extensions": []})
        w(self.root, "deploy/hosting.json", "{}")
        for rel in json.loads((REPO / openstd.REG).read_text())["formats"]:
            for e in rel.get("evidence", []):
                (Path(self.root) / e).exists() or w(self.root, e, {"$schema": "x"} if e.endswith(".json") else "x")
        subprocess.run(["git", "-C", str(self.root), "init", "-q"], check=True)

    def add(self, rel, s):
        w(self.root, rel, s)
        subprocess.run(["git", "-C", str(self.root), "add", "-A"], check=True)

    def test_repo_itself_passes(self):
        self.assertEqual(openstd.check(REPO), [])

    def test_new_config_without_schema_fails_and_with_schema_passes(self):
        self.add("doctrine/new.json", {"a": 1})
        self.assertTrue(any("doctrine/new.json" in e for e in openstd.check(self.root)))
        self.add("doctrine/new.json", {"$schema": "../schemas/doctrine.schema.json", "a": 1})
        self.assertEqual(openstd.check(self.root), [])

    def test_new_ledger_must_be_cloudevents(self):
        self.add("ops/x.jsonl", '{"t": 1}\n')
        self.assertTrue(any("ops/x.jsonl" in e for e in openstd.check(self.root)))
        self.add("ops/x.jsonl", json.dumps(openstd.cloudevent("a.b", "/loop/x")) + "\n")
        self.assertEqual(openstd.check(self.root), [])

    def test_unregistered_file_type_fails(self):
        self.add("conf/app.ini", "[a]\n")
        self.assertTrue(any("app.ini" in e for e in openstd.check(self.root)))

    def test_baseline_cannot_keep_a_conforming_file(self):
        self.add("doctrine/ok.json", {"$schema": "x"})
        w(self.root, openstd.BASE, {"config": ["doctrine/ok.json"], "ledgers": [], "extensions": []})
        self.assertTrue(any("stale" in e for e in openstd.check(self.root)))


if __name__ == "__main__":
    unittest.main()

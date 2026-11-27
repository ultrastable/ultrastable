# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""IDENTITIES-1: a new workflow may not grant write at the top; a listed one that stops must leave the list."""
import json, unittest

from _repo import scratch
from foundation import identities as I


def tree(workflows, listed):
    d = scratch(); (d / ".github/workflows").mkdir(parents=True); (d / "doctrine").mkdir()
    for k, v in workflows.items():
        (d / ".github/workflows" / k).write_text(v)
    ident = {"merge": {"scopes": ["x"], "never": ["y"]}}
    (d / I.PATH).write_text(json.dumps({"identities": ident, "top_level_write": listed})); return d


RO = "on: push\npermissions:\n  contents: read\njobs: {}\n"
RW = "on: push\npermissions:\n  contents: write\njobs: {}\n"


class Identities(unittest.TestCase):
    def test_read_only_passes(self):
        self.assertEqual(I.check(tree({"a.yml": RO}, [])), [])

    def test_new_top_level_write_fails(self):
        self.assertTrue(I.check(tree({"a.yml": RW}, [])))

    def test_listed_write_passes_and_stale_entry_fails(self):
        self.assertEqual(I.check(tree({"a.yml": RW}, ["a.yml"])), [])
        self.assertTrue(I.check(tree({"a.yml": RO}, ["a.yml"])))

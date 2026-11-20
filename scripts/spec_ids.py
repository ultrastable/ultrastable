#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SPEC-IDS-1: "Requirement IDs are stable: a requirement is never renumbered or reused" (specs/README.md) as a check.

  python3 scripts/spec_ids.py [--check | --record]

A requirement is defined by a line `- **US-<nn>-R<mm> [...]**` in specs/US-SPEC-<nn>-*.md. The ledger doctrine/spec-ids.json holds every ID ever
defined, with the sha256 of the spec number it was defined under. --check fails when an ID is defined twice, when an ID sits in the wrong
specification, when a recorded ID is no longer defined (a withdrawn requirement keeps its line), or when a defined ID is not yet recorded.
--record only adds IDs; it never removes one, so a removed or renumbered requirement stays a failure until its line is restored.
Consumers: tests/foundation/test_spec_ids.py (foundation tests step of checks), doctrine/claims.json.
"""
import json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
LEDGER = "doctrine/spec-ids.json"
DEF = re.compile(r"^- \*\*(US-(\d{2})-R\d{2,3})\b", re.M)


def defined(root=REPO):
    """-> {id: [spec file, ...]} for every definition line."""
    out = {}
    for f in sorted((Path(root) / "specs").glob("US-SPEC-*.md")):
        for m in DEF.finditer(f.read_text("utf-8")):
            out.setdefault(m.group(1), []).append(f.name)
    return out


def check(root=REPO, ledger=None):
    root = Path(root)
    if ledger is None:
        ledger = json.loads((root / LEDGER).read_text("utf-8"))["ids"]
    d = defined(root)
    bad = [f"{i}: defined {len(fs)} times ({', '.join(fs)}); an ID is never reused" for i, fs in sorted(d.items()) if len(fs) > 1]
    bad += [f"{i}: defined in {fs[0]}, which is not specification {i[3:5]}" for i, fs in sorted(d.items()) if not fs[0].startswith(f"US-SPEC-{i[3:5]}-")]
    bad += [f"{i}: recorded but no longer defined; a removed requirement keeps its ID with the text 'Withdrawn in <version>'" for i in sorted(ledger) if i not in d]
    bad += [f"{i}: defined but not recorded; run python3 scripts/spec_ids.py --record" for i in sorted(d) if i not in ledger]
    return bad


def main(argv):
    p = REPO / LEDGER
    if "--record" in argv:
        cur = json.loads(p.read_text("utf-8")) if p.is_file() else {"_doc": "SPEC-IDS-1: every requirement ID ever defined in specs/. Append-only: scripts/spec_ids.py --record adds, nothing removes. Checked by scripts/spec_ids.py --check (tests/foundation/test_spec_ids.py).", "ids": []}
        cur["ids"] = sorted(set(cur["ids"]) | set(defined()))
        p.write_text(json.dumps(cur, indent=1) + "\n", encoding="utf-8")
    bad = check()
    print("\n".join(bad) or f"spec ids ok: {len(defined())} requirements")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

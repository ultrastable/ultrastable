# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""KERNEL-9-1: Ultrastable Kernel 9.0.0, pinned and mapped clause by clause to the code that enforces it.

  python3 -m foundation kernel9 --check   pin matches the text; every clause in the text has a row and the reverse; enforcer paths exist;
                                          every row that is not built says what is missing
  python3 -m foundation kernel9 --gaps    JSON list of the rows that are partial, a gap or in conflict (the cutover backlog)

doctrine/kernel-9.0.0.md is the owner's text, verbatim. kernel/kernel.lock holds its sha256 (clause "Pin" in the text). doctrine/kernel-9.json
says, per clause, what enforces it here. The 8.2.1 kernel stays active (`active: false` here) until no row is in conflict.
`kernel --check` runs this check too, so the `checks` workflow carries it without a workflow change.
"""
from __future__ import annotations
import hashlib, json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PATH = "doctrine/kernel-9.json"
STATUSES = {"built", "partial", "gap", "conflict"}
CLAUSE = re.compile(r"^([REFGSPMOX]\d+) ", re.M)


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def check(root=REPO) -> list[str]:
    root, bad = Path(root), []
    k = load(root)
    text = (root / k["text"]).read_bytes()
    lock = json.loads((root / k["lock"]).read_text(encoding="utf-8"))
    if hashlib.sha256(text).hexdigest() != lock["sha256"]:
        bad.append(f"{k['text']} does not match the sha256 in {k['lock']}")
    if lock["version"] != k["version"]:
        bad.append(f"{k['lock']} version {lock['version']} != {PATH} version {k['version']}")
    in_text = CLAUSE.findall(text.decode("utf-8"))
    rows = [c["id"] for c in k["clauses"]]
    for i in sorted(set(in_text) - set(rows)):
        bad.append(f"clause {i} is in the text and has no row in {PATH}")
    for i in sorted(set(rows) - set(in_text)):
        bad.append(f"row {i} has no clause in the text")
    if len(rows) != len(set(rows)):
        bad.append("duplicate clause rows")
    for c in k["clauses"]:
        if c["status"] not in STATUSES:
            bad.append(f"{c['id']}: status {c['status']!r} is not one of {sorted(STATUSES)}")
        if c["status"] != "built" and not c.get("missing"):
            bad.append(f"{c['id']}: {c['status']} with no reason in `missing`")
        if c["status"] == "built" and not c["enforced_by"]:
            bad.append(f"{c['id']}: built with no enforcer")
        for p in c["enforced_by"]:
            if not (root / p).exists():
                bad.append(f"{c['id']}: enforcer {p} does not exist")
    if k.get("active") and any(c["status"] == "conflict" for c in k["clauses"]):
        bad.append("kernel 9.0.0 marked active while a clause is still in conflict")
    return bad


def gaps(root=REPO) -> list[dict]:
    return [c for c in load(root)["clauses"] if c["status"] != "built"]


def main(argv) -> int:
    if "--gaps" in argv:
        print(json.dumps(gaps(), indent=1, ensure_ascii=False))
        return 0
    bad = check()
    for b in bad:
        print("kernel9:", b)
    if not bad:
        n = len(load()["clauses"])
        print(f"kernel9 ok: {n} clauses pinned and mapped, {len(gaps())} not yet built (KERNEL-9-1)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

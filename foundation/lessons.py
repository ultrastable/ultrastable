# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""LESSONS-1: every lesson the owner or a red team taught is bound to code that enforces it, or to an open item that will.
Ultrastable is the foundation for any autonomous system.

  python3 -m foundation lessons [--check | --report | --probe ID]

doctrine/lessons.json lists each lesson with its enforcement: a `check` (a command that runs in .github/workflows/checks.yml),
a `variable` (an essential variable in doctrine/ultrastability.json, so the second loop acts on it), a `detector` (doctrine/detectors.json)
or a `test` (path::name). A lesson with no enforcement must name an open item in docs/issues that carries a done check, a prediction,
an out-of-scope line and a live probe (SPEC-GATE-1). `--check` fails a lesson bound to nothing, a binding that does not resolve, or an
item that is missing or closed while its lesson is still unenforced. The share enforced is reported; the item closes when a binding lands.
`--probe ID` exits 0 only when lesson ID has a binding that resolves: it is the done check of the lesson's item. `lessons --check` cannot be
that done check, because it passes exactly while the item is held, so a queue that closes the item on it breaks the check it just ran
(Q-LESSON-no-date-bombs was closed as fixed that way on 2026-11-26 and turned main red); --check fails an item that closes on anything else.
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/lessons.json"


def _resolves(root, b) -> bool:
    root = Path(root)
    k, v = b["kind"], b["ref"]
    if k == "check":
        return v in (root / ".github/workflows/checks.yml").read_text(encoding="utf-8")
    if k == "variable":
        u = json.loads((root / "doctrine/ultrastability.json").read_text(encoding="utf-8"))
        return any(x["id"] == v for s in u["scopes"].values() for x in s["variables"])
    if k == "detector":
        return any(d["id"] == v for d in json.loads((root / "doctrine/detectors.json").read_text(encoding="utf-8"))["detectors"])
    if k == "test":
        f, _, name = v.partition("::")
        p = root / f
        return p.is_file() and name in p.read_text(encoding="utf-8")
    return False


def _item_open(root, iid) -> bool:
    p = Path(root) / "docs/issues" / (iid + ".json")
    if not p.is_file():
        return False
    body = json.loads(p.read_text(encoding="utf-8")).get("body", "")
    m = re.search(r"\*\*Status:\*\*\s*([A-Za-z-]+)", body)
    if not m or m.group(1).lower() == "open":
        return True
    # DISPOSE-1 shelves an item the executor failed three runs in a row, or gates one only the owner's account can do: it is closed in the
    # queue but still held (its probe runs every fleet pass and the executor retries it), so the lesson is still tracked. An item closed as
    # fixed, done or superseded while the lesson has nothing enforcing it is the contradiction this check exists for, and still fails.
    d = re.search(r"\*\*Disposition:\*\*\s*([A-Za-z-]+)", body)
    return bool(d and d.group(1).lower() in ("shelved", "gate"))


def report(root=REPO) -> dict:
    ls = json.loads((Path(root) / PATH).read_text(encoding="utf-8"))["lessons"]
    rows, errs = [], []
    for l in ls:
        good = [b for b in l.get("enforced_by", []) if _resolves(root, b)]
        for b in l.get("enforced_by", []):
            if b not in good:
                errs.append(f"{l['id']}: {b['kind']} {b['ref']!r} does not resolve")
        if not good:
            it = l.get("item")
            if not it:
                errs.append(f"{l['id']}: bound to nothing and names no item")
            elif not _item_open(root, it):
                errs.append(f"{l['id']}: unenforced, and item {it} is missing or closed")
        rows.append({"id": l["id"], "enforced": bool(good)})
    n = len(rows)
    return {"lessons": n, "enforced": sum(r["enforced"] for r in rows), "share": round(sum(r["enforced"] for r in rows) / n, 3) if n else None,
            "unenforced": [r["id"] for r in rows if not r["enforced"]], "errors": errs}


def probe(root, lid) -> bool | None:
    """True when lesson `lid` has a binding that resolves, False when it has none, None when no lesson has that id."""
    for l in json.loads((Path(root) / PATH).read_text(encoding="utf-8"))["lessons"]:
        if l["id"] == lid:
            return any(_resolves(root, b) for b in l.get("enforced_by", []))
    return None


def _done_check(body: str) -> str:
    m = re.search(r"\*\*Done check:\*\*\s*([^\n]*)", body or "")
    return m.group(1).strip() if m else ""


def check(root=REPO) -> list[str]:
    from . import specgate
    r = report(root)
    errs = list(r["errors"])
    for l in json.loads((Path(root) / PATH).read_text(encoding="utf-8"))["lessons"]:
        it = l.get("item")
        p = Path(root) / "docs/issues" / f"{it}.json"
        if it and p.is_file() and l["id"] in r["unenforced"]:
            body = json.loads(p.read_text(encoding="utf-8")).get("body", "")
            miss = specgate.missing(body)
            if miss:
                errs.append(f"{l['id']}: item {it} missing {', '.join(miss)} (SPEC-GATE-1)")
            want = f"lessons --probe {l['id']}"
            if want not in _done_check(body):
                errs.append(f"{l['id']}: item {it} closes on '{_done_check(body) or 'nothing'}', which can pass while the lesson is unenforced; "
                            f"its done check must be cmd:python3 -m foundation {want}")
    return errs


def main(argv=None) -> int:
    a = argv if argv is not None else sys.argv[1:]
    if "--probe" in a:
        i = a.index("--probe")
        lid = a[i + 1] if i + 1 < len(a) else ""
        got = probe(REPO, lid)
        if got is None:
            print(f"lessons probe: no lesson {lid!r} in {PATH}"); return 2
        print(f"lessons probe {lid}: {'enforced by a binding that resolves' if got else 'not enforced: no binding resolves'}")
        return 0 if got else 1
    if "--check" in a:
        e = check(); r = report()
        print("\n".join(e) or f"lessons ok: {r['enforced']} of {r['lessons']} enforced in code; the rest each have an open item"); return 1 if e else 0
    print(json.dumps(report(), indent=1)); return 0


if __name__ == "__main__":
    sys.exit(main())

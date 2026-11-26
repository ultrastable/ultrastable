# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SHIP-PLAN-1: unfinished work is a record on the server, not a memory in a session. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation shipplan --status   each slice and each unfinished piece, landed or not (marker files on this tree), as JSON
  python3 -m foundation shipplan --next     the first entry that has not landed, and where its material is stored
  python3 -m foundation shipplan --check    exit 1 until every entry has landed

`doctrine/ship-plan.json` lists every slice of the specification work and every piece still unfinished, each with marker files that exist on main
once it has landed. The unmerged code itself is stored in the private repository named in `store` (a git bundle, the slice lists and scripts, the
specification run's journal). A session that starts cold runs --next and continues; no chat holds any of it.
"""
from __future__ import annotations
import json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLAN = "doctrine/ship-plan.json"


def load(root: Path = ROOT) -> dict:
    return json.loads((Path(root) / PLAN).read_text(encoding="utf-8"))


def status(root: Path = ROOT, plan: dict | None = None) -> list[dict]:
    root = Path(root); plan = plan or load(root); out = []
    for kind in ("slices", "remaining"):
        for e in plan.get(kind, []):
            missing = [m for m in e.get("markers", []) if not (root / m).exists()]
            out.append({"kind": kind, "id": e["id"], "landed": not missing and bool(e.get("markers")), "missing": missing,
                        "title": e.get("title") or e.get("what", ""), "pr": e.get("pr"), "item": e.get("item"), "list": e.get("list")})
    return out


def next_step(root: Path = ROOT) -> dict | None:
    plan = load(root)
    for e in status(root, plan):
        if not e["landed"]:
            s = plan["store"]
            e["store"] = f"{s['repository']}: {s['bundle']} (whole branch), {s['slicing']} (slice lists and scripts), {s['workflow']} (run journal), {s['held_adapter']} (held adapter)"
            e["how"] = "git fetch the bundle from the private repository, build the slice with wip/code/slicing/ship2.sh on the latest main, run the repo checks locally, push with push.sh, open one PR"
            return e
    return None


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    if "--status" in a:
        print(json.dumps(status(), indent=1)); return 0
    if "--next" in a:
        n = next_step()
        print(json.dumps(n, indent=1) if n else "every entry has landed"); return 0
    if "--check" in a:
        todo = [e for e in status() if not e["landed"]]
        for e in todo:
            print(f"not landed: {e['kind']} {e['id']}: {e['title'][:90]}", file=sys.stderr)
        print(f"shipplan: {len(todo)} entr{'y' if len(todo) == 1 else 'ies'} not landed" if todo else "shipplan ok: every entry has landed")
        return 1 if todo else 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main())

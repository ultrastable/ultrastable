"""SERVER-OWNS-LOOPS-1: every loop declares a server-side owner and at least one server-side path; no loop's completion depends on a client session.

  python3 -m foundation loopowner --check     fails a loop with no server_owner, a client-only path set, or a closing probe/done that names a client session
  python3 -m foundation loopowner --sync      writes the derived server_owner into loops that lack one
Rule and sweeper: doctrine/loop-ownership.json, seed/worker/src/sweeper.js.
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CLIENT_TEXT = re.compile(r"\b(owner (must|will|to) (merge|click|run|review)|person (merges|runs|closes)|in a (chat|code agent) session|laptop|desktop app)\b", re.I)


def _load(root):
    r = Path(root)
    return json.loads((r / "doctrine/loop-ownership.json").read_text("utf-8")), json.loads((r / "instances/ultrastable/loop-registry.json").read_text("utf-8"))


def derive(loop: dict, owners: list[str]) -> str:
    if loop.get("workflows"):
        return "github-actions"
    return "ultrastable-tick"


def check(root=REPO) -> list[str]:
    pol, reg = _load(root)
    errs = []
    for l in reg["loops"] if isinstance(reg, dict) else reg:
        i = l.get("id")
        if l.get("server_owner") not in pol["server_owners"]:
            errs.append(f"{i}: server_owner missing or not one of {pol['server_owners']}")
        classes = {p.get("class") for p in l.get("paths", [])}
        if not classes & set(pol["server_path_classes"]):
            errs.append(f"{i}: no server-side path (classes: {sorted(classes)}); a loop never closes through a client session alone")
        for k in ("done", "closing_probe", "trigger"):
            if CLIENT_TEXT.search(str(l.get(k, ""))):
                errs.append(f"{i}: {k} depends on a client or a person")
    return errs


def main(argv):
    if argv[:1] == ["--sync"]:
        pol, reg = _load(REPO)
        n = 0
        for l in reg["loops"] if isinstance(reg, dict) else reg:
            if l.get("server_owner") not in pol["server_owners"]:
                l["server_owner"] = derive(l, pol["server_owners"]); n += 1
        (REPO / "instances/ultrastable/loop-registry.json").write_text(json.dumps(reg, indent=2, ensure_ascii=False) + "\n", "utf-8")
        print(f"loopowner: set server_owner on {n} loops"); return 0
    errs = check()
    for e in errs:
        print("FAIL", e)
    print("loopowner ok" if not errs else f"loopowner: {len(errs)} problems")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

"""ORG-CYBERNETICS-1. Ultrastable is the foundation for any autonomous system.

Each function of the viable system (doctrine/org-cybernetics.json) must be carried by at least one manager that is switched on in
seed/autonomy/managers.json and has a role file, and by code that still holds its marker. Requisite variety, read here: no function is
left without a regulator. --report prints the reading per function.

  python3 -m foundation orgcyber [--check|--report]
"""
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MAP = "doctrine/org-cybernetics.json"


def on_roles(root=REPO) -> set:
    reg = json.loads((Path(root) / "seed/autonomy/managers.json").read_text(encoding="utf-8"))
    off = {k for k, v in (reg.get("switch") or {}).items() if v.get("state") == "off"}
    return {m["id"] for m in reg["managers"] if m.get("default", "on") == "on" and m["id"] not in off}


def reading(root=REPO) -> dict:
    root = Path(root)
    m = json.loads((root / MAP).read_text(encoding="utf-8"))
    live = on_roles(root)
    out = {}
    for f in m["functions"]:
        regs = [r for r in f["roles"] if r in live and (root / "agents/roles" / f"{r}.md").exists()]
        code = []
        for spec in f["mechanisms"]:
            path, _, mark = spec.partition("::")
            p = root / path
            code.append(p.exists() and (not mark or mark in p.read_text(encoding="utf-8")))
        out[f["id"]] = {"regulators": regs, "code_ok": all(code)}
    return out


def check(root=REPO) -> list[str]:
    errs = []
    for fid, r in reading(root).items():
        if not r["regulators"]:
            errs.append(f"{fid}: no switched-on manager carries it")
        if not r["code_ok"]:
            errs.append(f"{fid}: a mechanism file is missing or lost its marker")
    return errs


def main(argv=None) -> int:
    argv = argv or sys.argv[1:]
    if "--report" in argv:
        print(json.dumps(reading(), indent=2))
        return 0
    errs = check()
    for e in errs:
        print("orgcyber:", e)
    print(f"orgcyber: {'FAIL' if errs else 'ok'} ({len(reading())} functions)")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())

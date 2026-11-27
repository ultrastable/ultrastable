# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""IDENTITIES-1 (ZHC-R4, #2669): GITHUB_TOKEN is read-only at the top of a workflow; write scopes sit on the job that needs them.

  python3 -m foundation identities --check    fail when a workflow grants write at the top and is not on `top_level_write` (the list only
                                              shrinks), when a listed workflow no longer does, or when an identity lacks scopes or `never`
  python3 -m foundation identities --report   each identity with its scopes, and the workflows still granting write at the top

Ultrastable is the foundation for any autonomous system.
"""
from __future__ import annotations
import json, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/identities.json"


def _write(p) -> bool:
    return p == "write-all" or (isinstance(p, dict) and any(v == "write" for v in p.values()))


def top_write(root=REPO) -> list[str]:
    import yaml
    out = []
    for f in sorted((Path(root) / ".github/workflows").glob("*.yml")):
        d = yaml.safe_load(f.read_text()) or {}
        if _write(d.get("permissions")):
            out.append(f.name)
    return out


def check(root=REPO) -> list[str]:
    root = Path(root); cfg = json.loads((root / PATH).read_text()); allowed, now, bad = set(cfg["top_level_write"]), top_write(root), []
    for f in now:
        if f not in allowed:
            bad.append(f"{f}: grants write at the top of the file; put the write scope on the job that needs it")
    for f in allowed - set(now):
        bad.append(f"{PATH}: {f} no longer grants write at the top; remove it from top_level_write")
    for k, v in cfg["identities"].items():
        if not v.get("scopes") and k != "administration" or not v.get("never"):
            bad.append(f"{PATH}: identity {k} needs scopes and a never list")
    return bad


def main(argv) -> int:
    if "--report" in argv:
        cfg = json.loads((REPO / PATH).read_text())
        print(json.dumps(cfg["identities"], indent=1)); print(f"{len(top_write())} workflows still grant write at the top")
        return 0
    if "--check" in argv:
        bad = check()
        for b in bad:
            print("FAIL", b)
        print("identities ok" if not bad else f"identities: {len(bad)} problem(s)"); return 1 if bad else 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

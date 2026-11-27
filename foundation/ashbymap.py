"""ASHBY-CONCEPTS-1. Ultrastable is the foundation for any autonomous system.

Every concept in doctrine/ashby-concepts.json is bound to code that carries it. --check fails when a mechanism path is gone or lost its
marker, when a reading cannot be computed, or when a gap names no open item. interference() is the multistable reading: of the second loop's
steps, the share after which a different variable that was in bounds fell out of bounds inside the settle window.

  python3 -m foundation ashbymap [--check|--report]
"""
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MAP = "doctrine/ashby-concepts.json"


def _t(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ")


def interference(rows, window=timedelta(minutes=30)) -> dict:
    """Steps after which another variable went from ok to not ok (measured readings only) within the window."""
    rows = sorted((r for r in rows if r.get("at")), key=lambda r: r["at"])
    last = {}
    steps, hit = 0, 0
    pending = []
    for r in rows:
        at = _t(r["at"])
        if r.get("ev") == "step":
            ok_now = {v for v, ok in last.items() if ok and v != r.get("var")}
            pending.append((at, r.get("var"), ok_now, [False]))
            steps += 1
        elif r.get("ev") == "reading" and not r.get("unmeasured"):
            v, ok = r.get("var"), bool(r.get("ok"))
            for p in pending:
                if not p[3][0] and at - p[0] <= window and v in p[2] and not ok:
                    p[3][0] = True
                    hit += 1
            last[v] = ok
            pending = [p for p in pending if at - p[0] <= window and not p[3][0]]
    return {"steps": steps, "disturbed": hit, "interference_share": round(hit / steps, 3) if steps else None}


def readings(root=REPO) -> dict:
    from foundation import ultrastability
    out = dict(ultrastability.ashby(root))
    led = Path(root) / ultrastability.load(root)["ledger"]
    rows = [json.loads(l) for l in led.read_text(encoding="utf-8").splitlines() if l.strip()] if led.exists() else []
    out.update(interference(rows))
    return out


def check(root=REPO) -> list[str]:
    root = Path(root)
    m = json.loads((root / MAP).read_text(encoding="utf-8"))
    errs, have = [], None
    for c in m["concepts"]:
        if not c.get("url", "").startswith("https://ashby.info/"):
            errs.append(f"{c['id']}: source is not an ashby.info page")
        for spec in c["mechanisms"]:
            path, _, mark = spec.partition("::")
            f = root / path
            if not f.exists():
                errs.append(f"{c['id']}: {path} is missing")
            elif mark and mark not in f.read_text(encoding="utf-8"):
                errs.append(f"{c['id']}: {path} no longer holds {mark!r}")
        if c.get("reading"):
            have = have if have is not None else readings(root)
            if c["reading"] not in have:
                errs.append(f"{c['id']}: reading {c['reading']} is not computed")
        if c["status"] == "gap" and not (root / "docs/issues" / f"{c.get('item', '')}.json").exists():
            errs.append(f"{c['id']}: gap with no open item")
    return errs


def main(argv=None) -> int:
    argv = argv or sys.argv[1:]
    if "--report" in argv:
        print(json.dumps(readings(), indent=2))
        return 0
    errs = check()
    for e in errs:
        print("ashbymap:", e)
    print(f"ashbymap: {'FAIL' if errs else 'ok'} ({len(json.loads((REPO / MAP).read_text())['concepts'])} concepts)")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""UNATTENDED-365 (Rowan, 2026-11-20): run one year with zero external input and keep shipping. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation unattended --check      the register is well formed: a closed input names a probe that resolves, a gate has a default and one
                                                https link, an open input has a queue item, and no open input lapses within warn_days
  python3 -m foundation unattended --horizon    days until the first input that does not renew by itself lapses, against the target, and what holds it down
  python3 -m foundation unattended --probe ID   exit 0 when that input is closed (the done check of its Q-YEAR item)
Data: doctrine/unattended.json. Consumers: foundation/openloops.py, foundation/needsyou.py, tests/foundation/test_unattended.py."""
from __future__ import annotations
import json, re, shlex, sys
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DATA = "doctrine/unattended.json"
CLASSES = ("credential", "renewal", "quota", "model", "dependency", "session", "account")


def load(root=REPO) -> dict:
    return json.loads((Path(root) / DATA).read_text(encoding="utf-8"))


def _resolves(root, probe) -> bool:
    kind, _, arg = str(probe).partition(":")
    if kind == "file":
        return (Path(root) / arg).is_file()
    if kind == "cmd":
        a = shlex.split(arg)
        return a[:3] == ["python3", "-m", "foundation"] and len(a) > 3 and (Path(root) / "foundation" / (a[3] + ".py")).is_file()
    return False


def days_left(dep, today) -> int | None:
    return (date.fromisoformat(dep["expires"]) - today).days if dep.get("expires") else None


def horizon(root=REPO, today=None) -> dict:
    """An input that renews itself never bounds the horizon. One that does not bounds it at its expiry; an open one with no date bounds nothing but is listed."""
    d, today = load(root), today or date.today()
    target = d["target"]["value"]
    dated = [(days_left(x, today), x["id"]) for x in d["dependencies"] if x["status"] != "closed" and x.get("expires")]
    h = min([n for n, _ in dated] + [10 ** 6])
    return {"horizon_days": None if h == 10 ** 6 else h, "target": target, "met": h >= target and not any(x["status"] == "open" for x in d["dependencies"]),
            "bounded_by": sorted(i for n, i in dated if n < target),
            "open": sorted(x["id"] for x in d["dependencies"] if x["status"] == "open"),
            "gates": sorted(x["id"] for x in d["dependencies"] if x["status"] == "gate"),
            "closed": sum(x["status"] == "closed" for x in d["dependencies"]), "total": len(d["dependencies"])}


def check(root=REPO, today=None) -> list[str]:
    root, today, bad = Path(root), today or date.today(), []
    d = load(root)
    t = d.get("target", {})
    if not (t.get("statement") and t.get("metric") and isinstance(t.get("value"), int) and _resolves(root, t.get("probe"))):
        bad.append(f"{DATA}: target needs a statement, a metric, a value and a probe that resolves")
    ids = [x.get("id") for x in d["dependencies"]]
    bad += [f"{i}: listed twice" for i in sorted(set(ids)) if ids.count(i) > 1]
    for x in d["dependencies"]:
        i = x.get("id")
        if x.get("class") not in CLASSES or x.get("status") not in ("closed", "gate", "open") or not x.get("what") or not x.get("evidence"):
            bad.append(f"{i}: needs a class, a status, what and evidence"); continue
        if not _resolves(root, x.get("probe")):
            bad.append(f"{i}: probe `{x.get('probe')}` does not resolve")
        if x["status"] == "gate" and not (x.get("default") and re.fullmatch(r"https://\S+", x.get("connect", "")) and x.get("renewal") == "identity"):
            bad.append(f"{i}: a gate is identity-bound and needs a default in effect and one https link")
        if x["status"] == "open":
            if not (x.get("item") and (root / "docs/issues" / f"{x['item']}.json").is_file()):
                bad.append(f"{i}: an open input needs a queue item in docs/issues")
            n = days_left(x, today)
            if n is not None and n <= d["warn_days"]:
                bad.append(f"{i}: lapses in {n} day(s) and nothing renews it")
    return bad


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if "--probe" in argv:
        want = argv[argv.index("--probe") + 1]
        dep = next((x for x in load()["dependencies"] if x["id"] == want), None)
        print(f"{want}: {dep['status'] if dep else 'unknown'}")
        return 0 if dep and dep["status"] == "closed" else 1
    if "--horizon" in argv:
        print(json.dumps(horizon(), indent=1))
        return 0
    bad = check()
    print("\n".join(bad) or "unattended ok")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

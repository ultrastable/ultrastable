# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""COMPAT-DATE-1 (UNATTENDED-365 dependency dependency-drift): Worker compatibility dates advance by themselves. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation compatdate --check            fails when a declared compatibility date is older than max_age_days
  python3 -m foundation compatdate --run [--apply]    moves every date older than max_age_days to today minus lag_days (a date the runtime has served for a while)

Dates live in doctrine/topology.json (each worker and system_compatibility_date), in every wrangler.toml and wrangler*.json(c) of the repository. Action
versions and npm packages advance through Dependabot (.github/dependabot.yml) and the merge lane; this loop covers the one pin Dependabot does not.
The run rides the watchdog's runway pass (foundation/runway.py run), so the change lands as a commit the checks gate like any other. Tests:
tests/foundation/test_compatdate.py.
"""
from __future__ import annotations
import datetime as dt, json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MAX_AGE_DAYS, LAG_DAYS = 180, 14
DATE = re.compile(r'(compatibility_date"?\s*[=:]\s*")(\d{4}-\d{2}-\d{2})(")')
SKIP = ("node_modules", ".wrangler", "/vendor/")


def files(root=REPO) -> list[Path]:
    root = Path(root)
    out = [p for pat in ("**/wrangler.toml", "**/wrangler*.json", "**/wrangler*.jsonc") for p in root.glob(pat)]
    out = [p for p in out if not any(s in str(p) for s in SKIP) and "/deploy/wrangler/" not in str(p)]  # deploy/wrangler/ is rendered from topology
    t = root / "doctrine/topology.json"
    return sorted(set(out + ([t] if t.exists() else [])))


def dates(root=REPO) -> list[tuple[str, str]]:
    root = Path(root)
    return [(str(p.relative_to(root)), m.group(2)) for p in files(root) for m in DATE.finditer(p.read_text(encoding="utf-8"))]


def _old(d: str, today: dt.date) -> bool:
    return (today - dt.date.fromisoformat(d)).days > MAX_AGE_DAYS


def check(root=REPO, today=None) -> list[str]:
    today = today or dt.date.today()
    return [f"{f}: compatibility_date {d} is older than {MAX_AGE_DAYS} days (COMPAT-DATE-1: `compatdate --run --apply` advances it)" for f, d in dates(root) if _old(d, today)]


def run(root=REPO, apply=False, today=None) -> dict:
    root, today = Path(root), today or dt.date.today()
    target, moved = (today - dt.timedelta(days=LAG_DAYS)).isoformat(), []
    for p in files(root):
        text = p.read_text(encoding="utf-8")
        new = DATE.sub(lambda m: m.group(1) + (target if _old(m.group(2), today) else m.group(2)) + m.group(3), text)
        if new != text:
            moved.append(str(p.relative_to(root)))
            if apply:
                p.write_text(new, encoding="utf-8")
    return {"target": target, "moved": moved, "changed": bool(moved) and apply}


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    if "--run" in a:
        print(json.dumps(run(apply="--apply" in a), indent=1)); return 0
    bad = check()
    for b in bad:
        print(b)
    print(f"compatdate: {len(dates())} dates, {len(bad)} older than {MAX_AGE_DAYS} days")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

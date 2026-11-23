# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""COMPAT-DATE-1: Worker compatibility dates advance by a loop (Q-YEAR-dependency-drift). Ultrastable is the foundation for any autonomous system.

  python3 -m foundation compatdate --run [--apply]   move every stale date to today minus lag_days (runs on every watchdog pass, inside the runway step)
  python3 -m foundation compatdate --check           every date is younger than max_age_days, so the loop is turning, and every workflow Node pin
                                                    stays in maintenance for at least node_min_days

Dates live in doctrine/topology.json (each worker and system_compatibility_date, read by the deploy lane) and in every tracked wrangler.toml.
A date moves only when it is at least min_step_days behind the target, so the loop changes behaviour at most about once a month and the lag
keeps it on dates the runtime has carried for a while. Rules: doctrine/compat-dates.json. Tests: tests/foundation/test_compatdate.py.
"""
from __future__ import annotations
import datetime as dt, json, re, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
RULES = "doctrine/compat-dates.json"
TOML_RE = re.compile(r'^(compatibility_date\s*=\s*")(\d{4}-\d{2}-\d{2})(")', re.M)


def cfg(root=REPO) -> dict:
    return json.loads((Path(root) / RULES).read_text(encoding="utf-8"))


def tomls(root) -> list[Path]:
    root = Path(root)
    try:
        out = subprocess.run(["git", "ls-files", "*wrangler.toml"], cwd=root, capture_output=True, text=True, check=True).stdout.split()
    except (OSError, subprocess.CalledProcessError) as e:  # not a git checkout (a test fixture): fall back to the file tree, never silently to nothing
        print(f"compatdate: git ls-files unavailable ({e}); scanning the tree", file=sys.stderr)
        out = [str(p.relative_to(root)) for p in root.rglob("wrangler.toml") if "node_modules" not in p.parts]
    return [root / p for p in sorted(out)]


def dates(root=REPO) -> list[tuple[str, str]]:
    """(where, date) for every compatibility date the loop owns."""
    root, c, out = Path(root), cfg(root), []
    t = json.loads((root / c["topology"]).read_text(encoding="utf-8"))
    if t.get("system_compatibility_date"):
        out.append((f"{c['topology']}:system_compatibility_date", t["system_compatibility_date"]))
    out += [(f"{c['topology']}:{w['id']}", w["compatibility_date"]) for w in t.get("workers", []) if w.get("compatibility_date")]
    for p in tomls(root):
        out += [(str(p.relative_to(root)), m.group(2)) for m in TOML_RE.finditer(p.read_text(encoding="utf-8"))]
    return out


def target(root=REPO, today=None) -> dt.date:
    return (today or dt.date.today()) - dt.timedelta(days=cfg(root)["lag_days"])


def _stale(d: str, tgt: dt.date, step: int) -> bool:
    return (tgt - dt.date.fromisoformat(d)).days >= step


def run(root=REPO, apply=False, today=None) -> dict:
    root, c = Path(root), cfg(root)
    tgt, step = target(root, today), c["min_step_days"]
    moved = [(w, d) for w, d in dates(root) if _stale(d, tgt, step)]
    if apply and moved:
        tp = root / c["topology"]
        t = json.loads(tp.read_text(encoding="utf-8"))
        if t.get("system_compatibility_date") and _stale(t["system_compatibility_date"], tgt, step):
            t["system_compatibility_date"] = tgt.isoformat()
        for w in t.get("workers", []):
            if w.get("compatibility_date") and _stale(w["compatibility_date"], tgt, step):
                w["compatibility_date"] = tgt.isoformat()
        tp.write_text(json.dumps(t, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        for p in tomls(root):
            s = p.read_text(encoding="utf-8")
            n = TOML_RE.sub(lambda m: m.group(1) + (tgt.isoformat() if _stale(m.group(2), tgt, step) else m.group(2)) + m.group(3), s)
            if n != s:
                p.write_text(n, encoding="utf-8")
    return {"target": tgt.isoformat(), "moved": [{"where": w, "from": d} for w, d in moved], "changed": bool(apply and moved)}


NODE_RE = re.compile(r'node-version:\s*"?(\d+)')


def node_pins(root=REPO) -> list[tuple[str, str]]:
    wf = Path(root) / ".github/workflows"
    return [(str(p.relative_to(root)), m.group(1)) for p in sorted(wf.glob("*.y*ml")) for m in NODE_RE.finditer(p.read_text(encoding="utf-8"))] if wf.is_dir() else []


def node_problems(root=REPO, today=None) -> list[str]:
    c, today, bad = cfg(root), today or dt.date.today(), []
    eol, need = c.get("node_eol") or {}, c.get("node_min_days", 365)
    for where, major in node_pins(root):
        if major not in eol:
            bad.append(f"{where}: Node {major} has no end-of-maintenance date in {RULES} node_eol"); continue
        left = (dt.date.fromisoformat(eol[major]) - today).days
        if left < need:
            bad.append(f"{where}: Node {major} leaves maintenance on {eol[major]} ({left} days), inside the {need}-day horizon; move the pin to the next LTS")
    return bad


def check(root=REPO, today=None) -> list[str]:
    root, c, today = Path(root), cfg(root), today or dt.date.today()
    bad = [f"{RULES}: {k} must be a positive integer" for k in ("lag_days", "min_step_days", "max_age_days") if not (isinstance(c.get(k), int) and c[k] > 0)]
    if bad:
        return bad
    return node_problems(root, today) + [f"{w}: compatibility_date {d} is {(today - dt.date.fromisoformat(d)).days} days old (limit {c['max_age_days']}); the compatdate loop has stopped"
            for w, d in dates(root) if (today - dt.date.fromisoformat(d)).days > c["max_age_days"]]


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if "--run" in argv:
        print(json.dumps(run(REPO, "--apply" in argv), indent=1)); return 0
    bad = check()
    print("\n".join(bad) or "compatdate ok")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

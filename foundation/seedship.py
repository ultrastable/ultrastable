# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SEED-SHIP-1 (Rowan, 2026-11-21): every seed is built, deployed and runs unattended for at least one year. Ultrastable is the foundation for any autonomous system.

A seed that stops at a design proposal has shipped nothing. This module computes each seed's stage from the repository, never from a declared status:

  proposed    the seed exists (instances/<id>/IDEA.md, instance.json, or a tenant row in instances/ultrastable/progress.json)
  built       instances/<id>/ship.json names build paths and tests, and they all exist
  deployed    ops/deploys.jsonl holds a live-verified deploy of its Worker, or (a tenant in its own repository) its progress row serves the URL
  autonomous  deployed, and every one-year readiness check in doctrine/seed-ship.json passes

  python3 -m foundation seedship --check            doctrine well formed; every seed has a ship.json or a baseline row; every seed short of autonomous has a Q-SEED item
  python3 -m foundation seedship --run [--apply]    stage and readiness per seed; --apply writes ops/seedship.json and files or closes Q-SEED-<id>
  python3 -m foundation seedship --probe ID         exit 0 when that seed is autonomous (the done check of its Q-SEED item)
  python3 -m foundation seedship --report           one line per seed

Data: doctrine/seed-ship.json, instances/<id>/ship.json. Consumers: foundation/progress.py check (in checks), foundation/runway.py run (watchdog),
doctrine/detectors.json (seed-ship), seed/bootstrap/bootstrap.py (stage unattended), tests/foundation/test_seedship.py."""
from __future__ import annotations

import datetime as dt
import json
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DATA = "doctrine/seed-ship.json"
PROGRESS = "instances/ultrastable/progress.json"
HOME_REPO = "ultrastable/ultrastable"


def _json(p: Path, default=None):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def cfg(root=REPO) -> dict:
    return _json(Path(root) / DATA, {})


def _progress(root: Path) -> dict:
    return {s["id"]: s for s in (_json(root / PROGRESS, {}) or {}).get("systems", [])}


def seeds(root=REPO) -> list[str]:
    """Every seed on the platform, exempt ones included: instance directories with an idea or manifest, plus tenant rows in progress.json."""
    root = Path(root)
    found = set()
    for d in sorted((root / "instances").iterdir()) if (root / "instances").is_dir() else []:
        if d.is_dir() and any((d / f).exists() for f in ("IDEA.md", "instance.json", "ship.json")):
            found.add(d.name)
    found.update(_progress(root))
    return sorted(found)


def _dependabot_dirs(root: Path) -> set[str]:
    p = root / ".github/dependabot.yml"
    if not p.exists():
        return set()
    return {m.strip().strip("'\"").rstrip("/") or "/" for m in re.findall(r"^\s*directory:\s*(.+)$", p.read_text(encoding="utf-8"), re.M)}


def _deployed_workers(root: Path) -> set[str]:
    out = set()
    p = root / "ops/deploys.jsonl"
    if not p.exists():
        return out
    for line in p.read_text(encoding="utf-8").splitlines():
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if r.get("worker") and r.get("uploaded") and r.get("live_matches_commit"):
            out.add(r["worker"])
    return out


def _topology_workers(root: Path) -> set[str]:
    t = _json(root / "doctrine/topology.json", {}) or {}
    return {w.get("id") for w in t.get("workers", []) if isinstance(w, dict)}


def _credwatch(root: Path) -> set[str]:
    c = _json(root / "doctrine/credwatch.json", {}) or {}
    return {x.get("name") for x in c.get("credentials", []) + c.get("registrations", []) if isinstance(x, dict)}


def _added(root: Path, sid: str) -> dt.date | None:
    """The day the seed first entered the repository (git history), so its ship deadline is measured, not declared."""
    path = f"instances/{sid}"
    if not (root / path).exists():
        return None
    sh = subprocess.run(["git", "rev-parse", "--is-shallow-repository"], cwd=root, capture_output=True, text=True)
    if sh.returncode != 0 or sh.stdout.strip() == "true":
        return None  # a shallow clone dates every file at its graft; unmeasured, never a wrong date
    r = subprocess.run(["git", "log", "--diff-filter=A", "--format=%cs", "--", path], cwd=root, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"seedship: git log failed for {path}: {r.stderr.strip()[-200:]}", file=sys.stderr)
        return None
    days = [x for x in r.stdout.split() if x]
    return dt.date.fromisoformat(days[-1]) if days else None


def readiness(root: Path, ship: dict, row: dict | None, c: dict) -> dict:
    """Each one-year readiness check: True, False, or a reason string when it cannot be measured (which never counts as a pass)."""
    u = ship.get("unattended") or {}
    dep = ship.get("deploy") or {}
    external = bool(row and row.get("repo") and row["repo"] != HOME_REPO)
    res = {}
    hb = u.get("heartbeat_hours")
    health = dep.get("health") or ""
    res["heartbeat"] = bool(health.startswith("https://") and isinstance(hb, (int, float)) and 0 < hb <= c.get("max_heartbeat_hours", 24))
    res["staleness"] = bool(row and isinstance(row.get("expect_hours", 0), (int, float)) and 0 < row.get("expect_hours", 0) <= c.get("max_progress_hours", 168))
    creds = u.get("credentials")
    res["credentials"] = (not (set(creds) - _credwatch(root))) if isinstance(creds, list) else "credentials not declared"
    budget = u.get("budget_usd_month")
    if not isinstance(budget, (int, float)) or budget < 0:
        res["cost"] = "monthly budget not declared"
    elif external:
        res["cost"] = True  # the tenant's own repository runs its cost guard; tenant_sync pins the shared module
    else:
        res["cost"] = dep.get("worker") in _topology_workers(root)
    deps = u.get("dependencies")
    if not isinstance(deps, list):
        res["dependencies"] = "package directories not declared"
    elif external:
        res["dependencies"] = True  # Dependabot runs in the tenant's repository (DEP-LOOP-1)
    else:
        have = _dependabot_dirs(root)
        res["dependencies"] = all(("/" + d.strip("/")).rstrip("/") in have or (d.strip("/") == "" and "/" in have) for d in deps)
    heal = (row or {}).get("heal") or u.get("heal") or []
    if not heal:
        res["self_repair"] = False
    elif external:
        res["self_repair"] = True
    else:
        res["self_repair"] = all((root / ".github/workflows" / h).exists() for h in heal)
    goals = (root / "seed/autonomy/goals.json")
    res["year_model"] = (root / "seed/autonomy/yearsim.json").exists() and goals.exists() and "core.year.unattended" in goals.read_text(encoding="utf-8")
    return res


def assess(sid: str, root=REPO, today: dt.date | None = None) -> dict:
    root = Path(root)
    c = cfg(root)
    today = today or dt.date.today()
    row = _progress(root).get(sid)
    ship = _json(root / "instances" / sid / "ship.json")
    out = {"id": sid, "stage": "proposed", "ship": ship is not None, "missing": [], "readiness": {}}
    if ship is None:
        out["missing"].append("instances/%s/ship.json (what is built, where it is deployed, how it runs a year unattended)" % sid)
    else:
        b = ship.get("build") or {}
        paths, tests = b.get("paths") or [], b.get("tests") or []
        external = bool(row and row.get("repo") and row["repo"] != HOME_REPO)
        absent = [p for p in paths + tests if not external and not (root / p).exists()]
        if (not paths or not tests) and not external:
            out["missing"].append("build.paths and build.tests in ship.json")
        out["missing"] += [f"built file {p}" for p in absent]
        if not out["missing"]:
            out["stage"] = "built"
            dep = ship.get("deploy") or {}
            live = dep.get("worker") in _deployed_workers(root) if dep.get("worker") else False
            if external and row and row.get("url") and row.get("url") == dep.get("url"):
                live = True
            if live and (dep.get("url") or "").startswith("https://"):
                out["stage"] = "deployed"
                out["readiness"] = readiness(root, ship, row, c)
                failed = [k for k, v in out["readiness"].items() if v is not True]
                out["missing"] += [f"readiness {k}" + ("" if v is False else f": {v}") for k, v in out["readiness"].items() if v is not True]
                if not failed:
                    out["stage"] = "autonomous"
            else:
                out["missing"].append("a live-verified deploy of %s at an https URL" % (dep.get("worker") or "its Worker"))
    added = _added(root, sid)
    out["added"] = added.isoformat() if added else None
    out["overdue"] = bool(out["stage"] != "autonomous" and added and (today - added).days > c.get("ship_within_days", 7))
    return out


def measure(root=REPO, today=None) -> dict:
    root = Path(root)
    c = cfg(root)
    exempt = c.get("exempt", {})
    rows = [assess(s, root, today) for s in seeds(root) if s not in exempt]
    return {"marker": "SEED-SHIP-1", "seeds": {r["id"]: r for r in rows},
            "short": sorted(r["id"] for r in rows if r["stage"] != "autonomous"),
            "autonomous": sorted(r["id"] for r in rows if r["stage"] == "autonomous")}


def item_id(sid: str) -> str:
    return f"Q-SEED-{sid}"


def item(r: dict) -> dict:
    iid = item_id(r["id"])
    todo = "; ".join(r["missing"]) or "nothing"
    return {"id": iid, "title": f"{iid}: seed {r['id']} is {r['stage']}, not yet built, deployed and running a year unattended"[:300],
            "body": f"**Owner:** staff\n**Trigger:** every watchdog run\n**Done check:** cmd:python3 -m foundation seedship --probe {r['id']}\n**Status:** open\n\n"
                    f"SEED-SHIP-1: a seed on the platform is built, deployed and made fully autonomous, designed to run unattended for at least one year. "
                    f"Seed `{r['id']}` is at stage `{r['stage']}`. Still missing: {todo}. Build and deploy it on a branch through the normal lane; "
                    "do not close this by editing the stage, a check or the baseline.\n",
            "labels": ["role:staff", "raises-self", "seed-ship"] + (["p0"] if r.get("overdue") else ["p1"]),
            "milestone": "Now", "workstream": "Reliability"}


def run(root=REPO, apply=False, today=None) -> dict:
    root = Path(root)
    m = measure(root, today)
    changed = False
    if apply:
        out = root / "ops/seedship.json"
        new = json.dumps(m, indent=1, sort_keys=True) + "\n"
        if not out.exists() or out.read_text(encoding="utf-8") != new:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(new, encoding="utf-8")
            changed = True
        for sid, r in m["seeds"].items():
            p = root / "docs/issues" / f"{item_id(sid)}.json"
            if r["stage"] != "autonomous":
                body = json.dumps(item(r), indent=2) + "\n"
                if not p.exists() or p.read_text(encoding="utf-8") != body:
                    p.parent.mkdir(parents=True, exist_ok=True)
                    p.write_text(body, encoding="utf-8")
                    changed = True
            elif p.exists():
                it = json.loads(p.read_text(encoding="utf-8"))
                if "**Status:** open" in it.get("body", ""):
                    it["body"] = it["body"].replace("**Status:** open", "**Status:** closed") + "\n\n**Evidence:** closing probe passed: seed is autonomous (built, deployed, every readiness check met)\n"
                    p.write_text(json.dumps(it, indent=2) + "\n", encoding="utf-8")
                    changed = True
    return {**m, "changed": changed}


def probe(sid: str, root=REPO) -> int:
    r = assess(sid, root)
    print(f"{sid}: {r['stage']}" + (f" (missing: {'; '.join(r['missing'])})" if r["missing"] else ""))
    return 0 if r["stage"] == "autonomous" else 1


def check(root=REPO) -> list[str]:
    root = Path(root)
    c, bad = cfg(root), []
    if c.get("marker") != "SEED-SHIP-1":
        return [f"{DATA} is missing or has no SEED-SHIP-1 marker"]
    if c.get("target", {}).get("unattended_days", 0) < 365:
        bad.append("target.unattended_days is below the owner's minimum of 365")
    if c.get("target", {}).get("stage") != "autonomous":
        bad.append("target.stage must be autonomous: a seed is not done at proposed, built or deployed")
    ids = [x["id"] for x in c.get("readiness", [])]
    want = {"heartbeat", "staleness", "credentials", "cost", "dependencies", "self_repair", "year_model"}
    if set(ids) != want:
        bad.append(f"readiness checks must be exactly {sorted(want)}, found {sorted(ids)}")
    exempt = c.get("exempt", {})
    for k, why in exempt.items():
        if not str(why).strip():
            bad.append(f"exempt seed {k} has no reason")
    base = set(c.get("baseline", {}).get("seeds", []))
    for sid in seeds(root):
        if sid in exempt:
            continue
        has_ship = (root / "instances" / sid / "ship.json").exists()
        if not has_ship and sid not in base:
            bad.append(f"seed {sid} has no instances/{sid}/ship.json: a seed lands with what it builds, where it deploys and how it runs a year unattended, never as a proposal alone")
        if has_ship and sid in base:
            bad.append(f"seed {sid} has a ship.json: remove it from the shrink-only baseline")
        r = assess(sid, root)
        if r["stage"] != "autonomous" and not (root / "docs/issues" / f"{item_id(sid)}.json").exists():
            bad.append(f"seed {sid} is {r['stage']} and has no docs/issues/{item_id(sid)}.json: run python3 -m foundation seedship --run --apply")
    for sid in base:
        if sid not in seeds(root):
            bad.append(f"baseline seed {sid} no longer exists: remove it from the baseline")
    return bad


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if "--check" in argv:
        bad = check()
        print("\n".join(bad) or "seedship ok")
        return 1 if bad else 0
    if "--probe" in argv:
        return probe(argv[argv.index("--probe") + 1])
    if "--report" in argv:
        for sid, r in measure()["seeds"].items():
            print(f"{sid:24} {r['stage']:11} {'overdue ' if r['overdue'] else ''}{'; '.join(r['missing'])}")
        return 0
    r = run(REPO, "--apply" in argv)
    if "--changed-file" in argv and r["changed"]:
        Path(argv[argv.index("--changed-file") + 1]).write_text("1", encoding="utf-8")
    print(json.dumps(r, indent=1, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())

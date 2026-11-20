# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""PROGRESS-1 (Rowan, 2026-11-20): every system shows noticeable, substantive progress at every visit, for at least six months with no input.
Ultrastable is the foundation for any autonomous system.

  python3 -m foundation progress --check   the systems list, the tick's cadence step, the public routes and the rule text agree
  python3 -m foundation progress --apps    the newest app launch in instances/spinoffs is younger than apps.expect_days (the launch loop has not run dry)
  python3 -m foundation progress --live    read the deployed /progress.json: fails when it cannot be read, a system is stalled or unmeasured,
                                           or nothing substantive shipped fleetwide in 7 days (the second, independent reading of the cadence)
Data: instances/ultrastable/progress.json. Consumers: seed/worker/src/progress.js (tick step progress), site/progress.js (/progress, digests,
feed), doctrine/rules.json (rule visible-progress), .github/workflows/checks.yml, tests/foundation/test_progress.py."""
from __future__ import annotations
import json, sys, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CONFIG = "instances/ultrastable/progress.json"
RULE = "PROGRESS-1"
WIRED = {
    "seed/worker/src/index.js": ["progressStep({", "'/api/progress'", "refreshFleetChanges({"],
    "seed/worker/src/tick.js": ["stalled_systems:"],
    "deploy/deploy-workers.mjs": [CONFIG],
    "seed/worker/src/handoff.js": [CONFIG],
    "site/worker.js": ["progressRoutes(u, env, shell, HTML, CANON)", "href=\\\"/progress\\\""],
    "site/progress.js": ["/progress.atom", "/digest/", "sinceVisitScript("],
    "workers/core/progress/index.js": ["export function cadence(", "export function digest(", "export function sinceVisitScript("],
    "agents/AGENTS.md": [RULE],
    "seed/agents/AGENTS.md": [RULE],
}


def load(root=REPO) -> dict:
    return json.loads((Path(root) / CONFIG).read_text(encoding="utf-8"))


def check(root=REPO) -> list[str]:
    root, bad = Path(root), []
    try:
        cfg = load(root)
    except (OSError, ValueError) as e:
        return [f"{CONFIG}: unreadable ({e})"]
    systems, seen = cfg.get("systems") or [], set()
    if not systems:
        bad.append(f"{CONFIG}: no systems listed")
    for s in systems:
        sid = s.get("id") or "?"
        if sid in seen:
            bad.append(f"system {sid}: listed twice")
        seen.add(sid)
        for k in ("id", "name", "repo", "url"):
            if not s.get(k):
                bad.append(f"system {sid}: missing {k}")
        if not isinstance(s.get("expect_hours"), (int, float)) or s["expect_hours"] <= 0:
            bad.append(f"system {sid}: expect_hours must be a positive number")
        elif s["expect_hours"] > 24 * 7:
            bad.append(f"system {sid}: expect_hours {s['expect_hours']} is longer than a week; a weekly visit would see nothing new")
        if not s.get("heal"):
            bad.append(f"system {sid}: no heal workflow, so a stall has no repair")
        if s.get("repo") == "ultrastable/ultrastable":
            for wf in s.get("heal") or []:
                p = root / ".github/workflows" / wf
                if not p.is_file():
                    bad.append(f"system {sid}: heal workflow {wf} does not exist")
                elif "workflow_dispatch" not in p.read_text(encoding="utf-8"):
                    bad.append(f"system {sid}: heal workflow {wf} cannot be dispatched")
    for k in ("stall", "cooldown_hours"):
        if not isinstance(cfg.get(k), (int, float)) or cfg[k] <= 0:
            bad.append(f"{CONFIG}: {k} must be a positive number")
    for rel, needles in WIRED.items():
        p = root / rel
        t = p.read_text(encoding="utf-8") if p.is_file() else None
        if t is None:
            bad.append(f"{rel}: missing")
            continue
        bad += [f"{rel}: no longer carries `{n}`" for n in needles if n not in t]
    return bad


def live(url="https://ultrastable.io/progress.json", fetch=None) -> list[str]:
    def _get(u):
        with urllib.request.urlopen(urllib.request.Request(u, headers={"user-agent": "ultrastable-progress-probe"}), timeout=20) as r:
            return json.loads(r.read().decode("utf-8"))
    try:
        d = (fetch or _get)(url)
    except Exception as e:  # noqa: BLE001 - any failure to read the page is the finding, reported with its cause
        return [f"{url}: unreadable ({str(e)[:120]})"]
    bad = [f"system {s.get('id')}: {s.get('state')}" + (f", last change {s.get('last_at')}" if s.get("last_at") else "")
           for s in d.get("systems") or [] if s.get("state") in ("stalled", "unmeasured")]
    if not d.get("systems"):
        bad.append("no systems reported")
    week = (d.get("digests") or {}).get("weekly") or {}
    if not week.get("substantive"):
        bad.append("nothing substantive shipped fleetwide in 7 days")
    return bad


def apps(root=REPO, now=None) -> list[str]:
    """New apps are part of visible progress: the newest launch in the registry must be younger than apps.expect_days, or the launch loop has run dry."""
    import datetime as dt
    root, cfg = Path(root), load(root).get("apps") or {}
    days, t = cfg.get("expect_days", 21), now or dt.datetime.now(dt.timezone.utc)
    launched = []
    for f in sorted((root / (cfg.get("registry") or "instances/spinoffs")).glob("*/app.json")):
        a = json.loads(f.read_text(encoding="utf-8"))
        if a.get("launched"):
            launched.append(dt.datetime.strptime(a["launched"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc))
    if not launched:
        return ["no app has ever been launched"]
    age = (t - max(launched)).total_seconds() / 86400
    return [f"no app launched for {age:.0f} days (the loop declares one at least every {days}); the idea queue or the app types have run dry"] if age > days else []


def main(argv=None) -> int:
    av = list(argv or [])
    bad = live() if "--live" in av else apps() if "--apps" in av else check()
    for b in bad:
        print("PROGRESS", b)
    print(f"progress: {'live reading' if '--live' in av else 'apps' if '--apps' in av else 'check'} {'ok' if not bad else str(len(bad)) + ' finding(s)'}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

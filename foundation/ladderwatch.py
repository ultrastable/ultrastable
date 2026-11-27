# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""LADDER-LIVE-1: the self-coding executor is judged by whether its model calls return answers, not by whether its job ran.

From 2026-11-23 to 2026-11-26 every code-agent rung failed (Workers AI HTTP 401 through the site route, GitHub Models HTTP 200 "OK" text/plain),
and the queue shelved item after item with that reason while every clock read green. This reads the shelved items' own evidence: when the most
recent executor dispositions mostly say "every code agent rung failed", the ladder is dead and the check fails, naming the rungs and their errors.
An item set with no executor disposition in the window is unmeasured, never healthy.

  python3 -m foundation ladderwatch [--check|--json] [--hours N]
"""
from __future__ import annotations
import json, re, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEAD = "every code agent rung failed"
_DISP = re.compile(r"\*\*Disposition:\*\* shelved \(executor-failed, (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)")
_RUNG = re.compile(r"([a-z0-9-]+): (HTTPError: HTTP Error \d+[^|]*|RuntimeError: non-JSON response \(HTTP \d+[^)]*\))")


def read(root=ROOT, hours=24, now=None, executor_rows=None) -> dict:
    now = now or datetime.now(timezone.utc)
    since, rows = now - timedelta(hours=hours), []
    for f in sorted((Path(root) / "docs" / "issues").glob("*.json")):
        try:
            j = json.loads(f.read_text(encoding="utf-8"))
            body = j.get("body", "") if isinstance(j, dict) else ""
        except (ValueError, OSError):
            continue
        m = _DISP.search(body)
        if not m:
            continue
        at = datetime.strptime(m.group(1), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        if at >= since:
            rows.append({"id": f.stem, "at": m.group(1), "dead": DEAD in body, "rungs": sorted({r for r, _ in _RUNG.findall(body)})})
    dead = [r for r in rows if r["dead"]]
    # NO-ROUTE-1: an outage no longer shelves items (foundation/executor.NoRoute), so the executor's own `no-route` rows are the second reading
    nr, runs = _no_route(root, since, executor_rows)
    state = "unmeasured" if not rows and not runs else ("dead" if (len(dead) >= 3 and len(dead) * 2 >= max(len(rows), 1)) or (len(nr) >= 3 and len(nr) * 2 >= len(runs)) else "ok")
    return {"window_h": hours, "executor_shelved": len(rows), "ladder_dead": len(dead), "no_route_runs": len(nr), "executor_runs": len(runs), "state": state,
            "rungs_failing": sorted({x for r in dead for x in r["rungs"]} | {x for r in nr for x, _ in _RUNG.findall(r.get("detail", ""))}),
            "items": ([r["id"] for r in dead] + [str(r.get("issue")) for r in nr])[:20]}


def _no_route(root, since, executor_rows=None):
    """Executor rows in the window that ended (not picked/idle/dry-run), and those among them that found no live model route."""
    if executor_rows is None:
        from . import queue as qmod
        try:
            executor_rows = qmod.executor_rows(root)
        except Exception:  # unreadable ledger: this reading is absent, the shelved reading stands
            executor_rows = []
    runs = []
    for r in executor_rows:
        try:
            at = datetime.strptime(str(r.get("at")), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        if at >= since and r.get("result") not in ("idle", "dry-run", "picked", None):
            runs.append(r)
    return [r for r in runs if r.get("result") == "no-route"], runs


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    hours = int(argv[argv.index("--hours") + 1]) if "--hours" in argv else 24
    r = read(hours=hours)
    print(json.dumps(r, indent=1))
    if "--check" in argv:
        return 1 if r["state"] == "dead" else 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

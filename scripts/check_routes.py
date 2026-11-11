#!/usr/bin/env python3
"""No single route: fails when a loop or deploy path has only one way to run, or when every route needs a credential.
Reads instances/ultrastable/loops.json and deploy/routes.json. Exit 1 with one line per problem."""
import json, sys
from pathlib import Path

LIVE = ("running", "ready")


def check(root=".") -> list[str]:
    root, bad = Path(root), []
    reg = json.loads((root / "instances/ultrastable/loops.json").read_text(encoding="utf-8"))
    hosts = [h for h in reg["hosts"] if h["state"] in LIVE]
    if len(hosts) < 2:
        bad.append(f"loops: only {len(hosts)} live host(s); need at least 2")
    if len({h["credential"] for h in hosts}) < 2:
        bad.append("loops: all live hosts share one credential; a single credential is a single point of failure")
    if not any(h["credential"] == "none" for h in hosts):
        bad.append("loops: no live host runs without a credential")
    for h in hosts:
        if not (root / h["adapter"]).exists():
            bad.append(f"host {h['id']}: adapter {h['adapter']} missing")
        if "takeover_after_hours" not in h:
            bad.append(f"host {h['id']}: no takeover_after_hours")
    for t in json.loads((root / reg["deploy_routes"]).read_text(encoding="utf-8"))["targets"]:
        if len(t["routes"]) < 2:
            bad.append(f"deploy target {t['id']}: one route only")
        if not any(r["credential"] == "none" for r in t["routes"]):
            bad.append(f"deploy target {t['id']}: no route without a credential")
    return bad


if __name__ == "__main__":
    problems = check(sys.argv[1] if len(sys.argv) > 1 else ".")
    print("\n".join(problems) or "routes ok")
    sys.exit(1 if problems else 0)

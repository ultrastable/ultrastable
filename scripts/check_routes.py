#!/usr/bin/env python3
"""No single route: fails when a loop or deploy path has only one way to run, or when every route needs a credential a person must mint.

Server-side only (owner, 2026-11-12): the credential-free route is a server-side one. A route counts as credential-free only when its
credential is listed under `person_free_credentials` in deploy/routes.json (today: `github-builtin`, the token GitHub mints for each Actions
run) and, for a loop host, when the host runs on that credential's platform with an adapter that exists there. `none` does not count: a host
with no credential at all was the scheduler on a person's computer, which no longer exists.

Reads instances/ultrastable/loops.json and deploy/routes.json. Exit 1 with one line per problem."""
import fnmatch, json, sys
from pathlib import Path

LIVE = ("running", "ready")


def person_free(routes: dict) -> dict:
    return routes.get("person_free_credentials") or {}


def check(root=".") -> list[str]:
    root, bad = Path(root), []
    reg = json.loads((root / "instances/ultrastable/loops.json").read_text(encoding="utf-8"))
    routes = json.loads((root / reg["deploy_routes"]).read_text(encoding="utf-8"))
    free = person_free(routes)
    if not free:
        bad.append(f"{reg['deploy_routes']}: person_free_credentials is empty; name the server-side credential no person mints")
    hosts = [h for h in reg["hosts"] if h["state"] in LIVE]
    if len(hosts) < 2:
        bad.append(f"loops: only {len(hosts)} live host(s); need at least 2")
    if len({h["credential"] for h in hosts}) < 2:
        bad.append("loops: all live hosts share one credential; a single credential is a single point of failure")
    for h in hosts:
        if not (root / h["adapter"]).exists():
            bad.append(f"host {h['id']}: adapter {h['adapter']} missing")
        if "takeover_after_hours" not in h:
            bad.append(f"host {h['id']}: no takeover_after_hours")
        if h["credential"] == "none":
            bad.append(f"host {h['id']}: credential 'none' is not a server-side route (server-side only); name the platform credential it runs on")
    ok_free = []
    for h in hosts:
        f = free.get(h["credential"])
        if not f:
            continue
        if h.get("runs_on") != f["runs_on"]:
            bad.append(f"host {h['id']}: credential {h['credential']} only exists on {f['runs_on']}, but the host says runs_on={h.get('runs_on')!r}")
        elif not fnmatch.fnmatch(h["adapter"], f["adapter_glob"]):
            bad.append(f"host {h['id']}: a {h['credential']} host needs an adapter matching {f['adapter_glob']}, not {h['adapter']}")
        else:
            ok_free.append(h["id"])
    if not ok_free:
        bad.append("loops: no live host runs without a credential a person must mint (need a server-side host on one of: " + (", ".join(sorted(free)) or "none listed") + ")")
    for t in routes["targets"]:
        if len(t["routes"]) < 2:
            bad.append(f"deploy target {t['id']}: one route only")
        if not any(r["credential"] in free for r in t["routes"]):
            bad.append(f"deploy target {t['id']}: no route without a credential a person must mint (need one of: " + (", ".join(sorted(free)) or "none listed") + ")")
        for r in t["routes"]:
            if r["credential"] == "none":
                bad.append(f"deploy target {t['id']} route {r['id']}: credential 'none' is not a server-side route (server-side only)")
    return bad


def credential_free_routes(root=".") -> list[str]:
    """The live loop hosts that qualify as the credential-free route, for reports."""
    root = Path(root)
    reg = json.loads((root / "instances/ultrastable/loops.json").read_text(encoding="utf-8"))
    free = person_free(json.loads((root / reg["deploy_routes"]).read_text(encoding="utf-8")))
    return [h["id"] for h in reg["hosts"] if h["state"] in LIVE and h["credential"] in free and h.get("runs_on") == free[h["credential"]]["runs_on"]]


if __name__ == "__main__":
    root = sys.argv[1] if len(sys.argv) > 1 else "."
    problems = check(root)
    print("\n".join(problems) or "routes ok: credential-free route is server-side (" + ", ".join(credential_free_routes(root)) + ")")
    sys.exit(1 if problems else 0)

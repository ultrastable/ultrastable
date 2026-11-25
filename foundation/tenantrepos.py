# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""Every tenant app lives in its own repository (TENANT-REPO-1, Rowan 2026-11-22: "This is an app, a tenant, so it needs its own repo.").

Ultrastable is the foundation for any autonomous system. The core repository holds the platform; a tenant keeps only its manifest here
(IDEA.md, instance.json, lifecycle.json, runway.json, a README pointer) and its code in its own repository. doctrine/topology.json names the
tenant repository as the worker's `source`, and deploy-ultrastable builds and deploys it from there (seed/worker/src/handoff.js makeDeployer),
on a push here, on a dispatch, and daily when the tenant's main moved past the last deployed commit.

  python3 -m foundation tenantrepos --check                 the registry is complete: no tenant code left in the core outside a move in progress
  python3 -m foundation tenantrepos --prepare DIR --slug S  turn a split of the tenant folder into a standalone repository (vendored core files, imports)
  python3 -m foundation tenantrepos --missing               tenants whose repository is still to be created (read by tenant-repos.yml)
  python3 -m foundation tenantrepos --health                every tenant worker's /health, live: ok, and no reported part ok false (TENANT-HEALTH-1)
  python3 -m foundation tenantrepos --behind                workers whose tenant repository moved past the last deployed commit (daily redeploy)

FULLSTACK-1 (Rowan, 2026-11-25: "All UltraStable systems shall automatically deploy themselves: repo, back-end, and public-facing Web UI
front-end."): every registered tenant names its deployed public front end, either `worker` (a live doctrine/topology.json Worker with at
least one public route, deployed by deploy-ultrastable) or `frontend` (the https URL its own repository's pipeline deploys to); check fails
a tenant with neither, so a new tenant is a repo, a back end and a public web UI from its first registration.

Registry: doctrine/tenant-repos.json. States: own-repo (born separate), moving (code still in the core while its repository is created),
moved (code only in the tenant repository; the core's topology entry builds from it).
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REG = "doctrine/tenant-repos.json"
STATES = {"own-repo", "moving", "moved"}
CODE_DIRS = ("worker", "src", "app")


def load(root: Path = ROOT) -> dict:
    return json.loads((root / REG).read_text())



def check(root: Path = ROOT) -> list[str]:
    reg, errs = load(root), []
    org = reg.get("org", "")
    tenants = reg.get("tenants", {})
    for slug, t in tenants.items():
        if t.get("state") not in STATES:
            errs.append(f"{slug}: state must be one of {sorted(STATES)}")
        if not str(t.get("repo", "")).startswith(org + "/"):
            errs.append(f"{slug}: repo must be in the {org} organization")
        if t.get("state") == "moved":
            src = root / t.get("source", f"instances/{slug}")
            left = [d for d in CODE_DIRS if (src / d).exists()]
            if left:
                errs.append(f"{slug}: moved to {t['repo']} but {src.relative_to(root)}/{left[0]} is still in the core")
    # tenant code in the core must be registered as moving: a new tenant gets its own repository
    moving = {t.get("source", f"instances/{s}") for s, t in tenants.items() if t.get("state") == "moving"}
    for inst in sorted((root / "instances").iterdir()) if (root / "instances").exists() else []:
        rel = inst.relative_to(root).as_posix()
        if inst.is_dir() and any((inst / d).is_dir() for d in CODE_DIRS) and rel not in moving:
            errs.append(f"{rel}: tenant code lives in the core; register it in {REG} and move it to its own repository (TENANT-REPO-1)")
    topo = json.loads((root / "doctrine/topology.json").read_text())
    by_worker = {t.get("worker"): (s, t) for s, t in tenants.items() if t.get("worker")}
    for w in topo.get("workers", []):
        main = str(w.get("main", ""))
        if main.startswith("instances/") and not any(main.startswith(m + "/") for m in moving):
            errs.append(f"topology {w['id']}: builds from {main} in the core; a tenant worker builds from its own repository (source.repo)")
        src = (w.get("source") or {}).get("repo")
        if src:
            st = by_worker.get(w["id"])
            if not st or st[1]["repo"] != src:
                errs.append(f"topology {w['id']}: source {src} is not the registered repository of a tenant")
    workers = {w.get("id"): w for w in topo.get("workers", [])}
    for slug, t in tenants.items():  # FULLSTACK-1: repo, back end and a public web UI front end, deployed by the platform
        w = workers.get(t.get("worker")) if t.get("worker") else None
        if t.get("worker") and not (w and w.get("state") == "live" and w.get("routes")):
            errs.append(f"{slug}: worker {t['worker']} is not a live topology Worker with a public route (FULLSTACK-1)")
        if not t.get("worker") and not str(t.get("frontend", "")).startswith("https://"):
            errs.append(f"{slug}: no deployed public front end: name a topology `worker` with a route or an https `frontend` (FULLSTACK-1)")
    for slug, t in tenants.items():
        if t.get("state") == "moved" and t.get("worker"):
            w = next((x for x in topo.get("workers", []) if x["id"] == t["worker"]), None)
            if not w or (w.get("source") or {}).get("repo") != t["repo"]:
                errs.append(f"{slug}: moved, but topology {t['worker']} does not build from {t['repo']} (the core's second deploy route)")
    return errs


def _rel_import(file: Path, base: Path, target: str) -> str:
    rel = os.path.relpath(base / target, file.parent).replace(os.sep, "/")
    return rel if rel.startswith(".") else "./" + rel


def prepare(dirpath: Path, slug: str, root: Path = ROOT) -> list[str]:
    """A subtree split of the tenant folder becomes a standalone repository: core files it imports are vendored, imports are rewritten."""
    t = load(root)["tenants"][slug]
    done = []
    for src, dst in (t.get("vendor") or {}).items():
        (dirpath / dst).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(root / src, dirpath / dst)
        done.append(f"vendored {src} -> {dst}")
        pat = re.compile(r"""(["'])(?:\.\./)+""" + re.escape(src) + r"""\1""")
        for f in sorted(dirpath.rglob("*.js")) + sorted(dirpath.rglob("*.mjs")):
            if ".git" in f.parts or "node_modules" in f.parts:
                continue
            s = f.read_text()
            n = pat.sub(lambda m: m.group(1) + _rel_import(f, dirpath, dst) + m.group(1), s)
            if n != s:
                f.write_text(n)
                done.append(f"rewrote import in {f.relative_to(dirpath).as_posix()}")
    # Files only the standalone repository needs (its package.json, its agent instructions) are data here, written at split time,
    # so the core carries no orphan copy of them.
    for name, body in (t.get("write") or {}).items():
        out = dirpath / name
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(body if isinstance(body, str) else json.dumps(body, indent=2) + "\n")
        done.append(f"wrote {name}")
    return done


def last_deployed(root: Path, worker: str) -> str:
    """The tenant commit the last live-verified deploy of this worker carried (ops/deploys.jsonl source_sha)."""
    p, last = root / "ops/deploys.jsonl", ""
    if p.exists():
        for line in p.read_text().splitlines():
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if r.get("worker") == worker and r.get("live_matches_commit") and r.get("source_sha"):
                last = r["source_sha"]
    return last


def behind(root: Path = ROOT, head=None) -> list[str]:
    """Workers of moved tenants whose repository's main is ahead of the last deployed commit. head(repo) returns main's sha."""
    out = []
    for slug, t in sorted(load(root).get("tenants", {}).items()):
        if t.get("state") != "moved" or not t.get("worker"):
            continue
        cur = head(t["repo"]) if head else ""
        if cur and cur != last_deployed(root, t["worker"]):
            out.append(t["worker"])
    return out


def _gh_head(repo: str) -> str:
    import subprocess
    r = subprocess.run(["gh", "api", f"repos/{repo}/commits/main", "--jq", ".sha"], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        print(f"tenantrepos: cannot read {repo} main: {r.stderr.strip()[:200]}", file=sys.stderr)
        return ""
    return r.stdout.strip()


def health_url(worker: str, root: Path = ROOT) -> str:
    """The tenant worker's public /health: its first route, else its workers.dev address."""
    topo = json.loads((root / "doctrine/topology.json").read_text())
    w = next((x for x in topo.get("workers", []) if x.get("id") == worker), {})
    host = (w.get("routes") or [f"{worker}.ultrastable.workers.dev"])[0]
    return f"https://{host}/health"


def health_problems(h) -> list[str]:
    """TENANT-HEALTH-1: a tenant is healthy when /health says ok and no part it reports (evidence, search, reader...) says ok false.
    Liveness alone hid What Works' launch: the clock ticked while every index refused and no programme was ever checked."""
    if not isinstance(h, dict):
        return ["/health is not a JSON object"]
    out = [] if h.get("ok") is True else [f"ok is {h.get('ok')!r} (clock {h.get('clock')!r}, last error {h.get('last_error')!r})"]
    for k, v in h.items():
        if isinstance(v, dict) and v.get("ok") is False:
            out.append(f"{k} not ok: " + json.dumps({x: y for x, y in v.items() if x != 'ok'})[:240])
    return out


def health(root: Path = ROOT, fetch=None) -> dict:
    """Every tenant worker's /health, read live. fetch(url) returns parsed JSON or raises; an unreadable tenant is a failure, never a pass."""
    import urllib.request
    def _get(url):
        req = urllib.request.Request(url, headers={"User-Agent": "ultrastable-tenant-health/1.0", "Cache-Control": "no-cache"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:  # nosec: https only
                return json.loads(r.read(20000).decode("utf-8", "replace"))
        except urllib.error.HTTPError as e:  # a 503 still carries the JSON that says why
            return json.loads(e.read(20000).decode("utf-8", "replace"))
    fetch = fetch or _get
    out = {}
    for slug, t in sorted(load(root).get("tenants", {}).items()):
        if t.get("state") not in ("moved", "own-repo") or not t.get("worker"):
            continue
        url = health_url(t["worker"], root)
        try:
            probs = health_problems(fetch(url))
        except Exception as e:  # recorded as the tenant's failure, not swallowed
            probs = [f"unreadable: {type(e).__name__}: {e}"[:240]]
        out[slug] = {"url": url, "ok": not probs, "problems": probs}
    return out


def missing(reg: dict) -> list[dict]:
    return [{"slug": s, **t} for s, t in sorted(reg.get("tenants", {}).items()) if t.get("state") == "moving"]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="foundation tenantrepos")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--missing", action="store_true")
    ap.add_argument("--behind", action="store_true", help="print the comma-separated workers whose tenant main moved past the last deploy")
    ap.add_argument("--health", action="store_true", help="read every tenant worker's /health live; fail when any is not ok or reports a part not ok (TENANT-HEALTH-1)")
    ap.add_argument("--prepare")
    ap.add_argument("--slug")
    ap.add_argument("--probe", metavar="SLUG", help="pass when the tenant's own repository exists with a main branch (closes its gate)")
    a = ap.parse_args(argv)
    if a.probe:
        t = load().get("tenants", {}).get(a.probe)
        if not t:
            print(f"tenantrepos: no tenant {a.probe} in the registry", file=sys.stderr)
            return 1
        sha = _gh_head(t["repo"])
        print(f"{t['repo']} main {sha[:12]}" if sha else f"{t['repo']} has no main branch yet")
        return 0 if sha else 1
    if a.health:
        res = health()
        print(json.dumps(res, indent=1))
        return 0 if all(v["ok"] for v in res.values()) else 1
    if a.behind:
        print(",".join(behind(head=_gh_head)))
        return 0
    if a.missing:
        print(json.dumps(missing(load())))
        return 0
    if a.prepare:
        for line in prepare(Path(a.prepare), a.slug):
            print(line)
        return 0
    errs = check()
    for e in errs:
        print("tenantrepos:", e)
    print("tenantrepos ok" if not errs else f"tenantrepos: {len(errs)} problem(s)")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())

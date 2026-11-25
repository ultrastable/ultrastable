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
  python3 -m foundation tenantrepos --behind                workers whose tenant repository moved past the last deployed commit (daily redeploy)

Registry: doctrine/tenant-repos.json. States: own-repo (born separate), moving (code still in the core while its repository is created),
moved (code only in the tenant repository; the core's topology entry builds from it), planned (manifest only; its repository is created
before its first line of code), retired (no live deployment; kept as a record).

Sandbox (TENANT-SANDBOX-1, Rowan 2026-11-25: "All UltraStable deployments shall have their own GitHub repo and shall be sandboxed as tenant
apps."): every tenant with a worker declares `sandbox` (its own stores, its own secret names, a daily budget). The check fails when a tenant
worker binds a store that is not its own, binds a core worker as a service, uses a secret outside its scope, or has no budget, and when a
core worker binds a tenant's store.
  python3 -m foundation tenantrepos --isolation             the isolation probe: one line per tenant, exit 1 on any shared binding
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
STATES = {"own-repo", "moving", "moved", "planned", "retired"}
CORE_PREFIX_EXEMPT = ()  # no core store may be bound by a tenant worker
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
    for slug, t in tenants.items():
        if t.get("state") == "moved" and t.get("worker"):
            w = next((x for x in topo.get("workers", []) if x["id"] == t["worker"]), None)
            if not w or (w.get("source") or {}).get("repo") != t["repo"]:
                errs.append(f"{slug}: moved, but topology {t['worker']} does not build from {t['repo']} (the core's second deploy route)")
    errs += isolation(root, reg, topo)
    return errs


def _stores(w: dict) -> set[str]:
    out = set()
    for kind in ("d1", "kv", "r2", "vectorize", "queues_producer"):
        v = (w.get("bindings") or {}).get(kind)
        if isinstance(v, dict):
            out |= {str(x) for x in v.values()}
    out |= {str(x) for x in (w.get("bindings") or {}).get("queues_consumer", []) or []}
    return out


def isolation(root: Path = ROOT, reg: dict | None = None, topo: dict | None = None) -> list[str]:
    """TENANT-SANDBOX-1: a tenant worker touches only its own stores, secrets and budget; no core worker touches a tenant's store."""
    reg = reg or load(root)
    topo = topo or json.loads((root / "doctrine/topology.json").read_text())
    workers = {w["id"]: w for w in topo.get("workers", []) if isinstance(w, dict)}
    errs, tenant_workers, tenant_stores = [], set(), {}
    for slug, t in reg.get("tenants", {}).items():
        w = workers.get(t.get("worker", ""))
        if not w:
            continue
        tenant_workers.add(w["id"])
        sb = t.get("sandbox") or {}
        own = set(sb.get("stores", []))
        for st in own:
            if not st.startswith(f"ultrastable-{slug}"):
                errs.append(f"{slug}: sandbox store {st} is not named for the tenant (ultrastable-{slug}*)")
            tenant_stores[st] = slug
        for st in sorted(_stores(w) - own):
            errs.append(f"{slug}: worker {w['id']} binds {st}, which is not in its sandbox (no shared stores)")
        svc = (w.get("bindings") or {}).get("services") or {}
        if svc:
            errs.append(f"{slug}: worker {w['id']} binds services {sorted(svc.values())}; a tenant reaches the core only over its public API")
        extra = set((w.get("bindings") or {}).get("secrets", []) or []) - set(sb.get("secrets", []))
        if extra:
            errs.append(f"{slug}: worker {w['id']} uses secrets outside its scope: {sorted(extra)}")
        b = sb.get("budget") or {}
        if not all(isinstance(b.get(k), int) and b[k] > 0 for k in ("requests_per_day", "d1_reads_per_day", "ai_neurons_per_day")):
            errs.append(f"{slug}: sandbox needs a daily budget (requests_per_day, d1_reads_per_day, ai_neurons_per_day)")
    budgets_path = root / "instances/ultrastable/cost-budgets.json"
    sampled = {b.get("database_name") for b in json.loads(budgets_path.read_text()).get("budgets", [])} if budgets_path.exists() else set()
    for slug, t in reg.get("tenants", {}).items():
        w = workers.get(t.get("worker", ""))
        for st in sorted(set(((w or {}).get("bindings") or {}).get("d1", {}).values()) & set((t.get("sandbox") or {}).get("stores", []))):
            if budgets_path.exists() and st not in sampled:
                errs.append(f"{slug}: D1 {st} has no row in instances/ultrastable/cost-budgets.json, so its budget is never sampled")
    for slug, t in reg.get("tenants", {}).items():
        if t.get("state") != "retired":
            continue
        src = root / t.get("source", f"instances/{slug}")
        for app in sorted(src.glob("*/app.json")) if src.exists() else []:
            if json.loads(app.read_text()).get("status") != "retired":
                errs.append(f"{app.relative_to(root)}: live again inside retired {slug}; launch it as its own tenant repository")
    for wid, w in workers.items():
        if wid in tenant_workers:
            continue
        for st in sorted(_stores(w) & set(tenant_stores)):
            errs.append(f"core worker {wid} binds {st}, which belongs to tenant {tenant_stores[st]}")
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


def missing(reg: dict) -> list[dict]:
    return [{"slug": s, **t} for s, t in sorted(reg.get("tenants", {}).items()) if t.get("state") in ("moving", "planned")]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="foundation tenantrepos")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--missing", action="store_true")
    ap.add_argument("--behind", action="store_true", help="print the comma-separated workers whose tenant main moved past the last deploy")
    ap.add_argument("--prepare")
    ap.add_argument("--slug")
    ap.add_argument("--isolation", action="store_true", help="the sandbox probe: every tenant worker touches only its own stores")
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
    if a.isolation:
        errs = isolation()
        for slug in sorted(load().get("tenants", {})):
            bad = [e for e in errs if e.startswith(slug + ":")]
            print(f"{slug}: {'shared: ' + bad[0] if bad else 'isolated'}")
        for e in errs:
            if e.startswith("core worker"):
                print(e)
        return 1 if errs else 0
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

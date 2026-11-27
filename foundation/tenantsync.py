# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""TENANT-SYNC-1: core is the system of record; tenants pin it by hash and every generic capability they build flows up.

Backend only. A person using a system never sees any of this; every decision is one line in ops/tenant-sync/ledger.jsonl.

  python3 -m foundation.tenantsync --check                      registry covers every org repository; the tool exists
  python3 -m foundation.tenantsync --run [--apply] [--tenant S]  clone each tenant, check it, send generic code up (core PR), re-vendor it (tenant PR)
"""
from __future__ import annotations
import argparse, datetime as dt, json, os, subprocess, sys, tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CFG = "doctrine/tenant-sync.json"


def cfg(root=REPO) -> dict:
    return json.loads((Path(root) / CFG).read_text(encoding="utf-8"))


def check(root=REPO) -> list[str]:
    root, c, bad = Path(root), cfg(root), []
    if not (root / c["core"]["tool"]).is_file():
        bad.append("core tool missing: " + c["core"]["tool"])
    reg = json.loads((root / "org/repos.json").read_text(encoding="utf-8"))
    names = {r["name"] for r in reg["repos"]} | {t.split("/", 1)[1] for t in reg.get("target", [])}
    for n in sorted(names - set(c["repos"])):
        bad.append(f"repository {n} has no role in {CFG} (core, tenant, tracker, pointer or org-profile)")
    for n, r in c["repos"].items():
        if r.get("role") == "tenant" and not (r.get("clone") and r.get("pr_repo")):
            bad.append(f"tenant {n} needs clone and pr_repo")
        if r.get("role") != "tenant" and not r.get("why"):
            bad.append(f"{n}: why is required")
    return bad


def ledger(root, event: dict) -> None:
    p = Path(root) / cfg(root)["ledger"]
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), **event}, sort_keys=True) + "\n")


def _run(args, cwd=None, env=None):
    r = subprocess.run(args, cwd=cwd, capture_output=True, text=True, env=env)
    return r.returncode, (r.stdout + r.stderr).strip()


def _tool_json(tool, cmd, d, core_dir):
    """Run a tenant_sync command; a failure is a ledger row with the error, never a crash or a swallowed one."""
    r = subprocess.run([sys.executable, str(tool), cmd, "--tenant", str(d), "--core", str(core_dir)], capture_output=True, text=True)
    if r.returncode:
        return {"error": (r.stderr or r.stdout).strip()[-400:]}
    try:
        return json.loads(r.stdout or "{}")
    except ValueError:
        return {"error": "non-JSON output: " + r.stdout.strip()[-200:]}


def run(root=REPO, apply=False, only=None) -> list[dict]:
    root, c, rows = Path(root), cfg(root), []
    tool = root / c["core"]["tool"]
    core_dir = root / c["core"]["dir"]
    tok = os.environ.get("LANE_PAT") or os.environ.get("GH_TOKEN", "")
    for name, t in c["repos"].items():
        if t.get("role") != "tenant" or (only and only != name):
            continue
        d = Path(tempfile.mkdtemp())
        rc, out = _run(["git", "clone", "--depth", "1", f"https://x-access-token:{tok}@github.com/{t['clone']}.git", str(d)])
        if rc:
            rows.append({"tenant": name, "status": "unreachable", "detail": out[-200:]}); ledger(root, rows[-1]); continue
        rc, report = _run([sys.executable, str(tool), "check", "--tenant", str(d), "--core", str(core_dir)])
        up = _run([sys.executable, str(tool), "send-up", "--tenant", str(d), "--core", str(core_dir)])[1]
        down = _tool_json(tool, "revendor", d, core_dir)
        if down.get("error"):
            rows.append({"tenant": name, "status": "tool-error", "detail": down["error"]}); ledger(root, rows[-1]); print(rows[-1], file=sys.stderr); continue
        row = {"tenant": name, "check": "ok" if rc == 0 else "fail", "findings": report.split("\n")[:20] if rc else [],
               "send_up": [] if up.startswith("nothing") else up.split("\n"), "revendor": down}
        row["status"] = "in-sync" if rc == 0 and not row["send_up"] and not down.get("changed") and not down.get("removed") else "needs-pr"
        rows.append(row)
        ledger(root, {k: v for k, v in row.items() if k != "findings"} | {"findings": len(row["findings"])})
        if apply and row["status"] == "needs-pr":
            _open_prs(root, c, name, t, d, tool, row, tok)
    return rows


def _pr(repo, title, body, head, env):
    """REST, not `gh pr create`: the GraphQL mutation is refused for integration tokens ("Resource not accessible by integration",
    ledger 2026-11-24 and 25), and the token is passed explicitly so the loop never falls back to a narrower ambient one."""
    rc, out = _run(["gh", "api", f"repos/{repo}/pulls", "-f", f"title={title}", "-f", f"head={head}", "-f", "base=main", "-f", f"body={body}",
                    "--jq", ".html_url"], env=env)
    if rc == 0:
        n = out.rstrip("/").rsplit("/", 1)[-1]
        _run(["gh", "api", f"repos/{repo}/issues/{n}/labels", "-f", "labels[]=handoff"], env=env)
    return rc, out


# SYNC-BOTH-WAYS-1 (Rowan, 2026-11-25): "Every Ultrastable system shall always improve and update itself and the Ultrastable platform
# automatically." Two measures, read from the ledger this loop already writes: how far behind each tenant is (down), and how often a
# tenant's general improvement reaches the core (up). Either one out of bounds files its own queue item.
def metrics(root=REPO, now=None) -> dict:
    root, c = Path(root), cfg(root)
    now = now or dt.datetime.now(dt.timezone.utc)
    rows = []
    p = root / c["ledger"]
    if p.is_file():
        for line in p.read_text(encoding="utf-8").splitlines():
            try:
                rows.append(json.loads(line))
            except ValueError:
                continue
    at = lambda r: dt.datetime.fromisoformat(r["at"].replace("Z", "+00:00"))
    tenants = {}
    for n, t in c["repos"].items():
        if t.get("role") != "tenant":
            continue
        mine = [r for r in rows if r.get("tenant") == n and "status" in r]
        last = mine[-1] if mine else None
        synced = [r for r in mine if r["status"] == "in-sync"]
        since = synced[-1]["at"] if synced else (mine[0]["at"] if mine else None)
        days = round((now - at({"at": since})).total_seconds() / 86400, 1) if since else None
        drift = (last or {}).get("revendor", {}).get("changed") if last and last["status"] != "in-sync" else 0
        tenants[n] = {"status": (last or {}).get("status", "unmeasured"), "drift_files": drift, "days_behind": days if last and last["status"] != "in-sync" else 0,
                      "ok": bool(last) and (last["status"] == "in-sync" or (days or 0) <= c.get("drift_max_days", 2))}
    cut = now - dt.timedelta(days=30)
    ups = [r for r in rows if r.get("action") == "core-pr" and at(r) >= cut and "github.com" in str(r.get("result", ""))]
    cands = [r for r in rows if r.get("send_up") and at(r) >= cut]
    return {"at": now.isoformat(), "tenants": tenants, "upstream_prs_30d": len(ups), "upstream_candidates_30d": len(cands),
            "upstream_ok": len(ups) >= c.get("upstream_min_30d", 1) or not cands}


def file_items(root, m) -> list[str]:
    out = []
    for n, t in m["tenants"].items():
        if t["ok"]:
            continue
        iid = f"Q-SYNC-DRIFT-{n}"
        out.append((iid, f"tenant {n} is {t['days_behind']} days behind the platform ({t['drift_files']} files, status {t['status']})",
                    f"cmd:python3 -m foundation tenantsync --probe drift:{n}",
                    f"Read the last rows for {n} in ops/tenant-sync/ledger.jsonl, fix what stops the re-vendor pull request (token, clone, tool error), and land it through the tenant's lane."))
    if not m["upstream_ok"]:
        out.append(("Q-SYNC-UPSTREAM", f"{m['upstream_candidates_30d']} general improvements found in tenants but none reached the platform in 30 days",
                    "cmd:python3 -m foundation tenantsync --probe upstream", "Make the lift pull request open and merge: see the core-pr rows in ops/tenant-sync/ledger.jsonl."))
    filed = []
    for iid, title, probe, body in out:
        f = Path(root) / "docs/issues" / f"{iid}.json"
        if f.is_file() and "**Status:** open" in f.read_text(encoding="utf-8"):
            continue
        f.write_text(json.dumps({"id": iid, "title": f"{iid}: {title}", "body": f"**Owner:** operations\n**Trigger:** tenant-sync --run\n**Done check:** {probe}\n**Prediction:** tenant_sync_drift_days <= 2 within 48 h\n**Status:** open\n\n{body}\n\n**Closing probe:** {probe}\n",
                                 "labels": ["p1", "agent-ready", "role:operations", "sync"], "milestone": "Now", "workstream": "Executor queue"}, indent=2) + "\n", encoding="utf-8")
        filed.append(iid)
    return filed


def probe(root, spec, now=None) -> bool:
    m = metrics(root, now)
    kind, _, key = spec.partition(":")
    if kind == "drift":
        return m["tenants"].get(key, {}).get("ok", False)
    if kind == "upstream":
        return m["upstream_ok"]
    return False


def _open_prs(root, c, name, t, d, tool, row, tok):
    env = {**os.environ, "GH_TOKEN": tok}
    day = dt.date.today().isoformat()
    body = "Generated by the backend tenant-sync loop (TENANT-SYNC-1). Every action is in ops/tenant-sync/ledger.jsonl.\n\nItem: Q-LIFT-TENANT-1\nPrediction: tenant_sync_drift_files <= 0 within 24 h\nAuthor: tenant-sync loop\nReviewer: automated checks (lane merges on green)"
    if row["send_up"]:
        br = f"agent/tenant-lift-{name}-{day}"
        _run(["git", "checkout", "-B", br], cwd=root)
        _run([sys.executable, str(tool), "send-up", "--tenant", str(d), "--core", str(root / c["core"]["dir"]), "--apply"])
        _run(["git", "add", "-A", c["core"]["dir"]], cwd=root)
        if _run(["git", "diff", "--cached", "--quiet"], cwd=root)[0]:
            _run(["git", "commit", "-qm", f"core: lift generic code from tenant {name} (TENANT-SYNC-1)"], cwd=root)
            _run(["git", "push", "-u", "origin", br], cwd=root)
            rc, out = _pr(c["core"]["repo"], f"Lift generic code from tenant {name}", body, br, env)
            ledger(root, {"tenant": name, "action": "core-pr", "result": out[-200:]})
    if row["revendor"].get("changed") or row["revendor"].get("removed") or row["revendor"].get("settled"):
        br = f"agent/revendor-core-{day}"
        _run(["git", "checkout", "-B", br], cwd=d)
        _run([sys.executable, str(tool), "revendor", "--tenant", str(d), "--core", str(root / c["core"]["dir"]), "--apply"])
        _run(["git", "add", "-A"], cwd=d)
        _run(["git", "-c", "user.name=tenant-sync", "-c", "user.email=tenant-sync@users.noreply.github.com", "commit", "-qm", "Re-vendor the core (TENANT-SYNC-1)"], cwd=d)
        _run(["git", "push", "-u", "origin", br, "--force-with-lease"], cwd=d)
        rc, out = _pr(t["pr_repo"], "Re-vendor the core", body, br, env)
        ledger(root, {"tenant": name, "action": "tenant-pr", "result": out[-200:]})


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check", action="store_true"); ap.add_argument("--run", action="store_true")
    ap.add_argument("--apply", action="store_true"); ap.add_argument("--tenant")
    ap.add_argument("--metrics", action="store_true"); ap.add_argument("--probe")
    a = ap.parse_args(argv)
    if a.probe:
        ok = probe(REPO, a.probe); print(f"{a.probe}: {'pass' if ok else 'fail'}"); return 0 if ok else 1
    if a.metrics:
        m = metrics(REPO)
        if a.apply:
            (REPO / "ops/tenant-sync/metrics.json").write_text(json.dumps(m, indent=1) + "\n", encoding="utf-8")
            m["filed"] = file_items(REPO, m)
        print(json.dumps(m, indent=1)); return 0
    if a.run:
        print(json.dumps(run(REPO, a.apply, a.tenant), indent=1)); return 0
    bad = check(); print("\n".join(bad) or "every repository has a role; the tenant-sync tool is present"); return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

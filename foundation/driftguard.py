# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""Classes of the 2026-11-25 failures, each as a check that catches the whole class (DRIFT-GUARD-1, Rowan 2026-11-25: "Audit and
remediate all of your failures and their root causes and fix them all in code. Every single thing, including red teaming your own blind spots.").
Ultrastable is the foundation for any autonomous system.

Every check below exists because one failure of that day had a cause that would recur in another shape. Registry: doctrine/driftguard.json
(the incident, the class, the check and its detector). Detectors in doctrine/detectors.json run them daily in failure-audit.yml; the watchdog
runs the ones that act (--triggers --apply); each class is also a row in doctrine/rootcauses.json, so a recurrence escalates through
foundation/rootcause.py. Nothing here prints a secret value.

  python3 -m foundation driftguard --check               the registry is whole: every incident names a class, a check that exists and a detector
  python3 -m foundation driftguard --crons [--live]      CRON-BUDGET-1: crons fit the plan's account limit with headroom; every tenant back end that
                                                        runs on a clock has a second route (topology `pulse`); --live reads every schedule on the
                                                        account and fails on one the repository does not declare
  python3 -m foundation driftguard --triggers [--apply]  MISSED-TRIGGER-1: a push to main that matched a workflow's paths and started no run of it
                                                        (a merge made with the run's own token starts nothing) is found; --apply dispatches the workflow
  python3 -m foundation driftguard --empty-commits       EMPTY-LOOP-1: commits whose tree equals their parent's in the last day, per branch; more than
                                                        `max_empty_per_branch` is a loop pushing nothing
  python3 -m foundation driftguard --accounts-live       ACCOUNT-DRIFT-1: the Cloudflare token the workflows hold reaches the account the topology names,
                                                        and CLOUDFLARE_ACCOUNT_ID (when set) is that account; a retired account fails
  python3 -m foundation driftguard --visibility-live     VISIBILITY-DRIFT-1: every repository's live visibility equals its declaration (the tick's
                                                        repo-visibility loop sets it back; this is the independent second reading)
  python3 -m foundation driftguard --built-live        LIVE-EVIDENCE-2: every knowledge-graph row marked built answers its probe URL with at least one node
  python3 -m foundation driftguard --handoff-lint [FILE] LIVE-EVIDENCE-1: a PR that deploys a worker carries a verify line that reads that worker, not
                                                        the generic tick health line, which passes whatever the change did
"""
from __future__ import annotations
import fnmatch, hashlib, json, os, re, subprocess, sys, time, urllib.error, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
REG = "doctrine/driftguard.json"
UA = "ultrastable-driftguard"


def _j(p, root=REPO):
    return json.loads((Path(root) / p).read_text(encoding="utf-8"))


def _http(url, token=None, method="GET", body=None, auth="Bearer"):
    h = {"user-agent": UA, "accept": "application/json"}
    if token:
        h["authorization"] = f"{auth} {token}"
    data = None
    if body is not None:
        data = json.dumps(body).encode(); h["content-type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read().decode() or "{}"
            return r.status, (json.loads(raw) if raw.strip().startswith(("{", "[")) else {})
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "{}")
        except ValueError:
            return e.code, {}


# ---------- registry ----------
def check(root=REPO) -> list[str]:
    reg, errs = _j(REG, root), []
    det = {d["id"]: d for d in _j("doctrine/detectors.json", root)["detectors"]}
    modes = {m["id"] for m in _j("doctrine/registers.json", root)["failure_modes"]}
    for i in reg["incidents"]:
        for k in ("id", "what", "class", "root_cause", "fix", "check", "detector", "failure_mode"):
            if not i.get(k):
                errs.append(f"{i.get('id', '?')}: missing {k}")
        if i.get("detector") and i["detector"] not in det:
            errs.append(f"{i['id']}: detector {i['detector']} is not in doctrine/detectors.json")
        if i.get("failure_mode") and i["failure_mode"] not in modes:
            errs.append(f"{i['id']}: failure mode {i['failure_mode']} is not in doctrine/registers.json")
        for p in i.get("code", []):
            if not (Path(root) / p).exists():
                errs.append(f"{i['id']}: code path {p} does not exist")
    return errs


# ---------- CRON-BUDGET-1 ----------
def crons(root=REPO, live=False, env=os.environ) -> list[str]:
    reg = _j(REG, root)["cron_budget"]
    topo = _j("doctrine/topology.json", root)
    plan = _j("instances/ultrastable/instance.json", root).get("budget", {}).get("plan", "free")
    limit = reg["limits"][plan]
    cap = int(limit * reg["headroom"])
    declared = {}
    for w in topo["workers"]:
        if w.get("state") == "live" and w.get("crons"):
            declared[w["id"]] = list(w["crons"])
    for wid, cs in reg.get("external", {}).items():
        declared[wid] = list(cs)
    total, errs = sum(len(c) for c in declared.values()), []
    if total > cap:
        errs.append(f"{total} cron triggers declared on the account, over {cap} ({reg['headroom']:.0%} of the {plan} plan's {limit}); move a worker's clock to the tick's pulse (topology `pulse`)")
    for w in topo["workers"]:
        if w.get("state") == "live" and w.get("crons") and w.get("source") and not w.get("pulse"):
            errs.append(f"{w['id']}: a tenant back end whose only route to run is its own cron; declare `pulse` (its POST /pulse/watch URL) so the tick runs it too")
    if not live:
        return errs
    tok, acct = env.get("CLOUDFLARE_API_TOKEN"), topo["account_id"]
    if not tok:
        return errs + ["unmeasured: no CLOUDFLARE_API_TOKEN, the account's schedules were not read (never read as in order)"]
    st, j = _http(f"https://api.cloudflare.com/client/v4/accounts/{acct}/workers/scripts", tok)
    if st != 200:
        return errs + [f"unmeasured: listing workers answered HTTP {st}"]
    seen = 0
    for s in j.get("result", []):
        st2, k = _http(f"https://api.cloudflare.com/client/v4/accounts/{acct}/workers/scripts/{s['id']}/schedules", tok)
        if st2 != 200:
            errs.append(f"unmeasured: schedules of {s['id']} answered HTTP {st2}"); continue
        live_c = sorted(x["cron"] for x in k.get("result", {}).get("schedules", []))
        seen += len(live_c)
        want = sorted(declared.get(s["id"], []))
        if live_c != want:
            errs.append(f"{s['id']}: live crons {live_c or 'none'}, declared {want or 'none'}")
    if seen > cap:
        errs.append(f"{seen} live cron triggers on the account, over {cap}")
    return errs


# ---------- MISSED-TRIGGER-1 ----------
def _workflow_paths(root=REPO) -> dict:
    """{workflow file: [path globs]} for every workflow triggered by a push to main with a paths filter (parsed without a YAML dependency)."""
    out = {}
    for f in sorted((Path(root) / ".github/workflows").glob("*.yml")):
        txt = f.read_text(encoding="utf-8")
        m = re.search(r"^on:\s*\n((?:[ \t]+.*\n|\s*\n)+)", txt, re.M)
        if not m or "workflow_dispatch" not in m.group(1):
            continue
        push = re.search(r"^\s+push:\s*\n((?:\s{4,}.*\n)+)", m.group(1), re.M)
        if not push:
            continue
        block = push.group(1)
        if "main" not in block:
            continue
        pm = re.search(r"paths:\s*\[([^\]]*)\]", block) or re.search(r"paths:\s*\n((?:\s+-\s*.*\n)+)", block)
        if not pm:
            continue
        globs = [g.strip().strip("'\"") for g in re.split(r",|\n\s*-\s*", pm.group(1).replace("- ", ",")) if g.strip().strip("'\"-, ")]
        out[f.name] = [g.strip("- ").strip() for g in globs if g.strip("- ").strip()]
    return out


def _match(path, globs):
    for g in globs:
        if g.startswith("!"):
            continue
        if fnmatch.fnmatch(path, g) or fnmatch.fnmatch(path, g.replace("**/", "")) or (g.endswith("/**") and path.startswith(g[:-3])):
            return True
    return False


def triggers(root=REPO, apply=False, env=os.environ, hours=None, now=None) -> list[str]:
    reg = _j(REG, root)["missed_trigger"]
    hours = hours or reg["window_hours"]
    repo = env.get("GITHUB_REPOSITORY", "ultrastable/ultrastable")
    tok = env.get("GH_TOKEN") or env.get("GITHUB_TOKEN")
    wf = _workflow_paths(root)
    log = subprocess.run(["git", "-C", str(root), "log", "origin/main", f"--since={hours} hours ago", "--format=%H %ct %s", "--name-only"],
                         capture_output=True, text=True)
    if log.returncode != 0:
        log = subprocess.run(["git", "-C", str(root), "log", "HEAD", f"--since={hours} hours ago", "--format=%H %ct %s", "--name-only"], capture_output=True, text=True)
    if log.returncode != 0:
        return [f"unmeasured: git log failed: {log.stderr.strip()[:120]}"]
    commits, cur = [], None
    for line in log.stdout.splitlines():
        m = re.match(r"^([0-9a-f]{40}) (\d+) (.*)$", line)
        if m:
            cur = {"sha": m.group(1), "at": int(m.group(2)), "subject": m.group(3), "files": []}; commits.append(cur)
        elif line.strip() and cur:
            cur["files"].append(line.strip())
    now = now or time.time()
    due = {}  # workflow -> newest matching commit that is old enough to have started a run
    for c in commits:
        if "[skip ci]" in c["subject"] or now - c["at"] < reg["grace_minutes"] * 60:
            continue
        for name, globs in wf.items():
            if any(_match(p, globs) for p in c["files"]) and name not in due:
                due[name] = c
    if not due:
        return []
    if not tok:
        return [f"unmeasured: {len(due)} workflow(s) had matching pushes but no GitHub token was given to read their runs"]
    errs = []
    for name, c in due.items():
        st, j = _http(f"https://api.github.com/repos/{repo}/actions/workflows/{name}/runs?per_page=30&branch=main", tok)
        if st != 200:
            errs.append(f"unmeasured: runs of {name} answered HTTP {st}"); continue
        runs = j.get("workflow_runs", [])
        newest = max((time.mktime(time.strptime(r["created_at"], "%Y-%m-%dT%H:%M:%SZ")) - time.timezone for r in runs), default=0)
        if any(r.get("head_sha") == c["sha"] for r in runs) or newest >= c["at"]:
            continue
        msg = f"{name}: push {c['sha'][:7]} ({c['subject'][:60]}) matched its paths and started no run"
        if apply:
            d, _ = _http(f"https://api.github.com/repos/{repo}/actions/workflows/{name}/dispatches", tok, "POST", {"ref": "main"})
            msg += f"; dispatched: HTTP {d}" + ("" if d == 204 else " (refused)")
            if d == 204:
                print(msg); continue
        errs.append(msg)
    return errs


# ---------- EMPTY-LOOP-1 ----------
def empty_commits(root=REPO, hours=24) -> list[str]:
    reg = _j(REG, root)["empty_loop"]
    refs = subprocess.run(["git", "-C", str(root), "for-each-ref", "--format=%(refname)", "refs/remotes/origin", "refs/heads"], capture_output=True, text=True)
    if refs.returncode != 0:
        return [f"unmeasured: {refs.stderr.strip()[:120]}"]
    errs = []
    for ref in refs.stdout.split():
        if ref.endswith("/HEAD"):
            continue
        log = subprocess.run(["git", "-C", str(root), "log", ref, f"--since={hours} hours ago", "--no-merges", "--format=%H %T %P"], capture_output=True, text=True)
        n = 0
        for line in log.stdout.splitlines():
            parts = line.split()
            if len(parts) != 3:
                continue
            sha, tree, parent = parts
            pt = subprocess.run(["git", "-C", str(root), "rev-parse", f"{parent}^{{tree}}"], capture_output=True, text=True)
            if pt.returncode == 0 and pt.stdout.strip() == tree:
                n += 1
        if n > reg["max_empty_per_branch"]:
            errs.append(f"{ref}: {n} empty commits in {hours} h (a loop pushing a tree equal to its parent; MERGENOW-NOOP-1)")
    return errs


# ---------- ACCOUNT-DRIFT-1 ----------
def accounts_live(root=REPO, env=os.environ) -> list[str]:
    acct = _j("doctrine/topology.json", root)["account_id"]
    retired = set(_j(REG, root)["account_drift"]["retired_account_sha256"])  # hashes only: the retired id itself may not be written (SINGLE-ACCOUNT-1)
    errs = []
    given = (env.get("CLOUDFLARE_ACCOUNT_ID") or "").strip()
    if given:
        h = hashlib.sha256(given.encode()).hexdigest()
        if given != acct:
            errs.append("CLOUDFLARE_ACCOUNT_ID names " + ("a retired account" if h in retired else "another account") + f" (sha256 {h[:12]}), not the topology's account")
    tok = env.get("CLOUDFLARE_API_TOKEN")
    if not tok:
        return errs + ["unmeasured: no CLOUDFLARE_API_TOKEN given to this step"]
    st, j = _http(f"https://api.cloudflare.com/client/v4/accounts/{acct}", tok)
    if st != 200:
        errs.append(f"CLOUDFLARE_API_TOKEN cannot read the topology's account (HTTP {st}): it was minted on another account or has lapsed")
    st, j = _http(f"https://api.cloudflare.com/client/v4/accounts/{acct}/workers/scripts", tok)
    if st != 200:
        errs.append(f"CLOUDFLARE_API_TOKEN cannot list the account's Workers (HTTP {st}): deploys would fail")
    return errs


# ---------- VISIBILITY-DRIFT-1 ----------
def declared_visibility(root=REPO) -> dict:
    vis = {}
    for r in _j("org/repos.json", root)["repos"]:
        if not r.get("archived") and isinstance(r.get("private"), bool):
            vis[f"ultrastable/{r['name']}"] = r["private"]
    for t in _j("doctrine/tenant-repos.json", root)["tenants"].values():
        if t.get("repo") and t.get("state") != "retired":
            vis[t["repo"]] = t.get("visibility") == "private"
    return vis


def visibility_live(root=REPO, env=os.environ) -> list[str]:
    tok = env.get("GH_TOKEN") or env.get("GITHUB_TOKEN")
    errs = []
    for repo, want in sorted(declared_visibility(root).items()):
        st, j = _http(f"https://api.github.com/repos/{repo}", tok)
        if st != 200:
            errs.append(f"{repo}: " + ("unreadable to this token; a private repository or a missing one (HTTP 404)" if st == 404 else f"HTTP {st}") + f", declared {'private' if want else 'public'}")
            continue
        if bool(j.get("private")) != want:
            errs.append(f"{repo}: {'private' if j.get('private') else 'public'}, declared {'private' if want else 'public'}")
    return errs


# ---------- LIVE-EVIDENCE-1 ----------
GENERIC = re.compile(r"ultrastable-tick\.[a-z0-9-]+\.workers\.dev/health", re.I)


def handoff_lint(body: str, root=REPO) -> list[str]:
    m = re.search(r"^##\s*Handoff\s*$(.*?)(?=^##\s|\Z)", body or "", re.M | re.S)
    if not m:
        return []
    kv = {}
    for line in m.group(1).splitlines():
        k = re.match(r"^\s*[-*]?\s*`?(item|agent|verify|deploy)`?\s*:\s*(.+?)\s*$", line, re.I)
        if k:
            kv[k.group(1).lower()] = (kv.get(k.group(1).lower(), "") + " " + k.group(2)).strip()
    deploy = [d.strip(" `") for d in re.split(r"[,\s]+", kv.get("deploy", "")) if d.strip(" `") and d.strip(" `").lower() != "none"]
    verify = kv.get("verify", "")
    if not deploy:
        return []
    if not verify:
        return [f"deploys {', '.join(deploy)} with no verify line: nothing reads the change live"]
    if GENERIC.search(verify) and deploy != ["ultrastable-tick"]:
        return [f"deploys {', '.join(deploy)} but verifies only the tick's /health, which passes whatever the change did; verify a URL the change serves"]
    return []


# ---------- LIVE-EVIDENCE-2: "built" is a reading, not a word ----------
def _node_count(j):
    if not isinstance(j, dict):
        return 0
    for k in ("nodes", "node_count", "n_nodes"):
        v = j.get(k)
        if isinstance(v, int):
            return v
        if isinstance(v, list):
            return len(v)
    for k in ("counts", "graph", "stats", "totals"):
        if isinstance(j.get(k), dict):
            n = _node_count(j[k])
            if n:
                return n
    return 0


def built_live(root=REPO) -> list[str]:
    """Practical Solutions' graph was marked built and had never run. A built row must answer its probe with at least one node."""
    errs = []
    for sid, row in _j("doctrine/knowledge-graph.json", root)["systems"].items():
        if row.get("state") != "built":
            continue
        url = row.get("probe")
        if not url:
            errs.append(f"{sid}: marked built with no probe URL to read it"); continue
        st, j = _http(url)
        if st != 200:
            errs.append(f"{sid}: marked built, {url} answered HTTP {st}"); continue
        if _node_count(j) < 1:
            errs.append(f"{sid}: marked built, {url} reports no nodes (the graph never ran)")
    return errs


def main(argv) -> int:
    def report(errs, ok):
        unmeasured = [e for e in errs if e.startswith("unmeasured")]
        for e in errs:
            print(("~ " if e.startswith("unmeasured") else "x ") + e)
        if not errs:
            print(ok)
        return 1 if [e for e in errs if e not in unmeasured] or (unmeasured and "--strict" in argv) else 0
    if "--check" in argv:
        return report(check(), f"driftguard: {len(_j(REG)['incidents'])} incidents, each with a class, a check and a detector")
    if "--crons" in argv:
        return report(crons(live="--live" in argv), "crons: inside the account budget; every tenant clock has a second route")
    if "--triggers" in argv:
        return report(triggers(apply="--apply" in argv), "triggers: every matching push started its workflow")
    if "--empty-commits" in argv:
        return report(empty_commits(), "empty commits: none looping")
    if "--accounts-live" in argv:
        return report(accounts_live(), "accounts: the workflows' Cloudflare credential reaches the topology's account")
    if "--visibility-live" in argv:
        return report(visibility_live(), "visibility: every declared repository matches")
    if "--built-live" in argv:
        return report(built_live(), "built: every built knowledge graph answers with nodes")
    if "--handoff-lint" in argv:
        i = argv.index("--handoff-lint")
        src = argv[i + 1] if len(argv) > i + 1 and not argv[i + 1].startswith("--") else None
        body = Path(src).read_text(encoding="utf-8") if src else ""
        if not src and os.environ.get("GITHUB_EVENT_PATH"):
            ev = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
            body = ((ev.get("pull_request") or {}).get("body")) or ""
        return report(handoff_lint(body), "handoff: the verify line reads what the change deploys")
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

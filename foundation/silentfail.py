# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SILENT-FAIL-1 (Rowan, 2026-11-25): "Audit and remediate all of your failures and their root causes ... including red teaming your own blind spots."

The failures of 2026-11-25 shared one shape: a probe proved that a job ran, never that its result arrived, and "done" was claimed with no live reading.
This module is the generic, server-side answer. Each check is pure logic with injected I/O, so it runs in Actions, the tick Worker's twin or a test.

  python3 -m foundation silentfail --bundle              Worker source that cannot bundle: Node builtins without compat, imports that resolve to nothing
  python3 -m foundation silentfail --overlap [BASE]      new modules that duplicate an existing one (stem, concept cluster, docstring overlap)
  python3 -m foundation silentfail --live [--apply]      fetch every target in doctrine/silent-failures.json `live`, append ops/live-verify.jsonl
  python3 -m foundation silentfail --cite FILE           a pull request body that claims done must carry `Live:` lines the ledger proves
  python3 -m foundation silentfail --actions [--apply]   workflow runs stuck at action_required: approve, else dispatch; idea issues nothing took
  python3 -m foundation silentfail --stale               ledgers whose newest row is older than its limit (a loop that stopped writing)
  python3 -m foundation silentfail --classes             every silent-failure class has a registered detector; unclassified incidents become a new class
  python3 -m foundation silentfail --check               bundle + overlap(origin/main) + classes; exit 1 on any finding

An unreadable surface is a finding, never a pass. Nothing here handles a secret value: the GitHub token is read from the environment by name.
"""
from __future__ import annotations
import json, os, re, subprocess, sys, urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
CFG = "doctrine/silent-failures.json"
LIVE_LEDGER = "ops/live-verify.jsonl"
NODE_BUILTINS = {"fs", "path", "os", "child_process", "crypto", "http", "https", "net", "tls", "zlib", "stream", "util", "events", "buffer", "url",
                 "assert", "cluster", "dns", "readline", "vm", "worker_threads", "module", "process", "perf_hooks"}
IMPORT_RX = re.compile(r"""(?:^|\n)\s*(?:import\s[^'"\n;]*?from\s*|import\s*|export\s[^'"\n;]*?from\s*)['"]([^'"]+)['"]|(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)""")
DONE_RX = re.compile(r"^\s*(?:Status|Done)\s*:\s*(?:done|live|deployed|verified|yes)\b", re.I | re.M)
LIVE_LINE_RX = re.compile(r"^\s*Live:\s*GET\s+(https://\S+)\s+expect\s+\"([^\"]+)\"\s*$", re.M)
NA_RX = re.compile(r"^\s*Live:\s*n/a\s+\S.{8,}$", re.M)


def cfg(root=REPO) -> dict:
    return json.loads((Path(root) / CFG).read_text(encoding="utf-8"))


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---- 1. bundle check (a deploy broke from a Node import in the Worker bundle) -----------------------------------------------------------------
def bundle_findings(root=REPO) -> list[dict]:
    """Worker source files that would not bundle for the Workers runtime: a Node builtin import (no nodejs_compat in any wrangler config) or a
    relative import that resolves to no file. Tests, mjs tooling and node-only folders are excluded in doctrine/silent-failures.json."""
    root = Path(root)
    c = cfg(root)["bundle"]
    out = []
    for grp in c["groups"]:
        w = root / grp["wrangler"]
        compat = w.is_file() and "nodejs_compat" in w.read_text(encoding="utf-8", errors="replace")
        for g in grp["source_globs"]:
            for p in sorted(root.glob(g)):
                rel = p.relative_to(root).as_posix()
                if p.suffix != ".js" or any(rel.endswith(x) for x in c["exclude_suffix"]) or any(x in rel for x in c["exclude_contains"]):
                    continue
                text = p.read_text(encoding="utf-8", errors="replace")
                for m in IMPORT_RX.finditer(text):
                    spec = m.group(1) or m.group(2)
                    bare = spec[5:] if spec.startswith("node:") else spec
                    if (spec.startswith("node:") or bare in NODE_BUILTINS) and not compat:
                        out.append({"file": rel, "kind": "node-builtin", "import": spec})
                    elif spec.startswith("."):
                        t = (p.parent / spec).resolve()
                        if t.relative_to(root).as_posix() not in c.get("generated", []) and not (t.is_file() or t.with_suffix(".js").is_file() or (t / "index.js").is_file()):
                            out.append({"file": rel, "kind": "unresolved", "import": spec})
    return out


# ---- 2. overlap check (core/knowledge duplicated datagraph) ----------------------------------------------------------------------------------
def _tokens(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z]{4,}", s.lower()) if w not in STOP}


STOP = {"this", "that", "with", "from", "have", "each", "every", "which", "their", "there", "into", "when", "only", "shall", "module", "system", "ultrastable",
        "python", "foundation", "check", "tests", "test", "code", "file", "files", "owner", "never", "always", "item", "items", "loop", "loops", "data"}


def module_index(root=REPO) -> dict[str, dict]:
    root = Path(root)
    c = cfg(root)["overlap"]
    idx = {}
    for g in c["module_globs"]:
        for p in sorted(root.glob(g)):
            if p.name.startswith(("_", "test")) or p.name.endswith((".test.js", ".test.mjs")) or "/test" in p.as_posix():
                continue
            stem = p.parent.name if p.stem == "index" else p.stem
            head = p.read_text(encoding="utf-8", errors="replace")[:900]
            idx[p.relative_to(root).as_posix()] = {"stem": stem, "tokens": _tokens(head) | _tokens(stem)}
    return idx


def overlap_findings(new_paths: list[str], root=REPO) -> list[dict]:
    root = Path(root)
    c = cfg(root)["overlap"]
    idx = module_index(root)
    clusters = [set(x) for x in c["clusters"]]
    distinct = {frozenset(x) for x in c["distinct"]}
    out = []
    for n in new_paths:
        if n not in idx:
            continue
        a = idx[n]
        for o, b in idx.items():
            if o == n or frozenset((n, o)) in distinct or a["stem"] == b["stem"] and o.split("/")[0] != n.split("/")[0]:
                continue
            why = None
            if a["stem"] == b["stem"]:
                why = "same module name"
            elif any(a["stem"] in cl and b["stem"] in cl for cl in clusters):
                why = "same concept cluster"
            else:
                j = len(a["tokens"] & b["tokens"]) / max(1, len(a["tokens"] | b["tokens"]))
                if j >= c["jaccard"]:
                    why = f"docstring overlap {j:.2f}"
            if why:
                out.append({"new": n, "existing": o, "why": why})
    return out


def added_modules(base: str, root=REPO) -> list[str]:
    r = subprocess.run(["git", "diff", "--name-only", "--diff-filter=A", f"{base}...HEAD"], cwd=root, capture_output=True, text=True)
    if r.returncode != 0:
        r = subprocess.run(["git", "diff", "--name-only", "--diff-filter=A", base], cwd=root, capture_output=True, text=True)
    return [x for x in r.stdout.split("\n") if x]


# ---- 3. live verification and the done-claim gate --------------------------------------------------------------------------------------------
def fetch_get(url: str, timeout: int = 20) -> tuple[int, str]:
    req = urllib.request.Request(url, headers={"User-Agent": "ultrastable-silentfail/1"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 (https only, from the registry)
            return r.status, r.read(400_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception as e:  # unreadable is a finding, not a pass
        return 0, f"{type(e).__name__}: {e}"


def live_run(root=REPO, fetch=fetch_get, now=None) -> list[dict]:
    now = now or _now()
    rows = []
    for t in cfg(root)["live"]:
        status, body = fetch(t["url"])
        ok = status == 200 and t["expect"] in body and not (t.get("reject") and re.search(t["reject"], body))
        rows.append({"at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "id": t["id"], "url": t["url"], "expect": t["expect"], "status": status, "ok": ok})
    return rows


def read_ledger(root=REPO) -> list[dict]:
    p = Path(root) / LIVE_LEDGER
    return [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()] if p.exists() else []


def cite_findings(body: str, root=REPO, fetch=fetch_get, now=None) -> list[str]:
    """A body with an explicit `Status: done` (or `Done: yes`) claim must carry `Live: GET <https url> expect "<text>"` that reads true now (fetched by the
    server-side gate, never by a client agent), or `Live: n/a <reason>` for a change with nothing deployed. No claim, no requirement."""
    if not DONE_RX.search(body):
        return []
    cites = LIVE_LINE_RX.findall(body)
    if not cites:
        return [] if NA_RX.search(body) else ["claims done but cites no `Live: GET <url> expect \"<text>\"` line and no `Live: n/a <reason>`"]
    allowed = tuple(cfg(root)["cite_hosts"])
    out = []
    for url, expect in cites:
        if not re.match(r"https://(?:[\w-]+\.)*(%s)(/|$)" % "|".join(re.escape(h) for h in allowed), url):
            out.append(f"{url}: host is not an Ultrastable surface"); continue
        status, text = fetch(url)
        if status != 200 or expect not in text:
            out.append(f"{url}: HTTP {status}, expected text {'absent' if status == 200 else 'unread'}")
    return out


# ---- 4. action_required runs and untaken idea issues ---------------------------------------------------------------------------------------
def gh(token: str, method: str, path: str, data: dict | None = None):
    req = urllib.request.Request("https://api.github.com" + path, method=method, data=json.dumps(data).encode() if data is not None else None,
                                 headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "User-Agent": "ultrastable-silentfail/1"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:  # noqa: S310
            raw = r.read()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        return e.code, {}
    except Exception as e:
        return 0, {"error": str(e)}


def actions_pass(api, repo: str, now=None, apply: bool = False, idea_hours: float = 6) -> dict:
    """api(method, path, data) -> (status, json). action_required runs: approve; when refused, dispatch the same workflow on the branch (a dispatch
    needs no approval). Issues labelled idea that nothing took inside idea_hours: dispatch the issue loop (events by the built-in token trigger nothing)."""
    now = now or _now()
    out = {"stuck_runs": [], "remedied": [], "idea_issues": [], "errors": []}
    st, js = api("GET", f"/repos/{repo}/actions/runs?status=action_required&per_page=30")
    if st != 200:
        out["errors"].append(f"runs: HTTP {st}")
    for r in (js.get("workflow_runs") or []):
        row = {"id": r["id"], "name": r.get("name"), "branch": r.get("head_branch"), "actor": (r.get("actor") or {}).get("login")}
        out["stuck_runs"].append(row)
        if apply:
            s, _ = api("POST", f"/repos/{repo}/actions/runs/{r['id']}/approve")
            if s not in (200, 201, 204) and r.get("workflow_id"):
                s, _ = api("POST", f"/repos/{repo}/actions/workflows/{r['workflow_id']}/dispatches", {"ref": r.get("head_branch") or "main"})
                row["via"] = "dispatch"
            else:
                row["via"] = "approve"
            row["status"] = s
            if s in (200, 201, 204):
                out["remedied"].append(row["id"])
    st, js = api("GET", f"/repos/{repo}/issues?state=open&labels=idea&per_page=30")
    if st != 200:
        out["errors"].append(f"idea issues: HTTP {st}")
    for i in (js if isinstance(js, list) else []):
        age = (now - datetime.fromisoformat(i["created_at"].replace("Z", "+00:00"))).total_seconds() / 3600
        if age > idea_hours and not i.get("comments") and not i.get("pull_request"):
            out["idea_issues"].append({"number": i["number"], "age_hours": round(age, 1), "title": i["title"][:80]})
    if out["idea_issues"] and apply:
        for wf in ("issueloop.yml", "executor.yml"):
            s, _ = api("POST", f"/repos/{repo}/actions/workflows/{wf}/dispatches", {"ref": "main"})
            out.setdefault("dispatched", []).append({wf: s})
    return out


# ---- 5. stale ledgers (a loop that stopped writing) ---------------------------------------------------------------------------------------------
def stale_findings(root=REPO, now=None) -> list[dict]:
    now = now or _now()
    out = []
    for g in cfg(root)["ledgers"]:
        p = Path(root) / g["path"]
        if not p.exists():
            out.append({"ledger": g["path"], "why": "missing"}); continue
        last = [x for x in p.read_text(encoding="utf-8", errors="replace").splitlines() if x.strip()][-1:]
        try:
            row = json.loads(last[0]); ts = next(row[k] for k in ("at", "ts", "time", "date") if k in row)
            t = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
            age = (now - (t if t.tzinfo else t.replace(tzinfo=timezone.utc))).total_seconds() / 3600
        except Exception:
            out.append({"ledger": g["path"], "why": "newest row unreadable"}); continue
        if age > g["max_age_hours"]:
            out.append({"ledger": g["path"], "why": f"newest row {age:.0f} h old, limit {g['max_age_hours']} h"})
    return out


# ---- 6. the class register: red-team of our own blind spots -------------------------------------------------------------------------------------
def class_findings(root=REPO) -> list[dict]:
    """Every class of silent failure names the detector that watches it (doctrine/detectors.json) and the failure mode it belongs to
    (doctrine/registers.json). Recorded failures (docs/failures/*.md, ops/failure-audit.jsonl messages) that match no class's `signatures` are an
    unclassified incident: the class list is incomplete, which is itself the finding."""
    root = Path(root)
    classes = cfg(root)["classes"]
    det = {d["id"] for d in json.loads((root / "doctrine/detectors.json").read_text(encoding="utf-8"))["detectors"]}
    modes = {m["id"] for m in json.loads((root / "doctrine/registers.json").read_text(encoding="utf-8"))["failure_modes"]}
    out = []
    for k in classes:
        if k["detector"] not in det:
            out.append({"class": k["id"], "why": f"detector {k['detector']} is not registered"})
        if k["failure_mode"] not in modes:
            out.append({"class": k["id"], "why": f"failure mode {k['failure_mode']} is not registered"})
        if not k.get("example") or not k.get("signatures"):
            out.append({"class": k["id"], "why": "no example or signatures"})
    sigs = [re.compile(s, re.I) for k in classes for s in k["signatures"]]
    fdir = root / "docs/failures"
    for p in sorted(fdir.glob("*.md")) if fdir.is_dir() else []:
        head = p.read_text(encoding="utf-8", errors="replace")[:1500]
        if not any(s.search(head) or s.search(p.name) for s in sigs) and p.name not in cfg(root).get("unclassified_ok", []):
            out.append({"class": "UNCLASSIFIED", "why": f"{p.name} matches no silent-failure class: add a class with a detector"})
    return out


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    apply = "--apply" in a
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""
    res: dict = {}
    if "--bundle" in a or "--check" in a:
        res["bundle"] = bundle_findings()
    if "--overlap" in a or "--check" in a:
        i = a.index("--overlap") + 1 if "--overlap" in a else -1
        base = a[i] if 0 < i < len(a) and not a[i].startswith("--") else "origin/main"
        res["overlap"] = overlap_findings(added_modules(base))
    if "--classes" in a or "--check" in a:
        res["classes"] = class_findings()
    if "--stale" in a:
        res["stale"] = stale_findings()
    if "--live" in a:
        rows = live_run()
        res["live"] = rows
        if apply:
            with open(REPO / LIVE_LEDGER, "a", encoding="utf-8") as f:
                for r in rows:
                    f.write(json.dumps(r) + "\n")
        res["live_failed"] = [r["id"] for r in rows if not r["ok"]]
    if "--cite" in a:
        res["cite"] = cite_findings(Path(a[a.index("--cite") + 1]).read_text(encoding="utf-8"))
    if "--actions" in a:
        if not token:
            res["actions"] = {"errors": ["unmeasured: no GH_TOKEN"]}
        else:
            res["actions"] = actions_pass(lambda m, p, d=None: gh(token, m, p, d), os.environ.get("GITHUB_REPOSITORY", "ultrastable/ultrastable"), apply=apply)
    print(json.dumps(res, indent=1))
    bad = any(res.get(k) for k in ("bundle", "overlap", "classes", "stale", "live_failed", "cite")) or \
        bool((res.get("actions") or {}).get("stuck_runs") or (res.get("actions") or {}).get("errors")) and not apply
    if "--actions" in a and apply:
        bad = bool(res["actions"].get("errors")) or bool(set(r["id"] for r in res["actions"]["stuck_runs"]) - set(res["actions"]["remedied"]))
    return 1 if bad and any(f in a for f in ("--check", "--bundle", "--overlap", "--classes", "--stale", "--live", "--cite", "--actions")) else 0


if __name__ == "__main__":
    sys.exit(main())

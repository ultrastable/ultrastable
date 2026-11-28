# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""ISSUE-LOOP-1 (Rowan, 2026-11-17): every open GitHub issue is its own closed loop: probe, verify, close with evidence.

  python3 -m foundation issueloop [--apply] [--json]

For each repository in github/org-settings.json, each open issue is read for a probe line (`probe:`, `Closing probe:` or `Done check:`) in one of:
  file:PATH · grep:PATH::REGEX · cmd:ALLOW-LISTED-COMMAND (foundation/queue.py) · GET https://URL expect "TEXT"
A probe that passes closes the issue with the evidence as a comment (--apply; `gh` on the run's built-in token). A probe that fails keeps it open for the
executor. An issue with no probe, or a local probe on another repository's issue, is `unprobed`/`unmeasured`, never counted as passed, and exits 1 so
the gap is counted as a metric (issueloop metrics: ...) for the executor; the run exits non-zero only when the loop itself breaks. Consumers: .github/workflows/issueloop.yml, tests/foundation/test_issueloop.py, doctrine/consumers.json.
"""
from __future__ import annotations
import json, re, subprocess, sys, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
THIS = "ultrastable/ultrastable"
LINE = re.compile(r"^\W*(?:closing probe|done check|done when|probe)\W*:\W*(.+)$", re.I | re.M)
GET = re.compile(r"GET\s+(https://\S+?)\s+expect\s+[\"“']([^\"”']+)[\"”']", re.I)
# WORK-RECORD-1 records state their done check as `Done when: GET <url> [and <path>] answer <code>`; the loop reads that form too
STATUS = re.compile(r"GET\s+(https://\S+?)(?:\s+and\s+(/\S*?))?\s+answers?\s+(\d{3})\b", re.I)


def parse_probe(body: str):
    for m in LINE.finditer(body or ""):
        s = m.group(1).strip().strip("`").strip()
        g = GET.search(s)
        if g:
            return ("get", g.group(1), g.group(2))
        st = STATUS.search(s)
        if st:
            from urllib.parse import urljoin
            urls = [st.group(1)] + ([urljoin(st.group(1), st.group(2))] if st.group(2) else [])
            return ("status", urls, int(st.group(3)))
        if re.match(r"(file|grep|cmd):", s):
            return ("local", s, None)
    return None


def _fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"user-agent": "ultrastable-issueloop/1"}), timeout=20) as r:
        return r.read().decode("utf-8", "replace")


def _status(url):
    """HTTP status of a GET; an HTTP error answers with its code, an unreachable host raises."""
    import urllib.error
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"user-agent": "ultrastable-issueloop/1"}), timeout=20) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def evaluate(repo: str, issue: dict, root=REPO, fetch=_fetch, status=_status):
    """-> (verdict, evidence). verdict: pass | fail | unprobed | unmeasured"""
    pr = parse_probe(issue.get("body") or "")
    if not pr:
        return "unprobed", "no probe line in the body"
    kind, a, b = pr
    if kind == "status":
        try:
            got = {u: status(u) for u in a}
        except Exception as e:  # unreachable is unmeasured, never passed
            return "unmeasured", f"GET {a}: {e}"
        return ("pass" if all(c == b for c in got.values()) else "fail"), "; ".join(f"GET {u} answered {c} (want {b})" for u, c in got.items())
    if kind == "get":
        try:
            return ("pass" if b in fetch(a) else "fail"), f"GET {a} expect {b!r}"
        except Exception as e:  # unreachable is unmeasured, never passed
            return "unmeasured", f"GET {a}: {e}"
    if repo != THIS:
        return "unmeasured", f"local probe {a!r} belongs to another repository's checkout"
    from . import queue
    ok, ev = queue.probe(root, a)
    return ("pass" if ok else "fail"), ev or a


def probeable(issue: dict) -> bool:
    """GH-MIRROR-1: an issue carrying the sync label `queue` mirrors a docs/issues file; the queue loop closes the file and the mirror follows, so it is not probed
    here. A work record (label `work`, WORK-RECORD-1) has no such file: `worklog reap` adds `queue` to it, which used to leave it in no loop at all (not probed
    here, not aged by scripts/sla.sh), so records sat for days. It is probed like any other issue."""
    names = {l.get("name") for l in issue.get("labels") or []}
    return "pull_request" not in issue and ("queue" not in names or "work" in names)


def gh_issues(repo):
    a = subprocess.run(["gh", "api", f"repos/{repo}", "--jq", ".archived"], capture_output=True, text=True, timeout=60)
    if a.returncode == 0 and a.stdout.strip() == "true":
        return []  # an archived repository is read-only: its issues moved to the queue (Q-WORKERS-*), nothing here can close them
    p = subprocess.run(["gh", "api", "--paginate", f"repos/{repo}/issues?state=open&per_page=100"], capture_output=True, text=True, timeout=120)
    if p.returncode:
        return None
    out = []
    for chunk in p.stdout.replace("][", "]\n[").splitlines():
        if chunk.strip():
            out += json.loads(chunk)
    return [i for i in out if probeable(i)]


def close(repo, number, evidence):
    r = subprocess.run(["gh", "issue", "close", str(number), "--repo", repo, "--reason", "completed", "--comment",
                        f"ISSUE-LOOP-1: closing probe passed. Evidence: {evidence}\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_"],
                       capture_output=True, text=True, timeout=60)
    return r.returncode == 0


def repos(root=REPO):
    from . import drainwatch
    extra = json.loads((Path(root) / "doctrine/ciwatch.json").read_text(encoding="utf-8")).get("repos", [])
    return sorted(set(drainwatch.repos(root)) | set(extra))


def run(root=REPO, apply=False, issues=gh_issues, fetch=_fetch, closer=close):
    from . import drainwatch
    rows, unread = [], []
    for repo in repos(root):
        got = issues(repo)
        if got is None:
            unread.append(repo); continue
        for i in got:
            v, ev = evaluate(repo, i, root, fetch)
            done = v == "pass" and apply and closer(repo, i["number"], ev)
            rows.append({"repo": repo, "number": i["number"], "title": i.get("title", ""), "verdict": v, "evidence": ev, "closed": bool(done)})
    return {"rows": rows, "unreadable": unread}


def file_items(root, res):
    """--file: every unprobed or failing issue becomes a queue item (docs/issues/Q-ISSUE-*.json) the executor takes in driver order;
    its probe passes once the issue is closed, so the item and the issue close together. Idempotent."""
    out = []
    for r in res["rows"]:
        if r["verdict"] not in ("unprobed", "fail"):
            continue
        i = "Q-ISSUE-" + re.sub(r"[^A-Za-z0-9]+", "-", f"{r['repo'].split('/')[1]}-{r['number']}")
        p = Path(root) / "docs/issues" / f"{i}.json"
        if p.exists():
            continue
        p.parent.mkdir(parents=True, exist_ok=True)
        probe = f"cmd:python3 -m foundation issueloop --closed {r['repo']}#{r['number']}"
        body = (f"**Owner:** executor\n**Trigger:** issueloop, daily\n**Done check:** {probe}\n**Status:** open\n\n"
                f"ISSUE-LOOP-1: {r['repo']}#{r['number']} ({r['title']}) is {r['verdict']}: {r['evidence']}. Fix it in code and close it, or add a "
                "`Closing probe:` line the loop can run (file, grep, allow-listed cmd, or GET url expect \"text\").\n\nsize: S\n")
        p.write_text(json.dumps({"id": i, "title": f"{i}: {r['title']}"[:200], "body": body, "labels": ["p2", "agent-ready"], "milestone": "Now", "workstream": "Issues"}, indent=2) + "\n", encoding="utf-8")
        out.append(i)
    return out


def is_closed(ref):
    """--closed OWNER/REPO#N: exit 0 only when the issue is closed (the queue item's closing probe; REST, no GraphQL)."""
    repo, _, n = ref.partition("#")
    r = subprocess.run(["gh", "api", f"repos/{repo}/issues/{n}", "--jq", ".state"], capture_output=True, text=True, timeout=60)
    return r.returncode == 0 and r.stdout.strip() == "closed"


def main(argv):
    if argv[:1] == ["--closed"]:
        ok = is_closed(argv[1]); print("closed" if ok else "open or unreadable"); return 0 if ok else 1
    res = run(apply="--apply" in argv)
    if "--file" in argv:
        print("filed: " + ", ".join(file_items(REPO, res) or ["none"]))
    if "--json" in argv:
        print(json.dumps(res, indent=1))
    else:
        for r in res["rows"]:
            print(f"{r['repo']}#{r['number']} {r['verdict']}{' closed' if r['closed'] else ''}: {r['evidence']}")
        for r in res["unreadable"]:
            print(f"{r}: unmeasured (read failed)")
    m = metrics(res)
    print("issueloop metrics: " + json.dumps(m))
    import os
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as f:
            f.write("issueloop " + json.dumps(m) + "\n")
    # Open, unprobed or unreadable items are counts the executor works down, not a broken loop: the run is red only when the loop itself raises.
    return 0


def metrics(res):
    c = {"open": len(res["rows"]), "closed": 0, "pass": 0, "fail": 0, "unprobed": 0, "unmeasured": 0, "unreadable_repos": len(res["unreadable"])}
    for r in res["rows"]:
        c[r["verdict"]] += 1
        c["closed"] += r["closed"]
    return c

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

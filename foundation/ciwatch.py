# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""CIWATCH-1: the system watches its own red X's and remediates them. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation ciwatch --run [--apply]      scan every repo in doctrine/ciwatch.json; rerun transient failures once; file one queue item per other failure
  python3 -m foundation ciwatch --probe REPO WORKFLOW exit 0 when the latest completed default-branch run of that workflow is not failing (the item's closing probe)
  python3 -m foundation ciwatch --check               registry and workflow are intact

Detect: the newest completed default-branch run of each workflow. Remediate: a failure whose log matches a transient pattern is rerun once (failed jobs only);
anything else becomes docs/issues/Q-CIFAIL-<repo>-<workflow>.json with the log tail, an owner, a trigger and the probe above, which the executor
(the code agent, foundation/executor.py) takes in driver order and the queue closes when the run is green. Every run appends to ops/ciwatch.jsonl,
passes included. The `gh` runner is injected so every branch is tested without the network.
"""
from __future__ import annotations
import datetime as dt, json, re, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CFG, LEDGER = "doctrine/ciwatch.json", "ops/ciwatch.jsonl"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / CFG).read_text(encoding="utf-8"))


def gh(*args) -> tuple[int, str]:
    r = subprocess.run(["gh", *args], capture_output=True, text=True, encoding="utf-8", timeout=120)
    return r.returncode, (r.stdout if r.returncode == 0 else r.stdout + r.stderr)


INCONCLUSIVE = {"cancelled", "skipped", "stale"}  # PROBE-CONCLUSIVE-1: says nothing about the workflow's health


def latest(repo: str, run=gh) -> list[dict]:
    """Newest conclusive run per workflow on the default branch (error text if unreadable: unmeasured, never green). PROBE-CONCLUSIVE-1: a cancelled
    or skipped run is passed over. Measured 2026-11-19: pending executor jobs cancelled by a newer one in their concurrency group made the newest
    completed run `cancelled`, so the probe of Q-CIFAIL-ultrastable-executor passed while every run that worked an item failed."""
    code, o = run("api", f"repos/{repo}", "--jq", ".default_branch")
    if code:
        raise RuntimeError(f"{repo}: unreadable ({o.strip()[:120]})")
    code, o = run("api", f"repos/{repo}/actions/runs?branch={o.strip()}&status=completed&per_page=60", "--jq", "[.workflow_runs[]|{id,name,conclusion,created_at,html_url,head_sha}]")
    if code:
        raise RuntimeError(f"{repo}: runs unreadable ({o.strip()[:120]})")
    seen, out = set(), []
    for r in json.loads(o or "[]"):
        if r["name"] not in seen and r.get("conclusion") not in INCONCLUSIVE:
            seen.add(r["name"]); out.append(r)
    return out


def watched(root=REPO, cfg=None) -> list[str]:
    """The typed `repos` plus every registered tenant repository (doctrine/tenant-repos.json), so a new tenant is watched the day it is registered.
    Measured 2026-11-28: base-rates and five other tenants were absent from the typed list, so nothing watched them."""
    cfg, out = cfg or load(root), []
    p = Path(root) / "doctrine/tenant-repos.json"
    tenants = json.loads(p.read_text(encoding="utf-8")).get("tenants", {}) if p.is_file() else {}
    for r in list(cfg["repos"]) + [t["repo"] for t in tenants.values() if t.get("repo") and t.get("state") != "retired"]:
        if r not in out:
            out.append(r)
    return out


def slug(repo: str, wf: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", f"{repo.split('/')[-1]}-{wf}".lower()).strip("-")


def is_transient(log: str, cfg: dict) -> bool:
    return any(re.search(p, log, re.I) for p in cfg["transient"])


def item(repo: str, run: dict, tail: str) -> dict:
    s = slug(repo, run["name"])
    body = (f"**Owner:** staff\n**Trigger:** every executor run and every ciwatch run\n**Done check:** cmd:python3 -m foundation ciwatch --probe {repo} {run['name']}\n**Status:** open\n\n"
            f"CIWATCH-1: workflow `{run['name']}` in {repo} is red on its default branch ({run['conclusion']}, {run['created_at']}): {run['html_url']}\n\n"
            f"Fix the root cause in the repository where the defect lives; do not skip or weaken the check. Failed log tail:\n\n```\n{tail[-1800:]}\n```")
    return {"id": f"Q-CIFAIL-{s}", "title": f"Q-CIFAIL-{s}: {run['name']} is failing in {repo}", "body": body, "labels": ["role:staff", "ci-failure"], "milestone": "Now", "workstream": "Reliability"}


def scan(root=REPO, apply=False, run=gh, now=None) -> list[dict]:
    root, cfg, rows, filed = Path(root), load(root), [], 0
    at = (now or dt.datetime.now(dt.timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
    for repo in watched(root, cfg):
        try:
            runs = latest(repo, run)
        except RuntimeError as e:  # an unreadable repo is unmeasured, which is a finding, not a pass
            rows.append({"at": at, "repo": repo, "result": "unmeasured", "detail": str(e)}); continue
        for r in runs:
            row = {"at": at, "repo": repo, "workflow": r["name"], "run": r["id"], "conclusion": r["conclusion"]}
            if r["conclusion"] not in cfg["failing"]:
                row["result"] = "green" if r["conclusion"] == "success" else "neutral"; rows.append(row); continue
            _, tail = run("run", "view", str(r["id"]), "-R", repo, "--log-failed")
            tail = "\n".join(tail.splitlines()[-40:])
            if is_transient(tail, cfg) and apply:
                code, o = run("run", "rerun", str(r["id"]), "-R", repo, "--failed")
                row.update(result="rerun" if code == 0 else "rerun-failed", detail=o.strip()[:200])
            elif filed < cfg["max_items_per_run"]:
                it = item(repo, r, tail); p = root / "docs/issues" / f"{it['id']}.json"
                if apply and not p.exists():
                    p.write_text(json.dumps(it, indent=2) + "\n", encoding="utf-8")
                row.update(result="filed", item=it["id"], existed=p.exists()); filed += 1
            else:
                row.update(result="deferred", detail="max_items_per_run reached; next run takes it")
            rows.append(row)
    if apply:
        p = root / LEDGER; p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("a", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, separators=(",", ":")) + "\n")
    return rows


def aged_item(repo: str, old: list[dict], days: int) -> dict:
    s = slug(repo, "aged-queue")
    lines = "\n".join(f"- #{i['number']} {i['title']} (open since {i['created_at']}, {i['comments']} comment(s))" for i in old)
    body = (f"**Owner:** staff\n**Trigger:** every ciwatch run\n**Done check:** cmd:python3 -m foundation ciwatch --probe-aged {repo}\n**Status:** open\n\n"
            f"CIWATCH-1: {len(old)} queue issue(s) in {repo} have been open more than {days} days, so the loop that owns them is not closing them (a silent drop).\n{lines}\n\n"
            "Read the loop's last comments on them and its latest run, find the root cause in the loop's code (a retry that repeats its input, a cap that never closes, a gate that can never pass), "
            "fix it where the defect lives, and close the issue with a disposition. Do not close an issue by hand to clear this item.")
    return {"id": f"Q-AGED-{s}", "title": f"Q-AGED-{s}: queue issues are idling open in {repo}", "body": body, "labels": ["role:staff", "aged-queue"], "milestone": "Now", "workstream": "Reliability"}


def aged_issues(repo: str, cfg: dict, run=gh, now=None) -> list[dict]:
    """Open `queue_label` issues older than `max_open_days`; raises RuntimeError if unreadable (unmeasured, never clean)."""
    code, o = run("api", f"repos/{repo}/issues?state=open&labels={cfg['queue_label']}&per_page=100", "--jq", "[.[]|select(has(\"pull_request\")|not)|{number,title,created_at,comments}]")
    if code:
        raise RuntimeError(f"{repo}: issues unreadable ({o.strip()[:120]})")
    cut = (now or dt.datetime.now(dt.timezone.utc)) - dt.timedelta(days=cfg["max_open_days"])
    return [i for i in json.loads(o or "[]") if dt.datetime.strptime(i["created_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc) < cut]


def aged(root=REPO, apply=False, run=gh, now=None) -> list[dict]:
    """The second detector: a queue that idles open is a failure no red run shows. One item per repository with the issues listed."""
    root, cfg, rows = Path(root), load(root), []
    at = (now or dt.datetime.now(dt.timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
    for repo in watched(root, cfg):
        try:
            old = aged_issues(repo, cfg, run, now)
        except RuntimeError as e:
            rows.append({"at": at, "repo": repo, "check": "aged-queue", "result": "unmeasured", "detail": str(e)}); continue
        if not old:
            rows.append({"at": at, "repo": repo, "check": "aged-queue", "result": "clean"}); continue
        it = aged_item(repo, old, cfg["max_open_days"]); p = root / "docs/issues" / f"{it['id']}.json"
        if apply and not p.exists():
            p.parent.mkdir(parents=True, exist_ok=True); p.write_text(json.dumps(it, indent=2) + "\n", encoding="utf-8")
        rows.append({"at": at, "repo": repo, "check": "aged-queue", "result": "filed", "item": it["id"], "issues": [i["number"] for i in old]})
    if apply:
        p = root / LEDGER; p.parent.mkdir(parents=True, exist_ok=True)
        with p.open("a", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, separators=(",", ":")) + "\n")
    return rows


def probe_aged(repo: str, root=REPO, run=gh) -> int:
    try:
        return 1 if aged_issues(repo, load(root), run) else 0
    except RuntimeError:
        return 1


def probe(repo: str, wf: str, root=REPO, run=gh) -> int:
    for r in latest(repo, run):
        if r["name"] == wf:
            return 0 if r["conclusion"] not in load(root)["failing"] else 1
    return 0  # the workflow no longer has a completed run on the default branch (removed or renamed): nothing is red


def check(root=REPO) -> list[str]:
    root, bad = Path(root), []
    cfg = load(root)
    if not cfg["repos"]:
        bad.append("no repositories watched")
    if not (root / ".github/workflows/ciwatch.yml").is_file():
        bad.append("workflow ciwatch.yml is missing")
    return bad


def main(argv=None) -> int:
    a = argv if argv is not None else sys.argv[1:]
    if "--probe-aged" in a:
        return probe_aged(a[a.index("--probe-aged") + 1])
    if "--probe" in a:
        i = a.index("--probe"); return probe(a[i + 1], " ".join(a[i + 2:]))
    if "--run" in a:
        rows = scan(apply="--apply" in a) + aged(apply="--apply" in a)
        for r in rows:
            print(json.dumps(r))
        red = [r for r in rows if r.get("result") in ("filed", "rerun", "rerun-failed", "deferred", "unmeasured")]
        print(f"ciwatch: {len(rows)} workflows scanned, {len(red)} not green")
        return 0  # the loop's job is to file and rerun, not to fail the watcher
    bad = check()
    print("ciwatch ok" if not bad else "\n".join(bad)); return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""AGENT-WORK-1: feeds and fences the Actions-hosted code agent (the executor). Ultrastable is the foundation for any autonomous system.

  python3 -m foundation agentwork [--apply]   gate (caps, kill switch) then file work from every source; writes agent_go=true|false to $GITHUB_OUTPUT
  python3 -m foundation agentwork --probe-kill   prove the kill switch stops the agent (exit 0 when a set switch yields go=false)
  python3 -m foundation agentwork --unk-resolved ID   closing probe of a Q-UNK item: the fact is told, or no longer known
  python3 -m foundation agentwork --check

Sources the agent works from, all as docs/issues items the executor takes in driver order: the existing queue and plus items, Q-CIFAIL items from
foundation/ciwatch.py (failing workflows), and Q-UNK items filed here from foundation/ignorance.py (facts the system holds that nobody has been told).
Models: GitHub Models over the built-in token first (free), then Workers AI, then a bound provider key (doctrine/code-agents.json). Every run, gated or not, appends one row to ops/agentwork.jsonl.
"""
from __future__ import annotations
import datetime as dt, json, os, re, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CFG = "doctrine/agent-budget.json"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / CFG).read_text(encoding="utf-8"))


def _gh(*a) -> tuple[int, str]:
    r = subprocess.run(["gh", *a], capture_output=True, text=True, encoding="utf-8", timeout=60)
    return r.returncode, r.stdout + (r.stderr if r.returncode else "")


def spent_today(root, now) -> float:
    p, tot, day = Path(root) / "ops/agent-cost.jsonl", 0.0, now.strftime("%Y-%m-%d")
    if p.is_file():
        for line in p.read_text(encoding="utf-8").splitlines():
            try:
                j = json.loads(line)
            except ValueError:
                continue
            if str(j.get("at", "")).startswith(day):
                tot += float(j.get("usd") or 0)
    return tot


def runs_today(root, now) -> int:
    p, day = Path(root) / load(root)["log"], now.strftime("%Y-%m-%d")
    return sum(1 for l in p.read_text(encoding="utf-8").splitlines() if f'"at":"{day}' in l and '"go":true' in l) if p.is_file() else 0


def gate(root=REPO, env=None, gh=_gh, now=None, repo=None) -> dict:
    """{go, why}. Kill switches win over caps; an unreadable cap input is a no-go (fail closed)."""
    root, env, now, cfg = Path(root), os.environ if env is None else env, now or dt.datetime.now(dt.timezone.utc), load(root)
    if env.get("AGENT_KILL") == "1" or env.get("HALT") == "1":
        return {"go": False, "why": "kill switch: repository variable AGENT_KILL or HALT is 1"}
    h = root / "ops/halt.json"
    if (root / "ops/agent-kill").exists() or (h.is_file() and json.loads(h.read_text(encoding="utf-8")).get("halted") is True):
        return {"go": False, "why": "kill switch: ops/agent-kill is committed or ops/halt.json says halted"}
    if spent_today(root, now) >= cfg["max_usd_per_day"]:
        return {"go": False, "why": f"cap: spend today reached ${cfg['max_usd_per_day']}"}
    if runs_today(root, now) >= cfg["max_runs_per_day"]:
        return {"go": False, "why": f"cap: {cfg['max_runs_per_day']} runs today"}
    repo = repo or env.get("GITHUB_REPOSITORY")
    if repo:
        code, o = gh("pr", "list", "-R", repo, "--state", "open", "--json", "headRefName", "--jq", '[.[]|select(.headRefName|startswith("agent/"))]|length')
        if code:
            return {"go": False, "why": "cap input unreadable (open agent PRs): " + o.strip()[:100]}
        if int(o.strip() or 0) >= cfg["max_open_agent_prs"]:
            return {"go": False, "why": f"cap: {cfg['max_open_agent_prs']} agent PRs already open; the lane merges them first"}
    return {"go": True, "why": "within caps"}


def file_unknowns(root=REPO, apply=False, limit=None) -> list[str]:
    from . import ignorance
    root, out = Path(root), []
    limit = load(root)["max_unknown_items_per_run"] if limit is None else limit
    for f in ignorance.unknown(root):
        if len(out) >= limit:
            break
        if f["id"].startswith("OL-"):
            continue  # already queue items
        i = "Q-UNK-" + re.sub(r"[^a-z0-9]+", "-", f["id"].lower()).strip("-")
        p = root / "docs/issues" / f"{i}.json"
        if p.exists():
            continue
        body = (f"**Owner:** staff\n**Trigger:** every executor run\n**Done check:** cmd:python3 -m foundation agentwork --unk-resolved {f['id']}\n**Status:** open\n\n"
                f"AGENT-WORK-1: the system holds a fact nobody has been told (ignorance audit): {f['statement']}\n\nChange the code or data so that the fact is resolved by a measured change (or add the missing consumer/probe), and record it with `python3 -m foundation ignorance --told {f['id']}` in the same change.")
        if apply:
            p.write_text(json.dumps({"id": i, "title": f"{i}: {f['statement'][:90]}", "body": body, "labels": ["role:staff", "ignorance"], "milestone": "Next", "workstream": "Ignorance"}, indent=2) + "\n", encoding="utf-8")
        out.append(i)
    return out


def unk_resolved(fid: str, root=REPO) -> int:
    from . import ignorance
    return 0 if fid not in {f["id"] for f in ignorance.unknown(root)} else 1


def log(root, row: dict, now=None) -> None:
    p = Path(root) / load(root)["log"]; p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"at": (now or dt.datetime.now(dt.timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ"), **row}, separators=(",", ":")) + "\n")


def run(root=REPO, apply=False, env=None, gh=_gh) -> dict:
    g = gate(root, env, gh)
    row = {"go": g["go"], "why": g["why"], "filed": file_unknowns(root, apply) if g["go"] else []}
    if apply:
        log(root, row)
        out = os.environ.get("GITHUB_OUTPUT")
        if out:
            with open(out, "a", encoding="utf-8") as f:
                f.write(f"agent_go={'true' if g['go'] else 'false'}\n")
    return row


def check(root=REPO) -> list[str]:
    cfg, bad = load(root), []
    for k in ("max_open_agent_prs", "max_runs_per_day", "max_usd_per_day"):
        if not isinstance(cfg.get(k), (int, float)) or cfg[k] <= 0:
            bad.append(f"{k} must be a positive number")
    ex = (Path(root) / ".github/workflows/executor.yml").read_text(encoding="utf-8")
    if "agentwork" not in ex or "agent_go" not in ex:
        bad.append("executor.yml does not run the agentwork gate")
    return bad


def main(argv=None) -> int:
    a = argv if argv is not None else sys.argv[1:]
    if "--probe-kill" in a:
        r = gate(REPO, {"AGENT_KILL": "1"}, lambda *x: (0, "0")); print(json.dumps(r)); return 0 if not r["go"] else 1
    if "--unk-resolved" in a:
        return unk_resolved(a[a.index("--unk-resolved") + 1])
    if "--check" in a:
        bad = check(); print("agentwork ok" if not bad else "\n".join(bad)); return 1 if bad else 0
    print(json.dumps(run(apply="--apply" in a)))
    return 0


if __name__ == "__main__":
    sys.exit(main())

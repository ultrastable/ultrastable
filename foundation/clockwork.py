"""CLOCKWORK-2: per-stage freshness, catch-up ticks, settlement by name and escalation, on top of the clocks in foundation/clock.py (owner directive 2026-11-12).

  python3 -m foundation clock --stages          freshness of every pipeline stage against its own SLA
  python3 -m foundation clock --settlement      every executor change settled under the name of its work item
  python3 -m foundation clock --heal [--apply]  catch-up ticks, settlement of expired changes and escalation, bounded per day

Stages (doctrine/clocks.json `stages`): heartbeat -> author -> pr -> merge -> deploy -> publish, each with its own SLA; a stage is fresh, stale (past one SLA), expired
(past three), missing, or idle when there is no work for it. Catch-up: a stale stage wakes its own workflow now, at most `max_per_stage_per_day` times a day, so a
missed beat is made up instead of waiting for the next cron. Settlement: every executor change ends under the name of its work item (merged, closed, parked, failed or
expired); an open change past the window is closed as expired and its item returns to the queue under the same name, so nothing lingers unsettled. Escalation is a
stateless ladder keyed on how many SLAs were missed: catch-up, then mutate the approach (run the next takeable item), then file a p0 repair item (foundation/pm.py).
"""
from __future__ import annotations
import json, re, subprocess
from datetime import datetime, timezone

from . import clock as C

REPO, GH = C.REPO, C.GH


def _gh_json(*args):
    try:
        r = subprocess.run(["gh", *args], capture_output=True, text=True, timeout=90, encoding="utf-8")
        return json.loads(r.stdout or "[]")
    except (OSError, subprocess.SubprocessError, ValueError):
        return []


def executor_prs() -> list[dict]:
    """Every pull request the unattended executor opened."""
    rows = _gh_json("pr", "list", "--repo", GH, "--state", "all", "--limit", "100", "--json", "number,title,state,createdAt,mergedAt,closedAt,body,headRefName,url,isDraft")
    return [r for r in rows if "Executor run" in (r.get("body") or "")]


def item_name(pr: dict) -> str:
    """A change settles under the name of the work item it carries: the (#NAME) at the end of its title, else the branch."""
    m = re.search(r"\(#([A-Za-z0-9-]+)\)\s*$", pr.get("title", "")) or re.match(r"agent/([A-Za-z0-9]+(?:-[A-Z0-9]+)*)-[a-z]", pr.get("headRefName", ""))
    return m[1] if m else "unnamed-" + str(pr.get("number"))


def stage_state(c: dict, last: float | None, now: float, work: bool) -> dict:
    age = None if last is None else round(now - last, 1)
    sla = c["sla_s"]
    if c.get("needs_work") and not work:
        st = "idle"
    elif age is None:
        st = "missing"
    else:
        st = "fresh" if age <= sla else "stale" if age <= 3 * sla else "expired"
    missed = int(age // sla) if age is not None and st in ("stale", "expired") else (1 if st == "missing" else 0)
    return {"id": c["id"], "what": c["what"], "sla_s": sla, "age_s": age, "status": st, "missed": missed}


def stages(root=REPO, now: float | None = None, env=None, prs=None) -> list[dict]:
    """Freshness of every stage, each against its own SLA."""
    now, cfg = now or datetime.now(timezone.utc).timestamp(), C.load(root)
    work = C.takeable_count(root) != 0
    prs = executor_prs() if prs is None else prs
    clocks = {c["id"]: c for c in C.report(root, now, env)}
    out = []
    for c in cfg["stages"]:
        last = None
        if c["source"] == "clock":
            cl = clocks.get(c["clock"], {})
            if cl.get("status") == "unmeasured":   # an unreadable clock is a finding of its own, never a reason to escalate the stage
                out.append({"id": c["id"], "what": c["what"], "sla_s": c["sla_s"], "age_s": None, "status": "unmeasured", "missed": 0, "why": cl.get("why")})
                continue
            last = None if cl.get("last_beat_age_s") is None else now - cl["last_beat_age_s"]
        elif c["source"] == "workflow":
            b = C.gh_run_beats(c["workflow"], root)
            last = max(b) if b else None
        elif c["source"] == "workflow_success":
            rows = _gh_json("run", "list", "--repo", GH, "--workflow", c["workflow"], "--limit", "30", "--json", "createdAt,conclusion")
            ok = [C._ts(r["createdAt"]) for r in rows if r.get("conclusion") == "success"]
            last = max(ok) if ok else None
        elif c["source"] == "pr_opened":
            last = max([C._ts(p["createdAt"]) for p in prs], default=None)
        elif c["source"] == "pr_merged":
            last = max([C._ts(p["mergedAt"]) for p in prs if p.get("mergedAt")], default=None)
        elif c["source"] == "merge_to_deploy":
            r = subprocess.run(["git", "-C", str(root), "log", "-1", "--format=%ct", "--", *c["paths"]], capture_output=True, text=True, encoding="utf-8")
            changed = float(r.stdout.strip() or 0)
            rows = _gh_json("run", "list", "--repo", GH, "--workflow", c["workflow"], "--limit", "20", "--json", "conclusion,updatedAt")
            ok = [C._ts(x["updatedAt"]) for x in rows if x.get("conclusion") == "success"]
            deployed = max(ok) if ok else None
            if deployed is not None and deployed >= changed:
                out.append({"id": c["id"], "what": c["what"], "sla_s": c["sla_s"], "age_s": round(now - deployed, 1), "status": "fresh", "missed": 0, "lag_s": round(deployed - changed, 1)})
            else:
                out.append(stage_state({**c, "needs_work": False}, changed or None, now, True))
            continue
        out.append(stage_state(c, last, now, work))
    return out


def settlement(root=REPO, now: float | None = None, prs=None) -> dict:
    """Every executor change settles under the name of its work item. An open change past the window is unsettled."""
    cfg, now = C.load(root)["settlement"], now or datetime.now(timezone.utc).timestamp()
    prs = executor_prs() if prs is None else prs
    by: dict[str, dict] = {}
    for p in sorted(prs, key=lambda x: x["createdAt"]):
        n = item_name(p)
        age_h = (now - C._ts(p["createdAt"])) / 3600
        st = "merged" if p.get("mergedAt") else "closed" if p["state"] == "CLOSED" else ("expired" if age_h > cfg["sla_hours"] else "open")
        by[n] = {"name": n, "state": st, "pr": p["number"], "age_h": round(age_h, 1), "url": p.get("url")}
    try:
        from . import queue as qmod
        fails: dict[str, int] = {}
        for r in qmod.executor_rows(root):
            if r.get("issue") is not None:
                k = str(r["issue"])
                fails[k] = fails.get(k, 0) + 1 if r.get("result") == "failed" else 0
        takeable = {str(i["number"]) for i in qmod.takeable(root)}
        for n, f in fails.items():
            if f and n not in by:
                by[n] = {"name": n, "state": "failed" if n in takeable else "parked", "failures": f}
    except Exception:  # a broken queue must not hide the ledger
        pass
    unsettled = [v for v in by.values() if v["state"] in ("open", "expired")]
    return {"names": by, "counts": {k: sum(1 for v in by.values() if v["state"] == k) for k in cfg["names"] + ["open"]}, "unsettled": unsettled}


def escalation_plan(findings: list[dict], ladder: list[dict]) -> list[dict]:
    """The stateless ladder: the number of missed SLAs picks the action, so repeated passes converge instead of repeating a step that did not help."""
    plan = []
    for f in findings:
        level = None
        for step in sorted(ladder, key=lambda x: x["missed"]):
            if f["missed"] >= step["missed"]:
                level = step
        if level:
            plan.append({"id": f["id"], "missed": f["missed"], "action": level["action"]})
    return plan


def _dispatched_today(workflow: str, now: float) -> int:
    rows = _gh_json("run", "list", "--repo", GH, "--workflow", workflow, "--limit", "40", "--json", "createdAt,event")
    return sum(1 for r in rows if r["event"] == "workflow_dispatch" and C._ts(r["createdAt"]) >= now - 86400)


def heal(root=REPO, apply=False, now: float | None = None, st=None, sett=None) -> dict:
    """Catch-up ticks, settlement and escalation in one idempotent, bounded pass."""
    cfg, now = C.load(root), now or datetime.now(timezone.utc).timestamp()
    st = stages(root, now) if st is None else st
    sett = settlement(root, now) if sett is None else sett
    findings = [s for s in st if s["status"] in ("stale", "expired", "missing")]
    plan = escalation_plan([{"id": s["id"], "missed": max(1, s["missed"])} for s in findings], cfg["escalation"])
    acts = []
    for p in plan:
        act = {**p, "done": False}
        wf = cfg["catchup"]["dispatch"].get(p["id"])
        if p["action"] in ("catch-up", "mutate") and wf and apply:
            cap = cfg["catchup"]["max_per_stage_per_day"] + (1 if p["action"] == "mutate" else 0)
            if _dispatched_today(wf[:-4], now) >= cap:
                act["why"] = "per-day catch-up cap reached"
            else:
                args = ["gh", "workflow", "run", wf, "--repo", GH]
                if p["action"] == "mutate":
                    try:
                        from . import queue as qmod
                        t = qmod.takeable(root)
                        if len(t) > 1:
                            args += ["-f", "issue=" + str(t[1]["number"])]
                    except Exception as e:  # recorded
                        act["why"] = "could not pick the next item: " + str(e)[:80]
                r = subprocess.run(args, capture_output=True, text=True, timeout=60, encoding="utf-8")
                act["done"] = r.returncode == 0
                if r.returncode:
                    act["why"] = (r.stderr or r.stdout)[-120:]
        elif p["action"] == "incident":
            act["why"] = "filed as a p0 repair item by the product manager run (foundation pm)"
        acts.append(act)
    closed = []
    if apply:
        for u in sett["unsettled"]:
            if u["state"] == "expired" and u.get("pr"):
                r = subprocess.run(["gh", "pr", "close", str(u["pr"]), "--repo", GH, "--comment", cfg["settlement"]["close_comment"]], capture_output=True, text=True, timeout=60, encoding="utf-8")
                closed.append({"name": u["name"], "pr": u["pr"], "closed": r.returncode == 0})
    return {"findings": [{"id": s["id"], "status": s["status"], "missed": s["missed"]} for s in findings], "actions": acts, "settled_expired": closed, "unsettled": len(sett["unsettled"])}

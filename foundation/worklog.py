# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""WORK-RECORD-1: one canonical, server-side record of every piece of work. Ultrastable is the foundation for any autonomous system.

A chat thread or code-agent session can vanish at any time. Every request from the owner, and every task a session or loop starts, is a
GitHub issue in ultrastable/ultrastable with the label `work`. The issue body carries one JSON record between markers, so code reads it:
goal, owner, state, done (a done check), prs, next (the next step), heartbeat (UTC). Issues are the store because they are server-side,
reviewable, survive any session, and the lane, executor and planner (/api/plans) already read GitHub.

  python3 -m foundation worklog start --goal G --owner O --done D [--next N] [--pr URL] [--ref ID]   open a record; prints its number
  python3 -m foundation worklog beat N [--next N] [--pr URL] [--state S]                             heartbeat / progress
  python3 -m foundation worklog finish N --evidence E                                               close with evidence
  python3 -m foundation worklog list [--json] [--plans]                                             open work, from the store alone; --plans joins /api/plans
  python3 -m foundation worklog reap [--apply] [--hours H]                                          re-dispatch silent records
  python3 -m foundation worklog backfill [--apply]                                                  file doctrine/work-backfill.json once
  python3 -m foundation worklog --check                                                             instructions and loop are wired

reap: a record whose heartbeat is older than `stale_hours` (doctrine/worklog.json) gets the label `resume` and `queue`, its owner becomes
`server-lane`, and a comment carries the next step, so the executor picks it up where it stopped instead of starting over.
"""
from __future__ import annotations
import datetime as dt, json, os, re, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CFG = "doctrine/worklog.json"
GH_REPO = "ultrastable/ultrastable"
BEGIN, END = "<!-- work-record", "work-record -->"
STATES = ("open", "active", "waiting", "resume", "done")


def cfg(root=REPO) -> dict:
    return json.loads((Path(root) / CFG).read_text(encoding="utf-8"))


def now_iso(now=None) -> str:
    return (now or dt.datetime.now(dt.timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")


def render(rec: dict) -> str:
    human = (f"**Goal:** {rec['goal']}\n\n**Done when:** {rec['done']}\n\n**Next step:** {rec.get('next') or '-'}\n\n"
             f"**Owner:** {rec['owner']} · **State:** {rec['state']} · **Heartbeat:** {rec['heartbeat']}\n")
    if rec.get("prs"):
        human += "\n**PRs:** " + ", ".join(rec["prs"]) + "\n"
    return human + f"\n{BEGIN}\n{json.dumps(rec, indent=1, sort_keys=True)}\n{END}\n"


def parse(body: str) -> dict | None:
    m = re.search(re.escape(BEGIN) + r"\s*(\{.*?\})\s*" + re.escape(END), body or "", re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except ValueError:
        return None


def _gh(*a, inp=None) -> tuple[int, str]:
    r = subprocess.run(["gh", *a], capture_output=True, text=True, encoding="utf-8", timeout=60, input=inp)
    return r.returncode, r.stdout if r.returncode == 0 else r.stdout + r.stderr


def new_record(goal, owner, done, nxt="", prs=None, ref="", now=None, plan="") -> dict:
    return {"v": 1, "goal": goal, "owner": owner, "state": "active", "done": done, "next": nxt, "prs": list(prs or []),
            "ref": ref, "plan": plan, "started": now_iso(now), "heartbeat": now_iso(now)}


def fetch_plans(url, fetch=None) -> list[dict] | None:
    """The planner's /api/plans (PLAN-1). None means unreachable: unmeasured, never an empty list."""
    import urllib.request
    try:
        if fetch:
            body = fetch(url)
        else:
            req = urllib.request.Request(url, headers={"user-agent": "ultrastable-worklog"})
            with urllib.request.urlopen(req, timeout=20) as r:
                body = r.read().decode("utf-8")
        j = json.loads(body)
    except Exception as e:  # noqa: BLE001 - recorded, reported as unmeasured
        print(f"plans unmeasured: {url}: {e}", file=sys.stderr)
        return None
    return j.get("plans", j) if isinstance(j, dict) else j


def link_plans(rows: list[dict], plans: list[dict] | None) -> list[dict]:
    """Attach each record to its plan: by the record's `plan` id, or by a plan task whose item_id is the record's ref or #number."""
    if plans is None:
        for r in rows:
            r["plan_status"] = "unmeasured"
        return rows
    by_id, by_item = {}, {}
    for p in plans:
        by_id[str(p.get("id"))] = p
        for t in p.get("tasks", []) or []:
            by_item[str(t.get("item_id"))] = p
    for r in rows:
        p = by_id.get(str(r.get("plan") or "")) or by_item.get(str(r.get("ref") or "")) or by_item.get(f"#{r['number']}") \
            or by_item.get(str(r["number"]))
        r["plan"], r["plan_status"] = (p.get("id"), p.get("status")) if p else (r.get("plan") or "", "none")
    return rows


def open_records(gh=_gh) -> list[dict]:
    rc, out = gh("api", f"repos/{GH_REPO}/issues?labels=work&state=open&per_page=100", "--paginate", "--jq", ".[]")
    if rc:
        raise RuntimeError("store unreadable: " + out.strip()[:300])
    rows = []
    for line in (out or "").splitlines():
        if not line.strip():
            continue
        i = json.loads(line)
        if "pull_request" in i:
            continue
        i["url"] = i.get("html_url", i.get("url"))
        rec = parse(i.get("body", "")) or {}
        rows.append({"number": i["number"], "title": i["title"], "url": i["url"], **rec,
                     "malformed": not rec})
    return rows


def stale(rows: list[dict], hours: float, now=None) -> list[dict]:
    now = now or dt.datetime.now(dt.timezone.utc)
    out = []
    for r in rows:
        if r.get("state") in ("done", "resume", "waiting"):
            continue
        try:
            hb = dt.datetime.strptime(r.get("heartbeat", ""), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)
        except ValueError:
            out.append(r); continue
        if (now - hb).total_seconds() > hours * 3600:
            out.append(r)
    return out


def _api(gh, method, path, payload):
    return gh("api", "-X", method, f"repos/{GH_REPO}/{path}", "--input", "-", inp=json.dumps(payload))


def _edit(n, rec, gh, add=()):
    rc, out = _api(gh, "PATCH", f"issues/{n}", {"body": render(rec)})
    if not rc and add:
        rc, out = _api(gh, "POST", f"issues/{n}/labels", {"labels": list(add)})
    return rc, out


def start(goal, owner, done, nxt="", prs=None, ref="", gh=_gh, plan="") -> str:
    rec = new_record(goal, owner, done, nxt, prs, ref, plan=plan)
    rc, out = _api(gh, "POST", "issues", {"title": goal[:120], "labels": ["work"], "body": render(rec)})
    if rc:
        raise RuntimeError(out)
    return json.loads(out).get("html_url", out.strip())


def _get(n, gh):
    rc, out = gh("api", f"repos/{GH_REPO}/issues/{n}")
    if rc:
        raise RuntimeError(out)
    rec = parse(json.loads(out)["body"])
    if not rec:
        raise RuntimeError(f"#{n} has no work record")
    return rec


def beat(n, nxt=None, pr=None, state=None, gh=_gh, plan=None) -> None:
    rec = _get(n, gh)
    if plan:
        rec["plan"] = plan
    rec["heartbeat"] = now_iso()
    if nxt:
        rec["next"] = nxt
    if pr and pr not in rec["prs"]:
        rec["prs"].append(pr)
    if state:
        assert state in STATES, state
        rec["state"] = state
    rc, out = _edit(n, rec, gh)
    if rc:
        raise RuntimeError(out)


def finish(n, evidence, gh=_gh) -> None:
    rec = _get(n, gh)
    rec.update(state="done", heartbeat=now_iso(), evidence=evidence)
    _edit(n, rec, gh)
    _api(gh, "POST", f"issues/{n}/comments", {"body": "Done. Evidence: " + evidence})
    rc, out = _api(gh, "PATCH", f"issues/{n}", {"state": "closed", "state_reason": "completed"})
    if rc:
        raise RuntimeError(out)


def reap(apply=False, hours=None, gh=_gh, root=REPO) -> list[int]:
    hours = hours or cfg(root)["stale_hours"]
    hit = stale(open_records(gh), hours)
    for r in hit:
        if not apply:
            continue
        rec = {k: r[k] for k in ("v", "goal", "owner", "state", "done", "next", "prs", "ref", "plan", "started", "heartbeat") if k in r}
        prev = rec.get("owner", "?")
        rec.update(state="resume", owner="server-lane", heartbeat=now_iso())
        _edit(r["number"], rec, gh, add=("resume", "queue"))
        _api(gh, "POST", f"issues/{r['number']}/comments", {"body":
           f"Owner `{prev}` went silent for over {hours} h. Re-dispatched to the server lane to resume from: {rec.get('next') or 'the done check'}."})
    return [r["number"] for r in hit]


def backfill(apply=False, gh=_gh, root=REPO) -> list[str]:
    items = json.loads((Path(root) / "doctrine/work-backfill.json").read_text(encoding="utf-8"))["items"]
    have = {r.get("ref") for r in open_records(gh)} if apply else set()
    made = []
    for it in items:
        if it["ref"] in have:
            continue
        made.append(start(it["goal"], it.get("owner", "server-lane"), it["done"], it.get("next", ""), it.get("prs"), it["ref"], gh)
                    if apply else it["ref"])
    return made


def check(root=REPO) -> list[str]:
    bad = []
    c = cfg(root)
    for f in c["instruction_files"]:
        p = Path(root) / f
        if not p.is_file() or "WORK-RECORD-1" not in p.read_text(encoding="utf-8"):
            bad.append(f"{f}: missing WORK-RECORD-1 (sessions must write start/finish to the work store)")
    wf = Path(root) / ".github/workflows/worklog.yml"
    if not wf.is_file() or "worklog reap --apply" not in wf.read_text(encoding="utf-8"):
        bad.append("worklog.yml does not run the reap loop")
    return bad


def main(argv=None) -> int:
    a = list(argv if argv is not None else sys.argv[1:])

    def opt(k, d=None):
        return a[a.index(k) + 1] if k in a else d
    if "--check" in a:
        bad = check(); print("worklog ok" if not bad else "\n".join(bad)); return 1 if bad else 0
    cmd = a[0] if a else "list"
    if cmd == "start":
        print(start(opt("--goal"), opt("--owner", os.environ.get("CLAUDE_SESSION", "agent")), opt("--done"), opt("--next", ""),
                    [opt("--pr")] if "--pr" in a else [], opt("--ref", ""), plan=opt("--plan", ""))); return 0
    if cmd == "beat":
        beat(a[1], opt("--next"), opt("--pr"), opt("--state"), plan=opt("--plan")); return 0
    if cmd == "finish":
        finish(a[1], opt("--evidence", "")); return 0
    if cmd == "reap":
        print(json.dumps({"stale": reap("--apply" in a, float(opt("--hours")) if "--hours" in a else None)})); return 0
    if cmd == "backfill":
        print(json.dumps({"filed": backfill("--apply" in a)})); return 0
    rows = open_records()
    if "--plans" in a:
        rows = link_plans(rows, fetch_plans(cfg()["plans_url"]))
    if "--json" in a:
        print(json.dumps(rows, indent=1)); return 0
    for r in rows:
        print(f"#{r['number']:<5} {r.get('state','?'):<7} {r.get('owner','?')[:18]:<18} {r.get('heartbeat','?')}  {r['title']}"
              + (f"  [plan {r.get('plan') or '-'}: {r['plan_status']}]" if "plan_status" in r else "") + "\n"
              f"       next: {r.get('next') or '-'}")
    print(f"{len(rows)} open work records")
    return 0


if __name__ == "__main__":
    sys.exit(main())

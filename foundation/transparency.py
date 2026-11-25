"""TRANSPARENCY-1: Ultrastable shows its own work, read-only, to everyone (owner directive 2026-11-12).

  python3 -m foundation transparency [--out FILE] [--no-gh] [--sql FILE]

Builds one JSON snapshot of how the system runs on itself: the managers and loops, what they last did, the claim-vs-code picture
(components, wired edges, user stories, investor objections, the gap register), the change feed (merged and open PRs and commits, each
tied to the work item that caused it), and the scoreboard. The site worker serves it at /live and /api/live (GET only, no write path).

Public means read-only. Everything here is derived from records already in the repository; the only filtering is a secret scrub
(tokens, keys, e-mail addresses). Writing stays behind the owner's e-mailed code (dashboard worker, /owner).
The snapshot is published to D1 table `transparency` (`--sql` writes the upsert); the loop hosts run it on every pass (instances/ultrastable/loops.json).
"""
from __future__ import annotations
import json, re, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path

from . import components as comp

REPO = Path(__file__).resolve().parents[1]
GH = "ultrastable/ultrastable"
SECRET = re.compile(r"(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9._-]{20,}|[\w.+-]+@[\w-]+\.[\w.-]+)")
ITEM = re.compile(r"\b([A-Z][A-Z0-9]+(?:-[A-Z0-9]+)*-\d+|Q-[A-Z-]+|OL-GAP-[\w-]+|SG-\d+)\b")


def scrub(x):
    if isinstance(x, str):
        return SECRET.sub("[redacted]", x)
    if isinstance(x, list):
        return [scrub(i) for i in x]
    if isinstance(x, dict):
        return {k: scrub(v) for k, v in x.items()}
    return x


def _j(root, rel, default=None):
    p = Path(root) / rel
    try:
        return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else default
    except ValueError:
        return default


def _sh(root, *cmd, timeout=60):
    try:
        r = subprocess.run(cmd, cwd=root, capture_output=True, text=True, timeout=timeout, encoding="utf-8", errors="replace")
        return r.stdout if r.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def _role_summary(root, role):
    p = Path(root) / "agents/roles" / f"{role}.md"
    if not p.is_file():
        return {}
    t = p.read_text(encoding="utf-8")
    own = re.search(r"\*\*Owns:\*\*\s*(.+)", t)
    tick = re.search(r"\*\*Tick:\*\*\s*(.+)", t)
    steps = re.findall(r"^\d+\.\s+(.+)$", t.split("## Each tick")[-1].split("##")[0], re.M) if "## Each tick" in t else []
    return {"owns": own and own[1].strip(), "cadence": tick and tick[1].strip(), "each_tick": [s[:220] for s in steps[:6]], "role_file": f"agents/roles/{role}.md"}


def managers(root):
    reg = (_j(root, "instances/ultrastable/loop-registry.json", {}) or {}).get("loops", [])
    last = {}
    ev = Path(root) / "ops/loop-evidence"
    for f in sorted(ev.glob("*.jsonl")) if ev.is_dir() else []:
        for line in f.read_text(encoding="utf-8").splitlines()[-200:]:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            for lp in e.get("loops", []):
                last[lp.get("loop")] = {"at": e.get("at"), "host": e.get("host"), "ok": lp.get("ok"), "steps": lp.get("steps"), "report": lp.get("report")}
    out = []
    for lp in reg:
        row = {"loop": lp.get("id"), "kind": lp.get("kind"), "summary": lp.get("summary"), "owner": lp.get("owner"), "trigger": lp.get("trigger"), "sla": lp.get("sla"),
               "closing_probe": lp.get("closing_probe"), "cycle_metric": lp.get("cycle_metric"), "last_plus": lp.get("last_plus"), "last_run": last.get(lp.get("id"))}
        if lp.get("kind") == "manager":
            row.update(_role_summary(root, lp.get("owner") or ""))
        out.append(row)
    return out


def claims(root):
    try:
        r = comp.evaluate(root)
    except Exception as e:  # never fail the snapshot because one source failed
        return {"error": str(e)[:200]}
    cs = r.get("components", {})
    meta = {c.get("id"): c for c in (comp.load(root).get("components") or []) if isinstance(c, dict)}
    status = {}
    for v in cs.values():
        status[v] = status.get(v, 0) + 1
    return {"component_status": status,
            "components": [{"id": k, "status": v, "what": (meta.get(k) or {}).get("what") or (meta.get(k) or {}).get("name")} for k, v in cs.items()],
            "edges": r.get("edges", []), "stories": r.get("stories", []), "objections": r.get("objections", []), "integration": r.get("integration", {})}


def gaps(root):
    g = (_j(root, "instances/ultrastable/gaps.json", {}) or {}).get("gaps", [])
    return [{k: x.get(k) for k in ("id", "tool", "what", "status", "plan", "probe")} for x in g]


def changes(root, use_gh=True):
    log = _sh(root, "git", "log", "-40", "--format=%H%x09%h%x09%aI%x09%an%x09%s")
    commits = []
    for line in log.splitlines():
        p = line.split("\t")
        if len(p) == 5:
            pr = re.search(r"\(#(\d+)\)", p[4])
            commits.append({"sha": p[1], "at": p[2], "author": p[3], "subject": p[4], "pr": pr and int(pr[1]), "item": (ITEM.search(p[4]) or [None, None])[1], "url": f"https://github.com/{GH}/commit/{p[0]}"})
    prs = []
    if use_gh:
        raw = _sh(root, "gh", "pr", "list", "--repo", GH, "--state", "all", "--limit", "40", "--json", "number,title,state,headRefName,createdAt,mergedAt,author,labels,isDraft,url")
        try:
            for p in json.loads(raw or "[]"):
                prs.append({"number": p["number"], "title": p["title"], "state": "draft" if p.get("isDraft") and p["state"] == "OPEN" else p["state"].lower(), "branch": p["headRefName"],
                            "opened": p["createdAt"], "merged": p.get("mergedAt"), "by": (p.get("author") or {}).get("login"), "labels": [l["name"] for l in p.get("labels", [])],
                            "item": (ITEM.search(p["title"]) or [None, None])[1], "url": p["url"]})
        except (ValueError, KeyError):
            pass
    return {"commits": commits, "pull_requests": prs}


def _gh_json(root, *args):
    try:
        return json.loads(_sh(root, "gh", *args) or "[]")
    except ValueError:
        return []


def merged_rest(root, pages=3):
    """Merged PRs over the REST list endpoint (no GraphQL). Lines are not in that endpoint, so they count as 0 here; the PR count and dates are exact."""
    out = []
    for page in range(1, pages + 1):
        raw = _sh(root, "gh", "api", f"repos/{GH}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page={page}", timeout=120)
        try:
            rows = json.loads(raw or "[]")
        except ValueError:
            rows = []
        if not rows:
            break
        out += [{"number": r["number"], "title": r["title"], "headRefName": (r.get("head") or {}).get("ref", ""), "mergedAt": r["merged_at"], "createdAt": r["created_at"],
                 "additions": 0, "deletions": 0, "body": r.get("body") or "", "url": r["html_url"]} for r in rows if r.get("merged_at")]
    return out


def throughput(root, use_gh=True):
    """How much code the system actually ships, and who ships it. Unattended = PRs opened by the server-side executor (body says 'Executor run');
    everything else on agent/* or claude/* branches is an interactive agent session."""
    from . import queue as qmod
    out = {"queue": {}, "merged": {}, "changelog": [], "deploys": {}, "executor": {}}
    try:
        its = qmod.items(root)
        c = {}
        for i in its:
            c[i.get("status") or "?"] = c.get(i.get("status") or "?", 0) + 1
        out["queue"] = {"items": len(its), "by_status": c, "takeable_now": len(qmod.takeable(root))}
    except Exception as e:  # recorded in the snapshot, never swallowed
        out["queue"] = {"error": str(e)[:200]}
    try:
        from . import agent_ladder
        out["model_cost"] = agent_ladder.summary(root)
    except Exception as e:  # recorded, never swallowed
        out["model_cost"] = {"error": str(e)[:200]}
    if not use_gh:
        return out
    prs = _gh_json(root, "pr", "list", "--repo", GH, "--state", "merged", "--limit", "300", "--json", "number,title,headRefName,mergedAt,createdAt,additions,deletions,body,url")
    src = "graphql"
    if not prs:  # LIVE-COUNT-1 (2026-11-25): the GraphQL list came back empty and /live showed 0 merged PRs while dozens merged; REST is the second route
        prs, src = merged_rest(root), "rest"
    out["merged_source"] = src
    origin = {"unattended executor": [0, 0, 0], "agent session": [0, 0, 0], "bot": [0, 0, 0], "other": [0, 0, 0]}
    day, hours = {}, []
    for p in prs:
        br = p.get("headRefName", "")
        k = "unattended executor" if "Executor run" in (p.get("body") or "") else "bot" if br.startswith(("dependabot", "ultrastable-")) else "agent session" if br.startswith(("agent/", "claude/")) else "other"
        o = origin[k]; o[0] += 1; o[1] += p.get("additions", 0); o[2] += p.get("deletions", 0)
        d = (p.get("mergedAt") or "")[:10]
        day.setdefault(d, []).append({"n": p["number"], "title": p["title"], "by": k, "plus": p.get("additions", 0), "minus": p.get("deletions", 0), "url": p["url"]})
        try:
            a, b = (datetime.fromisoformat(p["createdAt"].replace("Z", "+00:00")), datetime.fromisoformat(p["mergedAt"].replace("Z", "+00:00")))
            hours.append((b - a).total_seconds() / 3600)
        except (KeyError, ValueError):
            pass
    hours.sort()
    out["merged"] = {"total": len(prs), "by_origin": {k: {"prs": v[0], "lines_added": v[1], "lines_removed": v[2]} for k, v in origin.items()},
                     "per_day": {d: len(v) for d, v in sorted(day.items())}, "median_hours_open_to_merge": round(hours[len(hours) // 2], 2) if hours else None}
    out["changelog"] = [{"date": d, "changes": v} for d, v in sorted(day.items(), reverse=True)[:14]]
    runs = _gh_json(root, "run", "list", "--repo", GH, "--workflow", "deploy-site", "--limit", "50", "--json", "conclusion,createdAt,event,headSha")
    dc = {}
    for r in runs:
        dc[r.get("conclusion") or "running"] = dc.get(r.get("conclusion") or "running", 0) + 1
    out["deploys"] = {"site_runs": len(runs), "by_conclusion": dc, "latest": runs[0] if runs else None,
                      "per_day_success": {d: sum(1 for r in runs if r["createdAt"][:10] == d and r.get("conclusion") == "success") for d in sorted({r["createdAt"][:10] for r in runs})}}
    allp = _gh_json(root, "pr", "list", "--repo", GH, "--state", "all", "--limit", "300", "--json", "number,state,body")
    att = [p for p in allp if "Executor run" in (p.get("body") or "")]
    att_by_state = {st: sum(1 for p in att if p["state"] == st) for st in {p["state"] for p in att}}
    ex = _gh_json(root, "run", "list", "--repo", GH, "--workflow", "executor", "--limit", "30", "--json", "conclusion,createdAt,event")
    out["executor"] = {"runs": len(ex), "by_conclusion": {c: sum(1 for r in ex if r.get("conclusion") == c) for c in {r.get("conclusion") for r in ex}},
                       "prs_opened_unattended": len(att), "prs_merged_unattended": origin["unattended executor"][0], "attempts": att_by_state, "log_rows": len((Path(root) / "ops/executor-log.jsonl").read_text(encoding="utf-8").splitlines()) if (Path(root) / "ops/executor-log.jsonl").is_file() else 0}
    return out


def improvements(root):
    return (_j(root, "instances/ultrastable/improvements.json", {}) or {}).get("entries", [])[-20:]


def snapshot(root=REPO, use_gh=True):
    root = Path(root)
    mg, cl, gp, ch = managers(root), claims(root), gaps(root), changes(root, use_gh)
    open_prs = [p for p in ch["pull_requests"] if p["state"] in ("open", "draft")]
    merged = [p for p in ch["pull_requests"] if p["state"] == "merged"]
    th = throughput(root, use_gh)
    try:
        from . import clockwork
        prs_all = clockwork.executor_prs() if use_gh else []
        stg = clockwork.stages(root, prs=prs_all) if use_gh else []
        sett = clockwork.settlement(root, prs=prs_all) if use_gh else {}
        sett = {"counts": sett.get("counts"), "names": list((sett.get("names") or {}).values())[-40:], "unsettled": sett.get("unsettled")}
    except Exception as e:  # recorded, never swallowed
        stg, sett = [{"id": "stages", "status": "unmeasured", "why": str(e)[:160]}], {}
    try:
        from . import pm
        pm_rep = pm.run(root, apply=False, use_live=use_gh) if use_gh else {}
        pm_rep["knob_log"] = pm.knob_log(root)[-10:]
    except Exception as e:  # recorded
        pm_rep = {"error": str(e)[:160]}
    try:
        from . import growth
        gr = growth.snapshot(root, use_live=use_gh)
    except Exception as e:  # recorded, never swallowed
        gr = {"error": str(e)[:200]}
    try:
        from . import clock
        clocks = clock.report(root) if use_gh else []
    except Exception as e:  # recorded, never swallowed
        clocks = [{"id": "clock-report", "status": "unmeasured", "why": str(e)[:160]}]
    try:
        from . import topology
        top = {**topology.summary(root), "drift": topology.drift(root) if use_gh else ["not measured"]}
    except Exception as e:  # recorded, never swallowed
        top = {"error": str(e)[:200]}
    s = {
        "schema": "ultrastable-transparency/v1",
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "commit": _sh(root, "git", "rev-parse", "--short", "HEAD").strip(),
        "access": "read-only for everyone; changes require the owner's e-mailed code",
        "scoreboard": {
            "managers_and_loops": len(mg), "loops_with_evidence": sum(1 for m in mg if m["last_run"]),
            "components": cl.get("component_status", {}), "edges_wired": (cl.get("integration") or {}).get("edges_wired"), "edges_total": (cl.get("integration") or {}).get("edges"),
            "stories_passing": sum(1 for x in cl.get("stories", []) if x.get("pass")), "stories_total": len(cl.get("stories", [])),
            "open_gaps": sum(1 for g in gp if (g.get("status") or "open") != "closed"), "open_prs": len(open_prs), "merged_prs_listed": len(merged),
            "prs_merged_total": (th.get("merged") or {}).get("total"), "prs_merged_unattended": ((th.get("merged") or {}).get("by_origin") or {}).get("unattended executor", {}).get("prs"),
            "backlog_open": (th.get("queue") or {}).get("by_status", {}).get("open"), "backlog_items": (th.get("queue") or {}).get("items"),
        },
        "unknowns": _unknowns(root),
        "throughput": th, "stages": stg, "settlement": sett, "product_manager": pm_rep, "growth": gr, "clocks": clocks, "topology": top, "managers": mg, "claims": cl, "gaps": gp, "changes": ch, "loop_improvements": improvements(root),
        "feedback_loop": "claim (site/doctrine) -> probe (components, gap register, loops) -> gap item -> branch/draft PR by an agent -> merge on green checks -> deploy -> probe again; each row above links the step to its record.",
    }
    return scrub(s)


def _unknowns(root):
    """UNKNOWNS-1: what the system does not know, as questions asked and answered (never the answer text, which can name private findings)."""
    try:
        from . import unknowns
        st = unknowns.status(root)
        led = unknowns.ledger(root)
        recent = [{"at": r["at"], "key": r["key"], "kind": r["kind"], "verdict": r.get("verdict")} for r in led[-8:]][::-1]
        return {**st, "recent": recent, "method": "pre-mortem, assumption audit, red team, Rumsfeld blind side, Universal Ignorance Audit"}
    except (OSError, ValueError, KeyError) as e:  # recorded, never swallowed
        return {"error": str(e)[:200]}


PART = 50000  # D1 refuses very large single statements, so the snapshot is stored as parts of this many characters


def sql(snap):
    """Statements that store the snapshot as numbered parts of one generation. Part 0 is written last: the site serves a generation only once its part 0 exists."""
    txt = json.dumps(snap, separators=(",", ":"))
    parts = [txt[i:i + PART] for i in range(0, len(txt), PART)] or [""]
    g = snap["generated"]
    out = ["CREATE TABLE IF NOT EXISTS transparency_parts (generated TEXT NOT NULL, part INTEGER NOT NULL, total INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (generated, part))"]
    order = list(range(1, len(parts))) + [0]
    for n in order:
        out.append("INSERT OR REPLACE INTO transparency_parts (generated,part,total,body) VALUES ('%s',%d,%d,'%s')" % (g, n, len(parts), parts[n].replace("'", "''")))
    out.append("DELETE FROM transparency_parts WHERE generated < '%s'" % g)
    return out




UA = "ultrastable-transparency/1"  # Cloudflare answers 403 (error 1010) to the default python-urllib agent
SITE = "https://ultrastable-site.ultrastable.workers.dev"


def publish_oidc(snap, env=None) -> dict:
    """LIVE-FRESH-2: post the snapshot to the site worker, which writes its own D1 binding. Authenticated by this run's GitHub OIDC token; no stored credential."""
    import os, urllib.request
    env = os.environ if env is None else env
    u, t = env.get("ACTIONS_ID_TOKEN_REQUEST_URL"), env.get("ACTIONS_ID_TOKEN_REQUEST_TOKEN")
    if not u or not t:
        return {"published": False, "why": "no GitHub OIDC request URL (job needs permissions id-token: write)"}
    try:
        with urllib.request.urlopen(urllib.request.Request(u + "&audience=ultrastable-deploy", headers={"authorization": "bearer " + t, "user-agent": UA}), timeout=30) as r:
            jwt = json.loads(r.read())["value"]
        txt = json.dumps(snap, separators=(",", ":"))
        parts = [txt[i:i + PART] for i in range(0, len(txt), PART)] or [""]
        req = urllib.request.Request(env.get("TARGET_SITE", SITE) + "/__internal/transparency", method="POST", data=json.dumps({"generated": snap["generated"], "parts": parts}).encode(),
                                     headers={"authorization": "Bearer " + jwt, "content-type": "application/json", "user-agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            res = json.loads(r.read())
        return {"published": bool(res.get("ok")), "generated": snap["generated"], "route": "oidc"} if res.get("ok") else {"published": False, "why": str(res)[:200]}
    except Exception as e:  # recorded, never swallowed
        return {"published": False, "why": ("oidc: " + str(e))[:200]}


def publish(snap, token=None) -> dict:
    """Publish by the OIDC route only. The Cloudflare account the old API route wrote to is retired (ACCOUNT-SPLIT-2): it reported success while the site read another database."""
    return publish_oidc(snap)


def loop(root=REPO) -> dict:
    """Launch-loop entry: write ops/transparency.json (the git record) and publish it to the live site."""
    snap = snapshot(root)
    out = Path(root) / "ops/transparency.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snap, indent=1), encoding="utf-8")
    pub = publish(snap)
    return {"loop": "transparency", "ok": True, "bytes": out.stat().st_size, "loops_with_evidence": snap["scoreboard"]["loops_with_evidence"], **pub}


def probe_merged(root=REPO, live=None, rest=None) -> int:
    """LIVE-COUNT-1 probe: fails when /live shows 0 merged PRs while GitHub's REST list has merges in the last 7 days."""
    import urllib.request
    if live is None:
        req = urllib.request.Request("https://ultrastable.io/api/live", headers={"user-agent": "ultrastable-transparency/1"})
        with urllib.request.urlopen(req, timeout=30) as r:
            live = json.loads(r.read())
    shown = (((live.get("snapshot") or live).get("throughput") or {}).get("merged") or {}).get("total") or 0
    cut = datetime.now(timezone.utc).timestamp() - 7 * 86400
    rows = merged_rest(root, pages=1) if rest is None else rest
    recent = sum(1 for p in rows if datetime.fromisoformat(p["mergedAt"].replace("Z", "+00:00")).timestamp() >= cut)
    print(json.dumps({"live_total": shown, "github_merged_7d": recent}))
    return 1 if recent and not shown else 0


def main(argv) -> int:
    a = list(argv)
    if "--probe-merged" in a:
        return probe_merged()
    out = a[a.index("--out") + 1] if "--out" in a else None
    sq = a[a.index("--sql") + 1] if "--sql" in a else None
    snap = snapshot(REPO, use_gh="--no-gh" not in a)
    txt = json.dumps(snap, indent=1)
    if out:
        Path(out).parent.mkdir(parents=True, exist_ok=True)
        Path(out).write_text(txt, encoding="utf-8")
    if sq:
        Path(sq).parent.mkdir(parents=True, exist_ok=True)
        Path(sq).write_text((";" + chr(10)).join(sql(snap)) + ";" + chr(10), encoding="utf-8")
    if "--publish" in a:
        res = publish(snap)
        print(json.dumps(res))
        if not res.get("published"):
            return 1  # a snapshot that did not reach the site is a failed run, never a green one
    if not out and not sq and "--publish" not in a:
        print(txt)
    else:
        print(f"transparency: {len(txt)} bytes, {snap['scoreboard']['managers_and_loops']} loops, {snap['scoreboard']['open_prs']} open PRs, {len(snap['changes']['commits'])} commits")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

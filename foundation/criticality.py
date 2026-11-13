"""CRITICALITY-1 (Rowan, 2026-11-13): bootstrap to criticality, measured.

Criticality means the loops produce more verified deploys than they consume in cost and attention, the way a reactor goes critical when each
reaction causes more than one more. This module turns that sentence into numbers, stores them, alerts on a fall and keeps the loops' own work
items completing themselves.

  python3 -m foundation criticality --run [--apply] [--cf-json FILE]   measure, score, store, alert, self-complete
  python3 -m foundation criticality --score FILE                        score a saved inputs file (pure, no network)
  python3 -m foundation criticality --probe FACTOR                      exit 0 when the factor is within budget in the latest record
  python3 -m foundation criticality --check                             config and scoring invariants

The score (doctrine/criticality.json holds every budget):
  output       = zero-human verified deploys per day / deploys_per_day * coupling
  cost_load    = max(D1 rows read / budget, Workers AI neurons / budget)
  attention    = human interventions per day / attention_per_day
  consumption  = max(cost_load, attention, 0.05)            the binding constraint, not a sum
  k            = output / consumption                       above 1 is critical

Zero-human: the actor of every run is the owner's token, so it says nothing. A deploy is zero-human when its origin commit was made by a bot or
merged from a pull request the executor or a manager opened (doctrine/criticality.json `automated`). Verified: a deploy-workers run counts only
when ops/deploys.jsonl records live_matches_commit for its commit; other deploy workflows count on a successful run.
Coupling: the share of loop outflows that another loop consumes (doctrine/flows.json).
"""
from __future__ import annotations
import datetime as dt, json, os, re, subprocess, sys, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CFG = "doctrine/criticality.json"
LOG = "ops/criticality.jsonl"
FACTORS = ("cost_d1", "cost_ai", "attention", "output", "coupling")


def cfg(root=REPO) -> dict:
    return json.loads((Path(root) / CFG).read_text(encoding="utf-8"))


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


# ---------- collection ----------
def gh(args: list[str], root=REPO):
    r = subprocess.run(["gh", "api", *args], capture_output=True, text=True, cwd=root, timeout=90)
    if r.returncode:
        raise RuntimeError((r.stderr or r.stdout).strip()[:200])
    return json.loads(r.stdout or "null")


class Origin:
    """Classifies a commit as automated or human-attended, with a cache so each commit costs at most two reads."""

    def __init__(self, c: dict, root=REPO):
        self.c, self.root, self.cache = c["automated"], root, {}

    def prefetch(self, repo: str, shas: set) -> None:
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(8) as ex:
            list(ex.map(lambda x: self.of(repo, x), sorted(shas)))

    def of(self, repo: str, sha: str, author: str | None = None) -> str:
        k = (repo, sha)
        if k in self.cache:
            return self.cache[k]
        a, v = self.c, "human"
        try:
            if author is None:
                author = gh([f"repos/{repo}/commits/{sha}"], self.root).get("commit", {}).get("author", {}).get("name") or ""
            if author in a["authors"]:
                v = "auto"
            else:
                for pr in gh([f"repos/{repo}/commits/{sha}/pulls"], self.root) or []:
                    body = pr.get("body") or ""
                    if pr["head"]["ref"].startswith(tuple(a["pr_head_prefixes"])) and any(m in body for m in a["pr_body_markers"]):
                        v = "auto"
                    elif pr["head"]["ref"].startswith("ultrastable-"):
                        v = "auto"
                    break
        except (RuntimeError, ValueError, KeyError):
            v = "unknown"
        self.cache[k] = v
        return v


def ledger_shas(repo: str, root=REPO) -> set[str]:
    """Commits whose deploy the repository's own ledger records as live-verified (ops/deploys.jsonl on main)."""
    try:
        raw = subprocess.run(["gh", "api", "-H", "Accept: application/vnd.github.raw", f"repos/{repo}/contents/ops/deploys.jsonl?ref=main"],
                             capture_output=True, text=True, cwd=root, timeout=60)
        out = set()
        for line in raw.stdout.splitlines():
            try:
                j = json.loads(line)
            except ValueError:
                continue
            if j.get("live_matches_commit"):
                out.add(j.get("sha"))
        return out
    except (OSError, subprocess.TimeoutExpired):
        return set()


def collect_deploys(c: dict, since: str, root=REPO) -> tuple[dict, list]:
    """Per UTC day: verified automated, verified human-attended, failed, unverified. Unreadable repos are listed, never counted as zero."""
    days: dict[str, dict] = {}
    unreadable, origin = [], Origin(c, root)
    for repo in c["repos"]:
        try:
            wfs = [w for w in gh([f"repos/{repo}/actions/workflows?per_page=100"], root)["workflows"] if w["name"] in c["deploy_workflows"]]
            led = ledger_shas(repo, root) if any(c["verify_by"].get(w["name"]) == "ledger" for w in wfs) else set()
            for w in wfs:
                mode = c["verify_by"].get(w["name"], c["verify_by"]["default"])
                runs = gh([f"repos/{repo}/actions/workflows/{w['id']}/runs?per_page=100&created=>={since}&status=completed"], root)["workflow_runs"]
                origin.prefetch(repo, {r["head_sha"] for r in runs if r["conclusion"] == "success" and r["event"] not in c["automated"]["events"]})
                for run in runs:
                    d = days.setdefault(run["created_at"][:10], {"auto": 0, "human": 0, "failed": 0, "unverified": 0})
                    if run["conclusion"] == "failure":
                        d["failed"] += 1
                    elif run["conclusion"] == "success":
                        if mode == "ledger" and run["head_sha"] not in led:
                            d["unverified"] += 1
                            continue
                        auto = run["event"] in c["automated"]["events"] or origin.of(repo, run["head_sha"]) == "auto"
                        d["auto" if auto else "human"] += 1
        except (RuntimeError, KeyError) as e:
            unreadable.append(f"{repo}: {e}")
    return days, unreadable


def collect_interventions(c: dict, since: str, root=REPO) -> tuple[dict, list]:
    """Per UTC day: human-attended commits on main (each merged interactive pull request is one) across the repos."""
    days: dict[str, int] = {}
    unreadable, origin = [], Origin(c, root)
    for repo in c["repos"]:
        try:
            cms = gh([f"repos/{repo}/commits?sha=main&since={since}T00:00:00Z&per_page=100"], root)[:c.get("max_commits_per_repo", 60)]
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(8) as ex:
                list(ex.map(lambda m: origin.of(repo, m["sha"], m["commit"]["author"]["name"]), cms))
            for cm in cms:
                if origin.of(repo, cm["sha"], cm["commit"]["author"]["name"]) == "human":
                    d = cm["commit"]["author"]["date"][:10]
                    days[d] = days.get(d, 0) + 1
        except (RuntimeError, KeyError) as e:
            unreadable.append(f"{repo}: {e}")
    return days, unreadable


def cf_request(token: str, method: str, path: str, body=None):
    req = urllib.request.Request("https://api.cloudflare.com/client/v4" + path, method=method, data=json.dumps(body).encode() if body else None,
                                 headers={"authorization": "Bearer " + token, "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def collect_spend(c: dict, since: str, until: str, root=REPO) -> tuple[dict, list]:
    """Per UTC day: D1 rows read and Workers AI neurons for the whole Cloudflare account (Ultrastable and its Quniverse test bed share it)."""
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    acct = json.loads((Path(root) / "deploy/cloudflare-accounts.json").read_text(encoding="utf-8"))["current"]["id"]
    if not token:
        return {}, ["spend: CLOUDFLARE_API_TOKEN not bound (use --cf-json)"]
    q = ("query($a:String!,$s:Date!,$e:Date!,$st:Time!,$et:Time!){viewer{accounts(filter:{accountTag:$a}){"
         "d1:d1AnalyticsAdaptiveGroups(limit:100,filter:{date_geq:$s,date_leq:$e}){dimensions{date} sum{rowsRead}}"
         "ai:aiInferenceAdaptiveGroups(limit:100,filter:{datetime_geq:$st,datetime_leq:$et}){dimensions{date:date} sum{totalNeurons}}}}}")
    try:
        r = cf_request(token, "POST", "/graphql", {"query": q, "variables": {"a": acct, "s": since, "e": until, "st": since + "T00:00:00Z", "et": until + "T23:59:59Z"}})
        return spend_rows(r), []
    except Exception as e:  # network or schema failure is reported, not hidden
        return {}, [f"spend: {type(e).__name__}: {e}"]


def spend_rows(r: dict) -> dict:
    acc = ((r.get("data") or {}).get("viewer") or {}).get("accounts") or [{}]
    out: dict[str, dict] = {}
    for g in acc[0].get("d1") or []:
        out.setdefault(g["dimensions"]["date"], {})["d1_rows_read"] = g["sum"]["rowsRead"]
    for g in acc[0].get("ai") or []:
        out.setdefault(g["dimensions"]["date"], {})["ai_neurons"] = g["sum"]["totalNeurons"]
    return out


def collect_prompts(c: dict, since: str) -> dict:
    """Owner prompts to the fleet per day (Quniverse qnfo-audit.owner_prompts), when a token can read it."""
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if not token:
        return {}
    try:
        acct = json.loads((REPO / "deploy/cloudflare-accounts.json").read_text(encoding="utf-8"))["current"]["id"]
        dbs = cf_request(token, "GET", f"/accounts/{acct}/d1/database?per_page=100")["result"]
        db = next(d["uuid"] for d in dbs if d["name"] == c["cloudflare"]["audit_db"])
        t = c["cloudflare"]["prompts_table"]
        rows = cf_request(token, "POST", f"/accounts/{acct}/d1/database/{db}/query", {"sql": f"SELECT substr(ts,1,10) d, count(*) n FROM {t} WHERE ts >= ? GROUP BY 1", "params": [since]})["result"][0]["results"]
        return {r["d"]: r["n"] for r in rows}
    except Exception:
        return {}


# ---------- scoring (pure) ----------
def coupling(root=REPO) -> tuple[float, list[str]]:
    """Share of loop outflows that a different loop consumes (doctrine/flows.json). Outflows to the world count through the signal that returns."""
    flows = json.loads((Path(root) / "doctrine/flows.json").read_text(encoding="utf-8"))["flows"]
    inflows: dict[str, set] = {}
    for fid, f in flows.items():
        for i in f.get("inflows", []):
            inflows.setdefault(i["signal"], set()).add(fid)
    total, consumed, orphan = 0, 0, []
    for fid, f in flows.items():
        for o in f.get("outflows", []):
            total += 1
            sigs = [o["signal"]] + ([o["returns"]] if o.get("returns") else [])
            if any(inflows.get(s, set()) - {fid} for s in sigs):
                consumed += 1
            else:
                orphan.append(f"{fid}:{o['signal']}")
    return (consumed / total if total else 0.0), orphan


def score_day(day: str, dep: dict, spend: dict, interventions: int, coup: float, c: dict) -> dict:
    b = c["budgets"]
    auto = dep.get("auto", 0)
    load_d1 = (spend.get("d1_rows_read") or 0) / b["d1_rows_read_per_day"] if spend.get("d1_rows_read") is not None else None
    load_ai = (spend.get("ai_neurons") or 0) / b["ai_neurons_per_day"] if spend.get("ai_neurons") is not None else None
    attention = interventions / b["attention_per_day"]
    output = auto / b["deploys_per_day"] * coup
    cost = max(x for x in (load_d1, load_ai, 0.0) if x is not None)
    consumption = max(cost, attention, 0.05)
    k = output / consumption
    loads = {"cost_d1": load_d1, "cost_ai": load_ai, "attention": attention}
    limiter = max((f for f in loads if loads[f] is not None), key=lambda f: loads[f]) if any(v is not None for v in loads.values()) else "output"
    if loads.get(limiter) is None or loads[limiter] <= 1:
        limiter = "coupling" if coup < c["coupling_min"] else "output"
    return {"day": day, "k": round(k, 4), "critical": k > 1, "limiter": limiter, "output": round(output, 4), "consumption": round(consumption, 4),
            "deploys": {"auto_verified": auto, "human_verified": dep.get("human", 0), "failed": dep.get("failed", 0), "unverified": dep.get("unverified", 0)},
            "spend": {"d1_rows_read": spend.get("d1_rows_read"), "ai_neurons": spend.get("ai_neurons"), "d1_load": None if load_d1 is None else round(load_d1, 3),
                      "ai_load": None if load_ai is None else round(load_ai, 3)},
            "attention": {"interventions": interventions, "load": round(attention, 3)}, "coupling": round(coup, 3)}


def score(inputs: dict, c: dict) -> dict:
    days = sorted(set(inputs["deploys"]) | set(inputs["spend"]) | set(inputs["interventions"]))
    rows = [score_day(d, inputs["deploys"].get(d, {}), inputs["spend"].get(d, {}), inputs["interventions"].get(d, 0) + inputs.get("prompts", {}).get(d, 0), inputs["coupling"], c) for d in days]
    return {"at": inputs["at"], "version": c["version"], "headline": rows[-2] if len(rows) > 1 else (rows[-1] if rows else None),
            "today": rows[-1] if rows else None, "days": rows, "orphan_signals": inputs.get("orphan_signals", []), "unreadable": inputs.get("unreadable", []),
            "stale_items": inputs.get("stale_items", 0)}


def gather(c: dict, cf_json: str | None, root=REPO) -> dict:
    today = now().strftime("%Y-%m-%d")
    since = (now() - dt.timedelta(days=c["window_days"])).strftime("%Y-%m-%d")
    dep, u1 = collect_deploys(c, since, root)
    iv, u2 = collect_interventions(c, since, root)
    if cf_json:
        sp, u3 = spend_rows(json.loads(Path(cf_json).read_text(encoding="utf-8"))), []
    else:
        sp, u3 = collect_spend(c, since, today, root)
    coup, orphan = coupling(root)
    return {"at": now().isoformat(timespec="seconds"), "deploys": dep, "spend": sp, "interventions": iv, "prompts": collect_prompts(c, since), "coupling": coup,
            "orphan_signals": orphan, "unreadable": u1 + u2 + u3}


# ---------- alert ----------
FIX = {
    "cost_d1": ("D1 rows read are over the daily budget", "find the databases and queries that read the most rows (deploy/cost-probe.mjs, d1AnalyticsAdaptiveGroups per database) and cut them: cache, index, hourly instead of per-request"),
    "cost_ai": ("Workers AI neurons are over the daily budget", "route the highest-volume callers to the cheapest capable model or a smaller batch (BUDGET-SOFT-ROUTE-1); never stop a loop"),
    "attention": ("human interventions are over the daily budget", "find which human-attended merges and prompts the loops could have done themselves and give each a loop owner with a probe"),
    "output": ("zero-human verified deploys are below the daily target", "raise the share of deploys that originate from executor or manager pull requests: unpark failing items, widen the executor's takeable queue, fix its failing path"),
    "coupling": ("loop outflows are not consumed by another loop", "give each listed signal a consuming loop in doctrine/flows.json and the code that reads it"),
}


def latest(root=REPO) -> dict | None:
    p = Path(root) / LOG
    rows = [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()] if p.exists() else []
    rows = [r for r in rows if r.get("ev") == "score"]
    return rows[-1] if rows else None


def ok_factor(rec: dict, factor: str, c: dict) -> bool:
    h = rec["headline"] or {}
    if factor == "cost_d1":
        return (h["spend"]["d1_load"] or 0) <= 1
    if factor == "cost_ai":
        return (h["spend"]["ai_load"] or 0) <= 1
    if factor == "attention":
        return h["attention"]["load"] <= 1
    if factor == "coupling":
        return h["coupling"] >= c["coupling_min"]
    return h["output"] >= 1


def alert(rec: dict, c: dict, prev: dict | None, root=REPO, apply=False) -> list[str]:
    """File one queue item per limiting factor while k is at or below 1 or fell; the item's own probe closes it (foundation queue --run)."""
    h = rec["headline"]
    if not h:
        return []
    fell = bool(prev and prev.get("headline") and h["k"] < prev["headline"]["k"] * c["alert"]["fall_ratio"])
    if h["k"] > 1 and not fell:
        return []
    out = []
    # one item per factor that is out of budget, so the fix for each runs in parallel
    for f in FACTORS:
        if ok_factor(rec, f, c):
            continue
        iid = f"Q-CRIT-{f.replace('_', '-').upper()}"
        path = Path(root) / "docs/issues" / f"{iid}.json"
        if path.exists() and "**Status:** open" in json.loads(path.read_text(encoding="utf-8"))["body"]:
            continue
        title, lever = FIX[f]
        body = (f"**Owner:** executor\n**Trigger:** criticality score at {rec['at']}: k={h['k']} on {h['day']}, limiter {h['limiter']}; refiled while the factor is out of budget\n"
                f"**Done check:** cmd:python3 -m foundation criticality --probe {f}\n**Status:** open\n\n{title}. Lever: {lever}.\n\n"
                f"Measured {h['day']}: deploys {h['deploys']}, spend {h['spend']}, attention {h['attention']}, coupling {h['coupling']}. "
                "Quniverse is the test bed on the same Cloudflare account, so its sibling threads own the query-level fixes; this item owns the Ultrastable side and the measurement.\n\n"
                f"size: M\n\n**Closing probe:** cmd:python3 -m foundation criticality --probe {f}\n")
        out.append(iid)
        if apply:
            path.write_text(json.dumps({"id": iid, "title": f"{iid}: {title}", "body": body, "labels": ["p1", "agent-ready"], "milestone": "Now", "workstream": "criticality"}, indent=2) + "\n", encoding="utf-8")
    return out


# ---------- self-completion ----------
def selfcomplete(c: dict, root=REPO, apply=False) -> dict:
    """Resolve: close every open item whose closing probe passes. Re-dispatch: an open item nobody touched for stale_item_hours gets the executor pointed at it."""
    from . import queue
    res = {"closed": [], "redispatched": [], "stuck": [], "stale": 0}
    for r in queue.run(root, apply=apply):
        if r["passed"]:
            res["closed"].append(r["id"])
    events = [json.loads(x) for x in (Path(root) / LOG).read_text(encoding="utf-8").splitlines() if x.strip()] if (Path(root) / LOG).exists() else []
    last: dict[str, str] = {}
    tries: dict[str, int] = {}
    for e in events:
        if e.get("ev") == "redispatch":
            last[e["item"]] = e["at"]
            tries[e["item"]] = tries.get(e["item"], 0) + 1
    rows = queue.executor_rows(root)
    t_now = now()
    for it in queue.items(root):
        if it["status"] != "open" or re.search(r"ROWAN|identity-bound", it["owner"], re.I) or queue.protected_probe(it["probe"]):
            continue
        touched = [r["at"] for r in rows if str(r.get("issue")) == str(it["id"]) and r.get("at")]
        git = subprocess.run(["git", "log", "-1", "--format=%cI", "--", str(it["path"].relative_to(root))], capture_output=True, text=True, cwd=root)
        for ts in (last.get(it["id"]), git.stdout.strip()):
            if ts:
                touched.append(ts)
        age_h = (t_now - dt.datetime.fromisoformat(max(touched).replace("Z", "+00:00"))).total_seconds() / 3600 if touched else 1e9
        if age_h < c["stale_item_hours"]:
            continue
        res["stale"] += 1
        if tries.get(it["id"], 0) >= c["redispatch_attempts_before_stuck"]:
            res["stuck"].append(it["id"])
        elif len(res["redispatched"]) < c["redispatch_max_per_run"]:
            res["redispatched"].append(it["id"])
    if apply:
        with (Path(root) / LOG).open("a", encoding="utf-8") as f:
            for i in res["redispatched"]:
                subprocess.run(["gh", "workflow", "run", "executor.yml", "-f", f"issue={i}"], cwd=root, capture_output=True, text=True)
                f.write(json.dumps({"ev": "redispatch", "at": t_now.isoformat(timespec="seconds"), "item": i}) + "\n")
            for i in res["closed"]:
                f.write(json.dumps({"ev": "closed", "at": t_now.isoformat(timespec="seconds"), "item": i}) + "\n")
    return res


# ---------- store ----------
def store(rec: dict, root=REPO) -> str:
    p = Path(root) / LOG
    p.parent.mkdir(exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"ev": "score", **rec}, separators=(",", ":")) + "\n")
    url, tok = os.environ.get("DASHBOARD_URL"), os.environ.get("FLEET_TOKEN")
    if not (url and tok):
        return "log only (DASHBOARD_URL or FLEET_TOKEN not set)"
    req = urllib.request.Request(url.rstrip("/") + "/api/fleet/criticality", data=json.dumps(rec).encode(), method="POST",
                                 headers={"authorization": "Bearer " + tok, "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return f"dashboard {r.status}"
    except Exception as e:
        return f"dashboard post failed: {type(e).__name__}: {e}"


# ---------- the mantra ----------
MANTRA = "Verified, consumed, under budget; else refile and redispatch."


def tick_check(loop_id: str, root=REPO, apply=False) -> dict:
    """The system's mantra as code: every loop tick asks of its own last output (1) is it verified, (2) did another loop consume it, (3) is the
    system under budget. A failed answer files its own fix item (once while open) and re-dispatches the loop's workflow. Loops call it by id;
    `--mantra-all` calls it for every declared loop on each criticality run, and a test fails when a declared loop is not covered."""
    c = cfg(root)
    flows = json.loads((Path(root) / "doctrine/flows.json").read_text(encoding="utf-8"))["flows"]
    reg = {l["id"]: l for l in json.loads((Path(root) / "instances/ultrastable/loop-registry.json").read_text(encoding="utf-8"))["loops"]}
    f, l = flows.get(loop_id), reg.get(loop_id, {})
    res = {"loop": loop_id, "mantra": MANTRA, "verified": None, "consumed": None, "under_budget": None, "failed": []}
    if not f:
        res["failed"].append("declared"); return res
    inflow_sigs = {i["signal"]: fid for fid, g in flows.items() for i in g.get("inflows", [])}
    cons = [o["signal"] for o in f.get("outflows", []) if not any(x != loop_id for x in [k for k, g in flows.items() if any(i["signal"] in (o["signal"], o.get("returns")) for i in g.get("inflows", []))])]
    res["consumed"] = not cons
    files = [Path(root) / o["via"][5:] for o in f.get("outflows", []) if o["via"].startswith("file:")]
    sla_h = {"1 tick": 1, "1d": 24, "7d": 168}.get(l.get("sla", ""), 24)
    fresh = [p for p in files if p.exists() and (now().timestamp() - p.stat().st_mtime) / 3600 <= sla_h * 3]
    res["verified"] = (bool(fresh) if files else None)
    rec = latest(root)
    res["under_budget"] = (all(ok_factor(rec, x, c) for x in ("cost_d1", "cost_ai", "attention")) if rec else None)
    for k in ("verified", "consumed", "under_budget"):
        if res[k] is False:
            res["failed"].append(k)
    if res["failed"] and apply:
        iid = f"Q-CRIT-MANTRA-{loop_id.upper()}"
        path = Path(root) / "docs/issues" / f"{iid}.json"
        if not (path.exists() and "**Status:** open" in path.read_text(encoding="utf-8")):
            body = (f"**Owner:** executor\n**Trigger:** the mantra check of loop {loop_id} failed: {', '.join(res['failed'])} ({now().isoformat(timespec='seconds')})\n"
                    f"**Done check:** cmd:python3 -m foundation criticality --mantra {loop_id}\n**Status:** open\n\n{MANTRA} Loop {loop_id}: unconsumed signals {cons}. "
                    "Fix the loop so its output is recorded fresh, consumed by another loop and within budget.\n\nsize: S\n\n"
                    f"**Closing probe:** cmd:python3 -m foundation criticality --mantra {loop_id}\n")
            path.write_text(json.dumps({"id": iid, "title": f"{iid}: {loop_id} failed the mantra check", "body": body, "labels": ["p1", "agent-ready"], "milestone": "Now", "workstream": "criticality"}, indent=2) + "\n", encoding="utf-8")
        for w in l.get("workflows", [])[:1]:
            subprocess.run(["gh", "workflow", "run", w], cwd=root, capture_output=True, text=True)
    return res


def mantra_all(root=REPO, apply=False) -> list[dict]:
    flows = json.loads((Path(root) / "doctrine/flows.json").read_text(encoding="utf-8"))["flows"]
    return [tick_check(i, root, apply) for i in flows]


# ---------- predictions: every self-change predicts, the scorer grades, a miss files its revert ----------
PRED = re.compile(r"^(k|auto_verified|d1_load|ai_load|attention) (>|>=|<|<=) ([0-9.]+) within ([0-9]+) h$")


def predict(root, change: str, prediction: str, at=None) -> None:
    if not PRED.match(prediction):
        raise ValueError(f"prediction must read '<metric> <op> <number> within <N> h': {prediction!r}")
    with (Path(root) / LOG).open("a", encoding="utf-8") as f:
        f.write(json.dumps({"ev": "prediction", "at": (at or now()).isoformat(timespec="seconds"), "change": change, "prediction": prediction}) + "\n")


def grade(rec: dict, root=REPO, apply=False) -> list[dict]:
    """Grade every due, ungraded prediction against the headline day; a miss files a Q-CRIT-REVERT item that names the change."""
    p = Path(root) / LOG
    ev = [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()] if p.exists() else []
    done = {e["change"] + "|" + e["prediction"] for e in ev if e.get("ev") == "graded"}
    h, out = rec["headline"] or {}, []
    val = {"k": h.get("k"), "auto_verified": (h.get("deploys") or {}).get("auto_verified"), "d1_load": (h.get("spend") or {}).get("d1_load"),
           "ai_load": (h.get("spend") or {}).get("ai_load"), "attention": (h.get("attention") or {}).get("load")}
    for e in ev:
        if e.get("ev") != "prediction" or e["change"] + "|" + e["prediction"] in done:
            continue
        m = PRED.match(e["prediction"])
        if (now() - dt.datetime.fromisoformat(e["at"])).total_seconds() < int(m[4]) * 3600 or val[m[1]] is None:
            continue
        hit = {">": val[m[1]] > float(m[3]), ">=": val[m[1]] >= float(m[3]), "<": val[m[1]] < float(m[3]), "<=": val[m[1]] <= float(m[3])}[m[2]]
        out.append({"change": e["change"], "prediction": e["prediction"], "actual": val[m[1]], "hit": hit})
        if apply:
            with p.open("a", encoding="utf-8") as f:
                f.write(json.dumps({"ev": "graded", "at": rec["at"], "change": e["change"], "prediction": e["prediction"], "actual": val[m[1]], "hit": hit}) + "\n")
            if not hit:
                iid = "Q-CRIT-REVERT-" + re.sub(r"[^A-Z0-9]+", "-", e["change"].upper())[:40].strip("-")
                body = (f"**Owner:** executor\n**Trigger:** prediction missed: {e['prediction']} (actual {val[m[1]]}) for change {e['change']}\n**Done check:** cmd:python3 -m foundation criticality --probe output\n"
                        f"**Status:** open\n\nRevert or replace change {e['change']}: a remedy that did not move its metric is replaced, not repeated.\n\nsize: S\n\n**Closing probe:** cmd:python3 -m foundation criticality --probe output\n")
                (Path(root) / "docs/issues" / f"{iid}.json").write_text(json.dumps({"id": iid, "title": f"{iid}: revert {e['change']}", "body": body, "labels": ["p1", "agent-ready"], "milestone": "Now", "workstream": "criticality"}, indent=2) + "\n", encoding="utf-8")
    return out


# ---------- SERVER-OWNS-LOOPS-1 (Rowan, 2026-11-13): a client session never completes a loop; the server adopts every open pull request ----------
def adopt(c: dict, root=REPO, apply=False) -> list[dict]:
    """For every open pull request in the repos: mark it ready, start its checks, and merge it the moment checks are green. The session that opened it owns nothing."""
    out = []
    for repo in c["repos"]:
        try:
            prs = gh([f"repos/{repo}/pulls?state=open&per_page=50"], root)
        except RuntimeError as e:
            out.append({"repo": repo, "error": str(e)}); continue
        for pr in prs:
            n, ref = pr["number"], pr["head"]["ref"]
            runs = gh([f"repos/{repo}/actions/runs?branch={ref}&per_page=10&head_sha={pr['head']['sha']}"], root).get("workflow_runs", [])
            fin = [r for r in runs if r["status"] == "completed"]
            state = "no-checks" if not runs else "pending" if len(fin) < len(runs) else "green" if all(r["conclusion"] in ("success", "skipped") for r in fin) else "red"
            row = {"repo": repo, "pr": n, "branch": ref, "checks": state, "action": None}
            if apply:
                if pr.get("draft"):
                    subprocess.run(["gh", "pr", "ready", str(n), "-R", repo], cwd=root, capture_output=True, text=True); row["action"] = "ready"
                if state == "no-checks":
                    subprocess.run(["gh", "workflow", "run", "checks.yml" if "ultrastable" in repo else "pr-checks.yml", "-R", repo, "--ref", ref], cwd=root, capture_output=True, text=True); row["action"] = "checks-started"
                elif state == "green":
                    r = subprocess.run(["gh", "pr", "merge", str(n), "-R", repo, "--squash", "--delete-branch"], cwd=root, capture_output=True, text=True)
                    row["action"] = "merged" if r.returncode == 0 else "merge-refused: " + (r.stderr or r.stdout).strip()[:120]
                elif state == "red":
                    row["action"] = "red: the executor reads the failing check and pushes the fix (docs/issues item filed by the next run)"
            out.append(row)
    return out


def run(root=REPO, apply=False, cf_json=None) -> dict:
    c = cfg(root)
    inputs = gather(c, cf_json, root)
    sc = selfcomplete(c, root, apply)
    inputs["stale_items"] = sc["stale"]
    rec = score(inputs, c)
    prev = latest(root)
    filed = alert(rec, c, prev, root, apply)
    mm = mantra_all(root, apply)
    rec["graded"] = grade(rec, root, apply)
    rec["adopted"] = adopt(c, root, apply)
    if apply:
        predict(root, "criticality-" + rec["at"][:13], f"k > {max(h0['k'], 0.01) if (h0 := rec['headline']) else 0.01} within 24 h")
    rec["alerts"], rec["self_completion"] = filed, sc
    rec["mantra"] = {"text": MANTRA, "loops": len(mm), "failing": {x["loop"]: x["failed"] for x in mm if x["failed"]}}
    if apply:
        rec["stored"] = store(rec, root)
    return rec


def check(root=REPO) -> list[str]:
    c, bad = cfg(root), []
    for k in ("repos", "deploy_workflows", "budgets", "automated"):
        if not c.get(k):
            bad.append(f"{CFG}: {k} is empty")
    for k in ("d1_rows_read_per_day", "ai_neurons_per_day", "attention_per_day", "deploys_per_day"):
        if not c.get("budgets", {}).get(k):
            bad.append(f"{CFG}: budget {k} missing")
    # invariants of the score: more output raises k, more consumption lowers it, a day over budget is not critical at zero output
    base = score_day("t", {"auto": 5}, {"d1_rows_read": 1e8, "ai_neurons": 1e5}, 1, 1.0, c)
    if score_day("t", {"auto": 10}, {"d1_rows_read": 1e8, "ai_neurons": 1e5}, 1, 1.0, c)["k"] <= base["k"]:
        bad.append("score: more automated deploys must raise k")
    if score_day("t", {"auto": 5}, {"d1_rows_read": 3e8, "ai_neurons": 1e5}, 1, 1.0, c)["k"] >= base["k"]:
        bad.append("score: more spend must lower k")
    if score_day("t", {"auto": 0}, {"d1_rows_read": 1, "ai_neurons": 1}, 0, 1.0, c)["critical"]:
        bad.append("score: zero output must never be critical")
    cp, _ = coupling(root)
    if not 0 <= cp <= 1:
        bad.append("coupling outside 0..1")
    return bad


def main(argv: list[str]) -> int:
    if "--probe" in argv:
        f = argv[argv.index("--probe") + 1]
        rec = latest()
        if f not in FACTORS or not rec:
            print(f"no score yet or unknown factor {f}"); return 1
        ok = ok_factor(rec, f, cfg())
        print(f"{f} {'within budget' if ok else 'out of budget'} on {rec['headline']['day']}: k={rec['headline']['k']}")
        return 0 if ok else 1
    if "--mantra" in argv:
        r = tick_check(argv[argv.index("--mantra") + 1], apply="--apply" in argv)
        print(json.dumps(r)); return 1 if r["failed"] else 0
    if "--score" in argv:
        c = cfg()
        print(json.dumps(score(json.loads(Path(argv[argv.index("--score") + 1]).read_text(encoding="utf-8")), c), indent=1)); return 0
    if "--run" in argv:
        cf = argv[argv.index("--cf-json") + 1] if "--cf-json" in argv else None
        print(json.dumps(run(apply="--apply" in argv, cf_json=cf), indent=1)); return 0
    bad = check()
    print("\n".join(bad) or "criticality ok"); return 1 if bad else 0

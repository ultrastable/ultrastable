"""CLOCKWORK-1: every loop is a clock, and a clock that is stopped or inaccurate is not a working clock (owner directive 2026-11-12).

  python3 -m foundation clock --report     measured status of every clock in doctrine/clocks.json (needs GH_TOKEN and CLOUDFLARE_API_TOKEN for live reads)
  python3 -m foundation clock --chain      decide whether the executor should wake itself again now (prints yes or no with the reason; --apply dispatches it)
  python3 -m foundation clock --check      the declaration is complete

A clock has an expected interval and a source of beats. Status is measured, never declared: ticking (last beat within 1.5 x interval), late (within 3 x), stopped (older), and
idle when the clock has no work to do. Accuracy is the median distance of beats from their schedule. Self-chaining keeps the executor ticking between its daily cron: a run
that ends with takeable work left wakes the next one with the workflow's own token (workflow_dispatch from GITHUB_TOKEN does start a run), bounded per day by the data in
doctrine/clocks.json and by the Actions budget guard, and it backs off after repeated failures so a broken change cannot burn the month's minutes.
"""
from __future__ import annotations
import json, os, statistics, subprocess, sys, urllib.request, urllib.error
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/clocks.json"
GH = "ultrastable/ultrastable"


def load(root=REPO) -> dict:
    p = Path(root) / PATH
    return json.loads((p if p.is_file() else REPO / PATH).read_text(encoding="utf-8"))


def _ts(s: str) -> float:
    s = s.replace("Z", "+00:00").replace(" ", "T")
    d = datetime.fromisoformat(s)
    return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).timestamp()


def status(age_s: float | None, expected_s: float, idle: bool = False) -> str:
    if idle:
        return "idle"
    if age_s is None:
        return "stopped"
    return "ticking" if age_s <= 1.5 * expected_s else "late" if age_s <= 3 * expected_s else "stopped"


def jitter(beats: list[float], expected_s: float) -> float | None:
    """Median seconds by which an interval between consecutive beats misses the expected interval (smaller is more accurate)."""
    ds = [abs((b - a) - expected_s) for a, b in zip(beats, beats[1:])]
    return round(statistics.median(ds), 1) if ds else None


def measure(beats: list[float], expected_s: float, now: float, idle: bool = False, periodic: bool = True) -> dict:
    beats = sorted(beats)
    last = beats[-1] if beats else None
    age = round(now - last, 1) if last else None
    day = [b for b in beats if b >= now - 86400]
    return {"last_beat_age_s": age, "expected_interval_s": expected_s, "beats_24h": len(day), "expected_24h": round(86400 / expected_s, 1),
            "median_jitter_s": jitter(beats[-30:], expected_s) if periodic else None, "status": status(age, expected_s, idle)}


def _cf(path: str, body: dict, token: str, acct: str):
    req = urllib.request.Request(f"https://api.cloudflare.com/client/v4/accounts/{acct}/{path}", method="POST", data=json.dumps(body).encode(), headers={"authorization": "Bearer " + token, "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def d1_beats(c: dict, token: str, acct: str) -> list[float]:
    r = _cf(f"d1/database/{c['d1_id']}/query", {"sql": f"SELECT {c['column']} AS t FROM {c['table']} ORDER BY id DESC LIMIT {int(86400 // c['expected_interval_s']) + 12}"}, token, acct)
    return [_ts(x["t"]) for x in r["result"][0]["results"]]


def d1_beats_any(c: dict, token: str, acct: str) -> list[float]:
    """Beats from every replica of a d1 clock; the newest from any account counts. Raises only when no replica could be read."""
    reps = c.get("replicas") or [{"account_id": acct, "d1_id": c["d1_id"]}]
    out, errs = [], []
    for r in reps:
        try:
            out += d1_beats({**c, "d1_id": r["d1_id"]}, token, r.get("account_id") or acct)
        except Exception as e:  # one unreadable account is recorded and the others still count
            errs.append(f"{r['d1_id'][:8]}: {type(e).__name__}")
    if errs and len(errs) == len(reps):
        raise RuntimeError("no replica readable: " + ", ".join(errs))
    return out


def _dig(d, path: str):
    for k in path.split("."):
        d = d.get(k) if isinstance(d, dict) else None
    return d


def health_beats(c: dict, now: float) -> list[float]:
    """CLOCK-HEALTH-1: the credential-free route for a d1 clock. The Worker's own public /health states its newest beat, so a host with no
    Cloudflare token still measures the clock (five clocks read 'unmeasured' on /demo for that reason alone). Only the newest beat is known,
    so beats_24h from this route counts at most one."""
    h = c["health"]
    req = urllib.request.Request(h["url"], headers={"user-agent": "ultrastable-clock/1 (+https://ultrastable.io)", "accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = json.loads(r.read())
    except urllib.error.HTTPError as e:  # 503 still carries the JSON body (a late clock answers 503)
        body = json.loads(e.read() or b"{}")
    if h.get("at"):
        v = _dig(body, h["at"])
        if v is None:
            raise RuntimeError(f"/health has no {h['at']}")
        return [_ts(v) if isinstance(v, str) else float(v) / (1000 if float(v) > 1e11 else 1)]
    v = _dig(body, h["age_min"])
    if v is None:
        raise RuntimeError(f"/health has no {h['age_min']}")
    return [now - float(v) * 60]


def unmeasured(root=REPO) -> list[str]:
    """CLOCK-MEASURED-1: every clock in the published record has a real reading. An unmeasured clock is a finding, not a neutral state."""
    p = Path(root) / "ops" / "transparency.json"
    try:
        rows = json.loads(p.read_text(encoding="utf-8")).get("clocks") or []
    except (OSError, ValueError) as e:
        return [f"ops/transparency.json unreadable: {e}"]
    if not rows:
        return ["ops/transparency.json carries no clocks"]
    return [f"{r.get('id')}: unmeasured ({r.get('why') or 'no reason given'})" for r in rows if not r.get("status") or r.get("status") == "unmeasured"]


def gh_run_beats(workflow: str, root=REPO, events=None) -> list[float]:
    try:
        r = subprocess.run(["gh", "run", "list", "--repo", GH, "--workflow", workflow, "--limit", "60", "--json", "createdAt,event"], capture_output=True, text=True, timeout=60, encoding="utf-8")
        rows = json.loads(r.stdout or "[]")
    except (OSError, subprocess.SubprocessError, ValueError):
        return []
    return [_ts(x["createdAt"]) for x in rows if not events or x["event"] in events]


def takeable_count(root=REPO) -> int:
    try:
        from . import queue as qmod
        return len(qmod.takeable(root))
    except Exception:  # a broken queue must not hide the clocks
        return -1


def report(root=REPO, now: float | None = None, env=None) -> list[dict]:
    env, now, cfg, out = os.environ if env is None else env, now or datetime.now(timezone.utc).timestamp(), load(root), []
    tok, acct = env.get("CLOUDFLARE_API_TOKEN"), cfg.get("account_id")
    for c in cfg["clocks"]:
        row = {"id": c["id"], "what": c["what"], "source": c["source"]}
        try:
            if c["source"] == "d1":
                if tok:
                    beats = d1_beats_any(c, tok, acct)
                elif c.get("health"):
                    beats, row["route"] = health_beats(c, now), "health"
                else:
                    out.append({**row, "status": "unmeasured", "why": "no CLOUDFLARE_API_TOKEN on this host and no health route declared"}); continue
            elif c["source"] == "workflow":
                beats = gh_run_beats(c["workflow"], root, c.get("events"))
            else:
                out.append({**row, "status": "unmeasured", "why": "unknown source"}); continue
        except Exception as e:  # recorded: an unreadable clock is itself a finding
            out.append({**row, "status": "unmeasured", "why": type(e).__name__ + ": " + str(e)[:120]}); continue
        idle = bool(c.get("idle_when_no_work")) and takeable_count(root) == 0
        m = measure(beats, c["expected_interval_s"], now, idle, bool(c.get("periodic")))
        if c.get("event_driven") and m["status"] in ("late", "stopped"):
            m["status"] = "idle"  # woken by events (merges), so a quiet day is not a stopped clock
        out.append({**row, **m})
    return out


def should_chain(runs_last_24h: int, max_per_day: int, takeable: int, last_conclusions: list[str], backoff_after: int, budget_ok: bool = True) -> tuple[bool, str]:
    if not budget_ok:
        return False, "the Actions budget guard says pause"
    if takeable == 0:
        return False, "no takeable work left; the daily cron restarts the clock"
    if takeable < 0:
        return False, "the queue could not be read"
    if runs_last_24h >= max_per_day:
        return False, f"{runs_last_24h} runs in 24 h reached the cap of {max_per_day}"
    recent = last_conclusions[:backoff_after]
    if len(recent) >= backoff_after and all(x == "failure" for x in recent):
        return False, f"the last {backoff_after} runs failed; backing off until the next daily cron"
    return True, f"{takeable} takeable item(s), {runs_last_24h} of {max_per_day} runs used today"


BUSY_MAX_AGE_S = 45 * 60


def older_unfinished(rows: list[dict], run_id: str | None, now: float | None = None) -> list[dict]:
    """SPARK-BUSY-1: runs of the executor workflow that are not finished and were created before this one. The executor job holds one concurrency group,
    and GitHub keeps one pending job per group, cancelling the older pending one when a newer one queues: measured 2026-11-19, 9 of 15 runs ended
    `cancelled` that way, never having started. A spark or a chain dispatch while an older run is still queued or running adds nothing but a cancel.
    Only older runs count, so two sparks that start together do not both stand down."""
    me = next((r for r in rows if str(r.get("databaseId")) == str(run_id)), None) if run_id else None
    mine = _ts(me["createdAt"]) if me and me.get("createdAt") else (now if now is not None else datetime.now(timezone.utc).timestamp())
    def at(r):
        return _ts(r["createdAt"]) if r.get("createdAt") else mine
    # a run unfinished for longer than any executor run can take (spark 3 + job 12 minutes, plus queueing) is wedged, not busy, and does not hold the chain
    return [r for r in rows if r.get("status") != "completed" and str(r.get("databaseId")) != str(run_id) and mine - BUSY_MAX_AGE_S <= at(r) < mine]


NO_ATTEMPT = {"idle", "dry-run", "no-model-credential"}


def attempts_last_24h(rows: list[dict], now: float) -> int:
    """SPARK-CAP-1: the daily cap counts work, not wake-ups. Every finished lane wakes the executor workflow, and a wake-up that the spark gate turns
    away is still a workflow run, so counting runs let the gate's own refusals fill the cap (measured 2026-11-13: "20 runs in 24 h reached the cap of 4"
    with no attempt made). An attempt is a provenance row written on GitHub Actions that claimed an item."""
    n = 0
    for r in rows:
        try:
            recent = _ts(r.get("at") or "") >= now - 86400
        except ValueError:
            continue
        if recent and str(r.get("host", "")).startswith("github-actions") and r.get("issue") is not None and r.get("result") not in NO_ATTEMPT:
            n += 1
    return n


def wakes_last_hour(rows: list[dict], now: float) -> int:
    """SPARK-IDLE-1: executor workflow runs created in the last hour, whatever they did."""
    return len([x for x in rows if x.get("createdAt") and _ts(x["createdAt"]) >= now - 3600])


def daily_cap(cfg: dict, private: bool | None = None, boost: int = 1) -> tuple[int, str]:
    """PUBLIC-MINUTES-1: the cap of 4 builder runs a day exists to protect a private repository's Actions quota. Standard runners are free on a
    public repository, so there the cap is max_runs_per_day_public: a repository that went public kept starving its own builder at 4 items a day
    (2026-11-15: 160+ takeable items, 4 attempts a day). Visibility is read from GitHub; an unreadable answer keeps the private cap."""
    if private is None:
        try:
            r = subprocess.run(["gh", "api", f"repos/{GH}", "--jq", ".private"], capture_output=True, text=True, timeout=30, encoding="utf-8")
            private = None if r.returncode else r.stdout.strip() != "false"
        except (OSError, subprocess.SubprocessError):
            private = None
    # FLOW-BALANCE-1: chain() passes boost = _balance_boost(): when inflow outpaces closures, closure capacity rises (bounded by doctrine/balance.json boost.max)
    if private is False:
        return int(cfg.get("max_runs_per_day_public", cfg["max_runs_per_day"])) * boost, "public" + (f" x{boost} balance boost" if boost > 1 else "")
    return int(cfg["max_runs_per_day"]) * boost, ("private" if private else "unknown") + (f" x{boost} balance boost" if boost > 1 else "")


def _balance_boost(root=REPO) -> int:
    try:
        s = json.loads((Path(root) / "ops/balance.json").read_text(encoding="utf-8"))
        cap = json.loads((Path(root) / "doctrine/balance.json").read_text(encoding="utf-8"))["boost"]["max"]
        return max(1, min(int(s.get("closure_boost", 1)), int(cap)))
    except (OSError, ValueError, KeyError, TypeError):
        return 1


def chain(root=REPO, apply=False, now: float | None = None) -> dict:
    cfg, now = load(root)["chain"], now or datetime.now(timezone.utc).timestamp()
    try:
        r = subprocess.run(["gh", "run", "list", "--repo", GH, "--workflow", cfg["workflow"], "--limit", "20", "--json", "createdAt,conclusion,status,databaseId"], capture_output=True, text=True, timeout=60, encoding="utf-8")
        rows = json.loads(r.stdout or "[]")
    except (OSError, subprocess.SubprocessError, ValueError) as e:
        return {"chain": False, "why": "could not read the run history: " + str(e)[:100]}
    done = [x.get("conclusion") or "" for x in rows if x.get("status") == "completed"]
    try:
        from . import queue as qmod
        used = attempts_last_24h(qmod.executor_rows(root), now)
    except Exception as e:  # an unreadable log must not open the cap: fall back to the run count, which can only be higher
        used = len([x for x in rows if _ts(x["createdAt"]) >= now - 86400])
    cap, vis = daily_cap(cfg, boost=_balance_boost(root))  # FLOW-BALANCE-1
    ok, why = should_chain(used, cap, takeable_count(root), done, cfg["backoff_after_failures"])
    busy = older_unfinished(rows, os.environ.get("GITHUB_RUN_ID"), now)
    if ok and busy:
        ok, why = False, f"an older executor run ({busy[0].get('databaseId')}, {busy[0].get('status')}) is still queued or running; it takes the next item (SPARK-BUSY-1)"
    # SPARK-IDLE-1: the cap counts attempts, so a run whose gate refuses (agent PR cap, spend cap) made none and the chain re-woke itself about once a
    # minute with nothing to do (measured 2026-11-20: 1,149 executor runs in 14 h, "1 of 48 runs used"). Wake-ups are bounded per hour as well.
    wakes = wakes_last_hour(rows, now)
    if ok and wakes >= int(cfg.get("max_wakes_per_hour", 8)):
        ok, why = False, f"{wakes} executor wake-ups in the last hour reached the cap of {int(cfg.get('max_wakes_per_hour', 8))}; the next lane, deploy or cron restarts the clock (SPARK-IDLE-1)"
    res = {"chain": ok, "why": why, "attempts_24h": used, "cap": cap, "visibility": vis, "wakes_1h": wakes}
    if ok and apply:
        d = subprocess.run(["gh", "workflow", "run", cfg["workflow"] + ".yml", "--repo", GH], capture_output=True, text=True, timeout=60, encoding="utf-8")
        res["dispatched"] = d.returncode == 0
        if d.returncode:
            res["error"] = (d.stderr or d.stdout)[-200:]
    return res


def check(root=REPO) -> list[str]:
    bad, d = [], load(root)
    ids = [c["id"] for c in d["clocks"]]
    if len(ids) != len(set(ids)):
        bad.append("duplicate clock id")
    for c in d["clocks"]:
        for k in ("id", "what", "source", "expected_interval_s"):
            if not c.get(k):
                bad.append(f"clock {c.get('id')}: missing {k}")
        if c.get("source") == "d1" and not all(c.get(k) for k in ("d1_id", "table", "column")):
            bad.append(f"clock {c['id']}: d1 clock needs d1_id, table and column")
        if c.get("source") == "workflow" and not (REPO / ".github/workflows" / (c.get("workflow", "") + ".yml")).is_file():
            bad.append(f"clock {c['id']}: workflow {c.get('workflow')} does not exist")
    for sg in d.get("stages", []):
        if not sg.get("sla_s") or not sg.get("source"):
            bad.append(f"stage {sg.get('id')}: needs source and sla_s")
    if not d.get("escalation") or [x["missed"] for x in d["escalation"]] != sorted(x["missed"] for x in d["escalation"]):
        bad.append("escalation: ladder missing or not ordered by missed SLAs")
    if not d.get("settlement", {}).get("sla_hours"):
        bad.append("settlement: sla_hours missing")
    ch = d.get("chain", {})
    if not ch or ch.get("max_runs_per_day", 0) < 1 or ch.get("backoff_after_failures", 0) < 1:
        bad.append("chain needs max_runs_per_day and backoff_after_failures")
    return bad


def main(argv) -> int:
    a = list(argv)
    if "--report" in a:
        print(json.dumps(report(), indent=1))
        return 0
    if any(x in a for x in ("--stages", "--settlement", "--heal")):
        from . import clockwork
        if "--stages" in a:
            print(json.dumps(clockwork.stages(), indent=1))
        elif "--settlement" in a:
            print(json.dumps(clockwork.settlement(), indent=1))
        else:
            print(json.dumps(clockwork.heal(apply="--apply" in a), indent=1))
        return 0
    if "--measured" in a:
        bad = unmeasured()
        print("\n".join(bad) if bad else "every clock measured")
        return 1 if bad else 0
    if "--chain" in a:
        res = chain(apply="--apply" in a)
        print(json.dumps(res))
        return 0
    bad = check()
    print("\n".join(bad) if bad else "clock ok: " + ", ".join(c["id"] for c in load()["clocks"]))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

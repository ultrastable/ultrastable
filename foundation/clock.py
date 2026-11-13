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
import json, os, statistics, subprocess, sys, urllib.request
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
                if not tok:
                    out.append({**row, "status": "unmeasured", "why": "no CLOUDFLARE_API_TOKEN on this host"}); continue
                beats = d1_beats(c, tok, acct)
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


def chain(root=REPO, apply=False, now: float | None = None) -> dict:
    cfg, now = load(root)["chain"], now or datetime.now(timezone.utc).timestamp()
    try:
        r = subprocess.run(["gh", "run", "list", "--repo", GH, "--workflow", cfg["workflow"], "--limit", "20", "--json", "createdAt,conclusion,status"], capture_output=True, text=True, timeout=60, encoding="utf-8")
        rows = json.loads(r.stdout or "[]")
    except (OSError, subprocess.SubprocessError, ValueError) as e:
        return {"chain": False, "why": "could not read the run history: " + str(e)[:100]}
    done = [x.get("conclusion") or "" for x in rows if x.get("status") == "completed"]
    try:
        from . import queue as qmod
        used = attempts_last_24h(qmod.executor_rows(root), now)
    except Exception as e:  # an unreadable log must not open the cap: fall back to the run count, which can only be higher
        used = len([x for x in rows if _ts(x["createdAt"]) >= now - 86400])
    ok, why = should_chain(used, cfg["max_runs_per_day"], takeable_count(root), done, cfg["backoff_after_failures"])
    res = {"chain": ok, "why": why, "attempts_24h": used}
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
    if "--chain" in a:
        res = chain(apply="--apply" in a)
        print(json.dumps(res))
        return 0
    bad = check()
    print("\n".join(bad) if bad else "clock ok: " + ", ".join(c["id"] for c in load()["clocks"]))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

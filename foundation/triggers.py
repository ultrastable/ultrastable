"""TRIGGERS-1: time-driven and event-driven triggers as code. Ultrastable is the foundation for any autonomous system.

An autonomous system wakes two ways. TIME: a cron heartbeat on the host (Cloudflare worker cron) ticks every role at its own cadence
(tick_every x base interval). EVENT: a signed GitHub webhook (or repository_dispatch) wakes one role immediately. Both are data in
doctrine/triggers.json; the worker reads the generated table in seed/worker/src/events.js; GitHub workflow schedules are checked for drift.

  python3 -m foundation triggers --check    cron valid and within host limits; every role has a cadence and an event route; workflows registered; table fresh
  python3 -m foundation triggers --sync     regenerate the workflow register, the per-role wake routes and seed/worker/src/events.js
  python3 -m foundation triggers --install OWNER/REPO WORKER_URL [--apply]   register the signed webhook and the worker secret, no human-handled secret
  python3 -m foundation triggers --plan     each role's effective period and the cron the host will run
"""
from __future__ import annotations
import json, re
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/triggers.json"
EVENTS_JS = "seed/worker/src/events.js"
FIELD = re.compile(r"^(\*|\d+(-\d+)?)(/\d+)?(,(\*|\d+(-\d+)?)(/\d+)?)*$")
NAMES = re.compile(r"^(\*|[A-Za-z]{3}(-[A-Za-z]{3})?(,[A-Za-z]{3})*|\d+([-,]\d+)*)$")


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def seed_roles(root=REPO) -> dict:
    return {r["id"]: r for r in json.loads((Path(root) / "seed/ultrastable.json").read_text(encoding="utf-8"))["roles"]}


def cron_problem(expr: str):
    f = str(expr).split()
    if len(f) != 5:
        return f"{expr!r}: a cron has 5 fields"
    for i, (x, hi) in enumerate(zip(f, (59, 23, 31, 12, 7))):
        if not (FIELD.match(x) or (i >= 3 and NAMES.match(x))):
            return f"{expr!r}: bad field {x!r}"
        for n in re.findall(r"\d+", x.split("/")[0]):
            if int(n) > hi:
                return f"{expr!r}: {n} is out of range for field {i + 1}"
    return None


def _count(x, lo, hi) -> int:
    total = 0
    for part in x.split(","):
        rng, _, step = part.partition("/")
        step = int(step) if step else 1
        if rng == "*":
            a, b = lo, hi
        elif "-" in rng:
            a, b = (int(v) for v in rng.split("-"))
        else:
            a = int(rng)
            b = hi if "/" in part else a
        total += len(range(a, b + 1, step))
    return total


def fires_per_day(expr: str) -> int:
    m, h = str(expr).split()[:2]
    return _count(m, 0, 59) * _count(h, 0, 23)


def base_minutes(cron: str):
    m = re.match(r"^\*/(\d+) \* \* \* \*$", cron.strip())
    return int(m.group(1)) if m else None


def plan(root=REPO) -> dict:
    t, roles = load(root), seed_roles(root)
    b = base_minutes(t["heartbeat"]["cron"]) or 0
    return {"cron": t["heartbeat"]["cron"], "base_minutes": b,
            "roles": {rid: {"every_ticks": r.get("tick_every", 1), "period_minutes": r.get("tick_every", 1) * b} for rid, r in sorted(roles.items())}}


def scan_workflows(root=REPO) -> dict:
    import yaml
    out = {}
    for f in sorted((Path(root) / ".github/workflows").glob("*.yml")):
        doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        on = doc.get("on", doc.get(True, {}))
        ev = sorted(on) if isinstance(on, dict) else sorted(on if isinstance(on, list) else [on])
        sched = [s["cron"] for s in (on.get("schedule") or [])] if isinstance(on, dict) else []
        out[f.name] = {"events": [e for e in ev if e != "schedule"], "crons": sorted(sched)}
    return out


def wake_rows(roles) -> list:
    return [{"id": f"wake-{r}", "event": "repository_dispatch", "actions": [f"wake:{r}"], "role": r, "why": "any agent, script or webhook can wake this role now"} for r in sorted(roles)]


def table(root=REPO) -> list:
    return load(root)["events"] + wake_rows(seed_roles(root))


def render_js(root=REPO) -> str:
    src = (Path(root) / EVENTS_JS).read_text(encoding="utf-8")
    rows = [{k: v for k, v in e.items() if k in ("id", "event", "actions", "when", "role")} for e in table(root)]
    body = "export const EVENT_TABLE = " + json.dumps(rows, indent=2) + ";"
    return re.sub(r"export const EVENT_TABLE = \[.*?\];", lambda _: body, src, count=1, flags=re.S)


def sync(root=REPO) -> dict:
    root = Path(root)
    t = load(root)
    t["workflows"] = scan_workflows(root)
    (root / PATH).write_text(json.dumps(t, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    (root / EVENTS_JS).write_text(render_js(root), encoding="utf-8")
    return {"workflows": len(t["workflows"]), "event_rows": len(table(root))}


def check(root=REPO) -> list:
    root, bad = Path(root), []
    t, roles = load(root), seed_roles(root)
    hb, host = t["heartbeat"], t["host_limits"]
    p = cron_problem(hb["cron"])
    if p:
        bad.append(f"heartbeat: {p}")
    b = base_minutes(hb["cron"])
    if not b:
        bad.append("heartbeat: must be a '*/N * * * *' interval so role cadences are whole multiples of it")
    else:
        if b < host["min_interval_minutes"]:
            bad.append(f"heartbeat: {b} min is faster than the host allows ({host['min_interval_minutes']})")
        if 1440 // b > host["max_ticks_per_day"]:
            bad.append(f"heartbeat: {1440 // b} ticks/day exceeds the budget of {host['max_ticks_per_day']}")
        for rid, r in roles.items():
            per = r.get("tick_every", 1) * b
            if per > host["max_role_period_minutes"]:
                bad.append(f"{rid}: wakes every {per} min, slower than the {host['max_role_period_minutes']} min ceiling (a role must not starve)")
    seed_cron = json.loads((root / "seed/ultrastable.json").read_text(encoding="utf-8"))["runtime"]["tick_cron"]
    if seed_cron != hb["cron"]:
        bad.append(f"seed/ultrastable.json runtime.tick_cron {seed_cron!r} differs from the heartbeat {hb['cron']!r}")
    for e in t["events"]:
        if e.get("role") not in roles:
            bad.append(f"event {e.get('id')}: role {e.get('role')!r} is not a role in seed/ultrastable.json")
        for f in ("id", "event", "role", "why"):
            if not e.get(f):
                bad.append(f"event {e.get('id', '?')}: lacks {f}")
    ids = [e["id"] for e in table(root)]
    for i in sorted({x for x in ids if ids.count(x) > 1}):
        bad.append(f"event id {i} defined twice")
    live, reg = scan_workflows(root), t.get("workflows", {})
    for name, w in live.items():
        if name not in reg:
            bad.append(f"workflow {name}: not in the trigger register (run triggers --sync)")
        elif reg[name] != w:
            bad.append(f"workflow {name}: triggers drifted from the register (run triggers --sync)")
        for c in w["crons"]:
            q = cron_problem(c)
            if q:
                bad.append(f"workflow {name}: {q}")
            elif fires_per_day(c) > t["workflow_max_fires_per_day"]:
                bad.append(f"workflow {name}: cron {c!r} fires {fires_per_day(c)}x/day (private-repo minutes; the heartbeat worker does fast cadences)")
    for name in sorted(set(reg) - set(live)):
        bad.append(f"register lists workflow {name} that no longer exists (run triggers --sync)")
    if (root / EVENTS_JS).read_text(encoding="utf-8") != render_js(root):
        bad.append(f"{EVENTS_JS} is stale against the register (run triggers --sync)")
    for rid in roles:
        if not any(e["role"] == rid for e in table(root)):
            bad.append(f"{rid}: no event route")
    return bad


def main(argv) -> int:
    import argparse
    ap = argparse.ArgumentParser(prog="foundation triggers")
    ap.add_argument("--check", action="store_true"); ap.add_argument("--sync", action="store_true"); ap.add_argument("--plan", action="store_true")
    ap.add_argument("--install", nargs=2, metavar=("REPO", "WORKER_URL")); ap.add_argument("--apply", action="store_true")
    a = ap.parse_args(argv)
    if a.install:
        print(json.dumps(install(a.install[0], a.install[1], apply=a.apply), indent=1)); return 0
    if a.sync:
        print(json.dumps(sync(), indent=1)); return 0
    if a.plan:
        print(json.dumps(plan(), indent=1)); return 0
    bad = check()
    print("triggers ok" if not bad else "\n".join(bad))
    return 1 if bad else 0


def install(repo: str, url: str, worker_dir: str = "seed/worker", apply: bool = False) -> dict:
    """Wire the event trigger end to end with no human-handled secret: mint a webhook secret in memory, register it on the GitHub repo and
    store it as the worker's GITHUB_WEBHOOK_SECRET. Dry-run unless apply=True. The secret is never printed, logged or written to a file."""
    import secrets, subprocess
    steps = [f"gh api repos/{repo}/hooks (POST, events: {sorted({e['event'] for e in load()['events']} - {'repository_dispatch'})}, url {url.rstrip('/')}/hook/github)",
             f"wrangler secret put GITHUB_WEBHOOK_SECRET (in {worker_dir})"]
    if not apply:
        return {"applied": False, "steps": steps}
    secret = secrets.token_hex(32)
    events = sorted({e["event"] for e in load()["events"] if e["event"] != "repository_dispatch"})
    body = json.dumps({"name": "web", "active": True, "events": events, "config": {"url": url.rstrip("/") + "/hook/github", "content_type": "json", "secret": secret}})
    out = []
    for argv, data in ((["gh", "api", f"repos/{repo}/hooks", "--input", "-"], body), (["wrangler", "secret", "put", "GITHUB_WEBHOOK_SECRET"], secret)):
        r = subprocess.run(argv, input=data, capture_output=True, text=True, cwd=REPO / worker_dir if argv[0] == "wrangler" else REPO)
        out.append({"cmd": " ".join(argv[:3]), "exit": r.returncode, "error": (r.stderr or "")[-200:].replace(secret, "***") if r.returncode else ""})
    ok = all(o["exit"] == 0 for o in out)
    if ok:
        m = REPO / "ops/loop-evidence/webhook-installed.json"
        m.write_text(json.dumps({"repo": repo, "url": url.rstrip("/") + "/hook/github", "events": events}) + "
", encoding="utf-8")
    return {"applied": True, "ok": ok, "steps": out}

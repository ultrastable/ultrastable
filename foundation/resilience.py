# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""RESILIENCE-1: every clock keeps ticking, and a stalled one is restarted by the system. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation resilience [--run [--apply] | --report | --check]

A clock that stops is the failure QNFO's fleet lost days to: red checks and a silent scheduler stopped the process and nothing noticed. This module is the
shared primitive that makes a stall a recorded event with an automatic remedy.

  CLOCKS       doctrine/clocks.json (tick, executor, ...) plus EVERY scheduled workflow, whose expected interval is derived from its own cron, so a new
               workflow is covered the day it is written (no list to forget).
  PROBE        each clock's newest beat gives one verdict: ticking, late, stopped (older than `stalled_after_intervals` intervals), idle or unmeasured.
               Unmeasured is never read as healthy and never restarted (there is nothing to prove it stopped).
  RESTART      a stopped clock is restarted by its route: a workflow is dispatched (workflow_dispatch), the Worker tick is woken through POST /pulse/watch on
               each independent account in turn. Bounded: `max_restarts_per_clock_per_day`, `max_restarts_per_run`, the Actions kill switch and HALT-1 win.
  ESCALATE     a restart that did not take `escalate_after_failed_restarts` times files Q-STALL-<clock> (owner executor, probe: this module's --probe).
  WATCHERS     doctrine/resilience.json `watchers`: every watcher has a different watcher that restarts it (GitHub watchdog <-> Worker watchdog loop), so no
               watcher is a single point of failure; `--check` fails a watcher watched by itself or by nobody.
  VARIABLE     the newest `beat` row (stalled count, unmeasured count) is the essential variable `stalled_clocks` in foundation/ultrastability.py; a beat older
               than `beat_fresh_s` reads as unmeasured, so the watchdog going silent is itself out of bounds.
Every probe, restart and escalation is a row in ops/resilience.jsonl. Tests: tests/foundation/test_resilience.py.
"""
from __future__ import annotations
import json, re, subprocess, sys, urllib.error, urllib.request
from datetime import datetime, timezone
from pathlib import Path

from . import clock as C, ledger

REPO = C.REPO
PATH = "doctrine/resilience.json"


def load(root=REPO) -> dict:
    p = Path(root) / PATH
    return json.loads((p if p.is_file() else REPO / PATH).read_text(encoding="utf-8"))


def _now() -> float:
    return datetime.now(timezone.utc).timestamp()


def _iso(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def cron_interval_s(expr: str) -> int | None:
    """Seconds between runs of a 5-field cron (the longest gap a person would call the cadence): */N minutes, hourly, daily, weekly, monthly."""
    f = expr.split()
    if len(f) != 5:
        return None
    mi, h, dom, mon, dow = f
    m = re.fullmatch(r"\*/(\d+)", mi)
    if m and h == "*":
        return int(m[1]) * 60
    if h == "*":
        return 3600
    m = re.fullmatch(r"\*/(\d+)", h)
    if m:
        return int(m[1]) * 3600
    if "," in h:
        n = len(h.split(","))
        return 86400 // n
    if dom != "*":
        return 30 * 86400
    if dow != "*":
        return 7 * 86400 // max(1, len(dow.split(",")))
    return 86400


def scheduled_workflows(root=REPO) -> list[dict]:
    """Every workflow with a cron: {workflow, expected_interval_s, dispatchable}. The interval is the shortest of its crons."""
    out = []
    for f in sorted((Path(root) / ".github/workflows").glob("*.yml")):
        t = f.read_text(encoding="utf-8")
        crons = re.findall(r"""^\s*-\s*cron:\s*["']([^"']+)["']""", t, re.M)
        ivs = [i for i in map(cron_interval_s, crons) if i]
        if ivs:
            out.append({"workflow": f.stem, "expected_interval_s": min(ivs), "dispatchable": bool(re.search(r"^\s*workflow_dispatch:", t, re.M))})
    return out


def derived_clocks(root=REPO) -> list[dict]:
    """A clock for every scheduled workflow that doctrine/clocks.json does not already declare."""
    declared = {c.get("workflow") for c in C.load(root)["clocks"] if c["source"] == "workflow"}
    return [{"id": "wf:" + w["workflow"], "what": f"scheduled workflow {w['workflow']} (interval derived from its cron)", "source": "workflow", "workflow": w["workflow"],
             "expected_interval_s": w["expected_interval_s"], "periodic": False, "derived": True, "dispatchable": w["dispatchable"]}
            for w in scheduled_workflows(root) if w["workflow"] not in declared]


def all_clocks(root=REPO) -> list[dict]:
    wf = {w["workflow"]: w for w in scheduled_workflows(root)}
    declared = [{**c, "dispatchable": wf.get(c.get("workflow"), {}).get("dispatchable", (Path(root) / ".github/workflows" / (c.get("workflow", "") + ".yml")).is_file())} for c in C.load(root)["clocks"]]
    return declared + derived_clocks(root)


def probe(clock: dict, now: float, beats_of, cfg: dict) -> dict:
    """One clock's verdict from its beats. `beats_of(clock) -> list[epoch] | None` (None: cannot be read from here)."""
    beats = beats_of(clock)
    if beats is None:
        return {"id": clock["id"], "status": "unmeasured", "why": "beats not readable from this host"}
    last = max(beats) if beats else None
    age = None if last is None else round(now - last, 1)
    exp = clock["expected_interval_s"]
    if age is None:
        st = "stopped"  # a clock with no beat at all was never started
    elif age <= 1.5 * exp:
        st = "ticking"
    elif age <= float(clock.get("stalled_after_intervals", cfg["stalled_after_intervals"])) * exp:
        st = "late"  # a clock may set a tighter bound than the default: a weekly loop cannot wait three weeks for its restart
    else:
        st = "stopped"
    if clock.get("idle_when_no_work") and st != "ticking" and C.takeable_count() == 0:
        st = "idle"
    if clock.get("event_driven") and st in ("late", "stopped"):
        st = "idle"
    return {"id": clock["id"], "status": st, "last_beat_age_s": age, "expected_interval_s": exp}


def health_beats(urls, fetch=None):
    """Beats from public /health endpoints (no credential): last_tick.started_at of each that answers. None when none answered."""
    fetch = fetch or _get_json
    out, answered = [], False
    for u in urls:
        j = fetch(u)
        if not isinstance(j, dict):
            continue
        answered = True
        at = (j.get("last_tick") or {}).get("started_at")
        if at:
            out.append(C._ts(at))
    return out if answered else None


def _get_json(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"user-agent": "ultrastable-watchdog"}), timeout=30) as r:
            return json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:  # /health answers 503 with a body when the last tick did not complete; that body still carries last_tick
        try:
            return json.loads(e.read() or b"null")
        except ValueError:
            return None
    except (OSError, ValueError):
        return None


def run_beats(clock: dict, runs: list[dict]) -> list[float]:
    """Beats of a workflow clock from its runs. WORK-NOT-PULSE-1: a clock that declares `"beat": "success"` beats only on a run that succeeded (or is
    still running, so a restart in flight is not restarted again); a run that started and failed did no work and is not a beat. The scout ran on
    2026-11-24, a later step failed, nothing was committed, and the clock still read ticking: that is the failure this closes."""
    if clock.get("beat") != "success":
        return [C._ts(x["createdAt"]) for x in runs]
    return [C._ts(x["createdAt"]) for x in runs if x.get("conclusion") == "success" or x.get("status") in ("queued", "in_progress", "waiting", "requested", "pending")]


def _gh_beats(clock, root=REPO, fetch=None):
    import os
    if clock["source"] == "d1":
        beats, read = health_beats(clock.get("health_urls", []), fetch), False
        read = beats is not None
        beats = beats or []
        tok = os.environ.get("CLOUDFLARE_API_TOKEN")
        if tok:
            try:
                beats += C.d1_beats_any(clock, tok, C.load(root).get("account_id"))
                read = True
            except Exception as e:  # unreadable database: the health URLs may still have answered; the failure is printed, never swallowed
                print(f"resilience: d1 beats unreadable: {type(e).__name__}: {str(e)[:160]}", file=sys.stderr)
        return beats if read else None
    if clock["source"] == "workflow":
        try:
            r = subprocess.run(["gh", "run", "list", "--repo", C.GH, "--workflow", clock["workflow"], "--limit", "60", "--json", "createdAt,event,status,conclusion"], capture_output=True, text=True, timeout=60, encoding="utf-8")
            if r.returncode:
                return None  # gh could not read (no token, API error): unmeasured, never a stall and never healthy
            return run_beats(clock, json.loads(r.stdout or "[]"))
        except (OSError, subprocess.SubprocessError, ValueError, KeyError):
            return None
    return None


def http_poke(url: str, timeout=45):
    req = urllib.request.Request(url, method="POST", headers={"user-agent": "ultrastable-watchdog"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except (OSError, ValueError):
        return 0


def http_get(url: str, timeout=30) -> int:
    req = urllib.request.Request(url, headers={"user-agent": "ultrastable-watchdog"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except (OSError, ValueError):
        return 0


def gh_dispatch_repo(repo: str, workflow: str) -> tuple[bool, str]:
    r = subprocess.run(["gh", "workflow", "run", workflow + ".yml", "--repo", repo], capture_output=True, text=True, timeout=60, encoding="utf-8")
    return r.returncode == 0, (r.stderr or r.stdout).strip()[-160:]


def site_probes(cfg, rows, now, apply, halted, get=http_get, dispatch=gh_dispatch_repo) -> list[dict]:
    """A public site that answers anything but 200 (a 503 is the case that happened) is redeployed by its own deploy workflow, bounded per day; every probe is a ledger row."""
    out = []
    for sp in cfg.get("site_probes", []):
        st = get(sp["url"])
        rec = {"at": _iso(now), "kind": "site", "site": sp["id"], "status": st, "ok": st == 200}
        if st != 200 and apply and not halted:
            day = [r for r in rows if r.get("kind") == "site" and r.get("site") == sp["id"] and r.get("redeploy") and r["at"] >= _iso(now - 86400)]
            if len(day) < cfg["max_restarts_per_clock_per_day"] * 2:
                ok, d = dispatch(sp["repo"], sp["workflow"])
                rec.update({"redeploy": True, "dispatch_ok": ok, "detail": d})
        out.append(rec)
    return out


def gh_dispatch(workflow: str, root=REPO) -> tuple[bool, str]:
    r = subprocess.run(["gh", "workflow", "run", workflow + ".yml", "--repo", C.GH], capture_output=True, text=True, timeout=60, encoding="utf-8")
    return r.returncode == 0, (r.stderr or r.stdout).strip()[-160:]


def _halted(root) -> str | None:
    try:
        if json.loads((Path(root) / "ops/halt.json").read_text(encoding="utf-8")).get("halt"):
            return "ops/halt.json"
    except (OSError, ValueError):
        pass
    return None


def repo_is_public(repo: str | None = None) -> bool:
    """True only when GitHub says the repository is public; an unreadable answer is not public (the pause stays in force)."""
    try:
        r = subprocess.run(["gh", "api", "repos/" + (repo or C.GH), "--jq", ".private"], capture_output=True, text=True, timeout=30, encoding="utf-8")
    except (OSError, subprocess.SubprocessError):
        return False
    return r.returncode == 0 and r.stdout.strip() == "false"


def _paused(root, public=None) -> set:
    """Workflows the Actions budget pauses. The budget guards private-repo minutes: scripts/actions_guard.py lets every workflow of a public repository
    run, so the watchdog applies the same exemption (PAUSE-PARITY-1). Before this, `paused: true` (set by the budget loop on 2026-11-23) made the watchdog
    skip the restart of every workflow clock while the workflows themselves were allowed to run. `public` is injected in tests; None asks GitHub."""
    try:
        b = json.loads((Path(root) / "actions-budget.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return set()
    out = {"*"} if b.get("paused") else set(b.get("paused_workflows", []))
    if out and (repo_is_public() if public is None else public):
        return set()
    return out


def restart(clock: dict, cfg: dict, root=REPO, poke=http_poke, dispatch=gh_dispatch) -> dict:
    """Try the clock's restart route. Returns {'ok': bool, 'route': str, 'detail': str}."""
    route = cfg["restart_routes"].get(clock["id"])
    if route and route["kind"] == "http":
        tried = []
        for u in route["urls"]:  # each URL is an independent account/host: the first that answers 200 restarts it
            st = poke(u)
            tried.append(f"{u.split('/')[2]}={st}")
            if st == 200:
                return {"ok": True, "route": "http", "detail": ", ".join(tried)}
        return {"ok": False, "route": "http", "detail": ", ".join(tried)}
    if clock["source"] == "workflow" and clock.get("dispatchable"):
        ok, d = dispatch(clock["workflow"], root)
        return {"ok": ok, "route": "workflow_dispatch", "detail": d}
    return {"ok": False, "route": "none", "detail": "no restart route: the clock is not dispatchable and has no http route"}


def _item(root, cfg, clock, verdict, fails) -> str:
    iid = f"{cfg['item_prefix']}-{re.sub(r'[^A-Za-z0-9_-]+', '-', clock['id'])}"
    p = Path(root) / "docs/issues" / (iid + ".json")
    if not p.exists():
        body = (f"**Owner:** executor\n**Trigger:** clock `{clock['id']}` stopped (last beat age {verdict.get('last_beat_age_s')} s, expected every {clock['expected_interval_s']} s) and {fails} restarts did not take\n"
                f"**Done check:** cmd:python3 -m foundation resilience --probe {clock['id']}\n**Status:** open\n\nRESILIENCE-1: find why the clock stopped (disabled schedule, failing job, dead route), "
                f"fix the cause, and add a second independent trigger so it cannot stop silently again. Escalated through the queue, never by email.\n\nsize: M\n\n**Closing probe:** `python3 -m foundation resilience --probe {clock['id']}` reports ticking.\n")
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps({"id": iid, "title": f"{iid}: clock {clock['id']} stopped and restarts did not take", "body": body, "labels": ["p0", "agent-ready"], "milestone": "Now", "workstream": "Resilience"}, indent=2) + "\n", encoding="utf-8")
    return iid


def run(root=REPO, apply=False, now=None, beats_of=None, poke=http_poke, dispatch=gh_dispatch, get=None, public=None) -> dict:
    """One watchdog pass: probe every clock, restart the stopped ones within bounds, escalate the stubborn ones, write the beat."""
    root, cfg = Path(root), load(root)
    now = now or _now()
    injected = beats_of is not None
    beats_of = beats_of or (lambda c: _gh_beats(c, root))
    rows = ledger.rows(root, cfg["ledger"]) if apply else ledger.rows(root, cfg["ledger"], branch=False)
    out = {"at": _iso(now), "clocks": [], "restarts": [], "escalated": [], "skipped": []}
    halted, paused = _halted(root), _paused(root, (False if injected else None) if public is None else public)  # injected beats mean a test: never ask GitHub
    new = []
    for clock in all_clocks(root):
        v = probe(clock, now, beats_of, cfg)
        out["clocks"].append(v)
        route = cfg["restart_routes"].get(clock["id"], {})
        if v["status"] != "stopped" and not (v["status"] == "unmeasured" and route.get("idempotent")):
            continue  # an idempotent wake (the tick's /pulse/watch runs a tick only when stale) is safe to send when the beat cannot be read
        why = None
        if halted:
            why = f"halt ({halted})"
        elif "*" in paused or clock.get("workflow") in paused:
            why = "paused by actions-budget.json"
        elif len(out["restarts"]) >= cfg["max_restarts_per_run"]:
            why = "max_restarts_per_run reached"
        else:
            day = [r for r in rows if r.get("kind") == "restart" and r.get("clock") == clock["id"] and r["at"] >= _iso(now - 86400)]
            if len(day) >= cfg["max_restarts_per_clock_per_day"]:
                why = f"{len(day)} restarts in 24 h reached the cap"
        if why:
            out["skipped"].append({"id": clock["id"], "why": why})
            continue
        res = restart(clock, cfg, root, poke, dispatch) if apply else {"ok": None, "route": "dry-run", "detail": "not applied"}
        rec = {"at": out["at"], "kind": "restart", "clock": clock["id"], "age_s": v.get("last_beat_age_s"), **res}
        out["restarts"].append(rec)
        new.append(rec)
        # a route that answers 200 has not proved the clock restarted: the clock is still stopped now, so every restart in this stall counts against it
        recent = [r for r in rows + new if r.get("kind") == "restart" and r.get("clock") == clock["id"] and r["at"] >= _iso(now - 86400)]
        if apply and len(recent) > cfg["escalate_after_failed_restarts"]:
            out["escalated"].append(_item(root, cfg, clock, v, len(recent) - 1))
    sites = site_probes(cfg, rows, now, apply, halted, get=get or http_get) if (get or poke is http_poke) else []
    out["sites"] = sites
    new.extend(r for r in sites if not r["ok"])  # only a failing probe is a ledger row; a healthy site adds no noise
    stalled = [c["id"] for c in out["clocks"] if c["status"] == "stopped"]
    unmeasured = [c["id"] for c in out["clocks"] if c["status"] == "unmeasured"]
    beat = {"at": out["at"], "kind": "beat", "clocks": len(out["clocks"]), "stalled": len(stalled), "unmeasured": len(unmeasured), "stalled_ids": stalled}
    out["beat"] = beat
    prev = next((r for r in reversed(rows) if r.get("kind") == "beat"), None)
    out["changed"] = bool(new or out["escalated"]) or prev is None or prev.get("stalled_ids") != stalled or out["at"][:10] != prev["at"][:10]
    if apply:
        for i, r in enumerate(new + [beat]):
            r["seq"] = len(rows) + i
        ledger.append(root, cfg["ledger"], new + [beat])
    return out


def stalled_reading(root=REPO, now=None):
    """The essential variable: stalled clocks at the newest beat, or None (unmeasured) when there is no beat fresher than `beat_fresh_s`."""
    cfg = load(root)
    beats = [r for r in ledger.rows(root, cfg["ledger"], branch=False) if r.get("kind") == "beat"]
    if not beats:
        return None
    last = beats[-1]
    t = datetime.fromisoformat(last["at"].replace("Z", "+00:00")).timestamp()
    return last["stalled"] if (now or _now()) - t <= cfg["beat_fresh_s"] else None


def check(root=REPO) -> list[str]:
    root, errs = Path(root), []
    cfg = load(root)
    for k in ("ledger", "item_prefix", "stalled_after_intervals", "max_restarts_per_clock_per_day", "max_restarts_per_run", "escalate_after_failed_restarts", "beat_fresh_s", "restart_routes", "watchers"):
        if k not in cfg:
            errs.append("missing " + k)
    if errs:
        return errs
    ids = {w["id"] for w in cfg["watchers"]}
    for w in cfg["watchers"]:
        for k in ("watched_by", "restarted_by"):
            if w.get(k) not in ids:
                errs.append(f"watcher {w['id']}: {k} {w.get(k)!r} is not a watcher")
            elif w[k] == w["id"]:
                errs.append(f"watcher {w['id']}: {k} itself, which is a single point of failure")
        if w.get("watched_by") in ids and next(x for x in cfg["watchers"] if x["id"] == w["watched_by"]).get("host") == w.get("host") and w.get("host") == "github-actions":
            errs.append(f"watcher {w['id']} is watched only from the same host")
        if w.get("workflow") and not (root / ".github/workflows" / (w["workflow"] + ".yml")).is_file():
            errs.append(f"watcher {w['id']}: workflow {w['workflow']} does not exist")
        if w.get("loop") and not re.search(re.escape(w["loop"]), (root / "seed/worker/src/pulse.js").read_text(encoding="utf-8")):
            errs.append(f"watcher {w['id']}: loop {w['loop']!r} is not declared in seed/worker/src/pulse.js")
    for sp in cfg.get("site_probes", []):
        for k in ("id", "url", "repo", "workflow"):
            if not sp.get(k):
                errs.append(f"site probe {sp.get('id')}: missing {k}")
    hosts = {w["host"] for w in cfg["watchers"]}
    if len(hosts) < 2:
        errs.append("watchers run on one host only; a watcher needs a watcher on an independent host")
    clock_ids = {c["id"] for c in C.load(root)["clocks"]}
    for cid, route in cfg["restart_routes"].items():
        if cid not in clock_ids:
            errs.append(f"restart route for unknown clock {cid}")
        if route.get("kind") == "http" and len(route.get("urls", [])) < 2:
            errs.append(f"restart route {cid}: needs at least two independent URLs")
    for c in all_clocks(root):
        if c["source"] == "workflow" and not c.get("dispatchable") and c["id"] not in cfg["restart_routes"] and not c.get("event_driven"):
            errs.append(f"clock {c['id']}: workflow {c['workflow']} has no workflow_dispatch trigger, so a stall cannot be restarted")
        if c["source"] == "d1" and c["id"] not in cfg["restart_routes"]:
            errs.append(f"clock {c['id']}: a d1 clock needs a restart route in {PATH}")
    wd = (root / ".github/workflows/watchdog.yml")
    if not wd.is_file():
        errs.append(".github/workflows/watchdog.yml is missing: the GitHub-side watchdog")
    else:
        t = wd.read_text(encoding="utf-8")
        for need in ("schedule:", "workflow_dispatch", "foundation resilience --run --apply", "timeout-minutes", "vars.HALT"):
            if need not in t:
                errs.append(f"watchdog.yml lacks {need}")
    return errs


def main(argv=None) -> int:
    a = argv if argv is not None else sys.argv[1:]
    if "--check" in a:
        e = check()
        print("\n".join(e) or "resilience ok: every clock has a probe and a restart route, every watcher is watched by an independent one")
        return 1 if e else 0
    if "--probe" in a:
        cid = a[a.index("--probe") + 1]
        r = run(apply=False)
        row = next((c for c in r["clocks"] if c["id"] == cid), None)
        print(json.dumps(row))
        return 0 if row and row["status"] in ("ticking", "late", "idle") else 1
    if "--report" in a or "--run" in a:
        r = run(apply="--apply" in a and "--run" in a)
        print(json.dumps(r, indent=1))
        if "--changed-file" in a:  # the workflow commits the ledger only when something changed, so its own commit never feeds back into a run
            Path(a[a.index("--changed-file") + 1]).write_text("1" if r["changed"] else "0", encoding="utf-8")
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())

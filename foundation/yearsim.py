# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""YEAR-SIM-1: a year of faults injected into the system's own recovery code; the measured unattended horizon. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation yearsim --run [--apply]     drill every fault class against real code, simulate `runs` seeded years, write ops/yearsim.json,
                                                    append ops/yearsim.jsonl, regenerate site/yearsim-data.js and file Q-YEAR-SIM-* for each finding
  python3 -m foundation yearsim --drill [ID]        run the drills only (all, or one fault class) and print what each exercised
  python3 -m foundation yearsim --probe ID          closing probe of a Q-YEAR-SIM item: the class's drill recovers without a person (exit 0)
  python3 -m foundation yearsim --fix-node [--apply]  rewrite every workflow node-version pin to the current LTS in doctrine/yearsim.json (no model)
  python3 -m foundation yearsim --check             doctrine/yearsim.json is well formed and site/yearsim-data.js matches ops/yearsim.json

A drill returns {mode: recovers|degrades|fatal, capacity: 0..1 while the fault lasts, recover: bool, exercised: bool, evidence}. The simulation
multiplies the capacities of the faults active on a day (a fault that does not recover keeps its capacity as a permanent factor), and a year ends
on the first day release capacity stays under fatal_floor for fatal_after_days. Strict mode assumes every identity gate in doctrine/unattended.json
fails on first use. The release horizon is the survival horizon only while the server itself is originating changes (measured from git), else 0.
Data: doctrine/yearsim.json. Tests: tests/foundation/test_yearsim.py."""
from __future__ import annotations
import datetime as dt, json, math, os, random, re, shutil, subprocess, sys, tempfile, urllib.error
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CONF = "doctrine/yearsim.json"
DATA = "site/yearsim-data.js"


def cfg(root=REPO) -> dict:
    return json.loads((Path(root) / CONF).read_text(encoding="utf-8"))


def deps(root=REPO) -> dict:
    try:
        return {d["id"]: d for d in json.loads((Path(root) / "doctrine/unattended.json").read_text(encoding="utf-8"))["dependencies"]}
    except (OSError, ValueError, KeyError):
        return {}


def R(mode, capacity, recover, exercised, evidence, **kw) -> dict:
    return {"mode": mode, "capacity": round(float(capacity), 3), "recover": bool(recover), "exercised": bool(exercised), "evidence": evidence, **kw}


# ---------------------------------------------------------------- drills: each runs the real recovery code with the fault injected

def drill_model_ladder(root, today):
    """Retire every model of one vendor at a time and call the executor's real author ladder (foundation/agents.complete) through a transport
    that answers 410 for the retired vendor, in a scratch root. Recovery holds when every single-vendor retirement still produces a change, the
    retired Workers AI rungs heal onto a successor (MODEL-HEAL-1, agents.heal), and the retirements they record become catalog changes through
    modelwatch.observed, the route that needs no Workers AI credential, which the watchdog runs."""
    from . import agents, modelwatch
    env = {"GITHUB_TOKEN": "sim", "CLOUDFLARE_ACCOUNT_ID": "sim", "CLOUDFLARE_API_TOKEN": "sim"}
    tmp = Path(tempfile.mkdtemp(prefix="yearsim-models-"))
    try:
        (tmp / "doctrine").mkdir()
        for f in ("doctrine/models.json", "doctrine/code-agents.json"):
            shutil.copy(Path(root) / f, tmp / f)
        authors = agents.route_authors(env, tmp)
        if not authors:
            return R("fatal", 0, False, True, "no author adapter is routable even with every free credential bound")
        reply = "SUMMARY: sim\n<<<FILE sim.txt>>>\nok\n<<<END>>>"

        def vendor_of(a):
            return a["model"].split("/")[1] if a["model"].startswith("@cf/") else a["family"]
        # Two passes: the full ladder (every free credential bound), then the Workers AI rungs alone (the GitHub Models rungs sit first in
        # route order, so with them bound a Workers AI retirement is never reached and the heal route would go unexercised).
        env_cf = {k: v for k, v in env.items() if k != "GITHUB_TOKEN"}
        cf_authors = agents.route_authors(env_cf, tmp)
        passes = [(env, v) for v in sorted({vendor_of(a) for a in authors})] + [(env_cf, v) for v in sorted({vendor_of(a) for a in cf_authors})]
        vendors = [v for _, v in passes]
        failed, healed = [], 0
        for penv, v in passes:
            dead = {a["model"] for a in authors + cf_authors if vendor_of(a) == v}
            used = []

            def transport(url, headers, body, _dead=dead, _used=used):
                model = body.get("model") or url.rsplit("/ai/run/", 1)[-1]
                if model in _dead:
                    raise urllib.error.HTTPError(url, 410, "Gone: model retired", {}, None)
                _used.append(model)
                if "api.cloudflare.com" in url:
                    return {"result": {"response": reply}}
                if "anthropic" in url:
                    return {"content": [{"text": reply}]}
                return {"choices": [{"message": {"content": reply}}]}
            try:
                _, aid = agents.complete("sim", penv, transport, tmp)
                healed += "@" in aid
            except RuntimeError as e:
                failed.append(f"{v}: {str(e)[:80]}")
        obs = modelwatch.observed(tmp, apply=True)
        wd = (Path(root) / ".github/workflows/watchdog.yml").read_text(encoding="utf-8")
        us = (Path(root) / "foundation/ultrastability.py").read_text(encoding="utf-8")  # WATCHDOG-FOLLOW-1: the tick the watchdog runs also runs it
        wired = "modelwatch --observed --apply" in wd or '"modelwatch"' in us
        ev = (f"{len(vendors)} vendor-wide retirements through agents.complete: {len(vendors) - len(failed)} still produced a change, {healed} on a healed rung; "
              f"modelwatch.observed turned {len(obs['changed'])} recorded 410s into catalog retirements; watchdog runs it: {wired}") + (f"; failed: {'; '.join(failed)}" if failed else "")
        if failed:
            return R("degrades", 0.5, False, True, ev)
        if not (obs["changed"] and wired):
            return R("degrades", 0.85, False, True, ev + "; without the observed route source keeps naming the retired id, one rung lost per batch")
        return R("recovers", 0.9, True, True, ev)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def drill_failover(root, today):
    """The host-failover rule in foundation/failover.decide, run on a scratch copy of the loop registry with the newest evidence aged past each
    host's takeover threshold: some other host must take the loops over without coordination."""
    from . import failover, launch
    tmp = Path(tempfile.mkdtemp(prefix="yearsim-"))
    try:
        (tmp / launch.REGISTRY).parent.mkdir(parents=True)
        shutil.copy(Path(root) / launch.REGISTRY, tmp / launch.REGISTRY)
        hosts = launch.registry(tmp)["hosts"]
        ev = tmp / launch.EVIDENCE
        ev.mkdir(parents=True)
        now = dt.datetime(2027, 1, 1, tzinfo=dt.timezone.utc)
        took = []
        for silent in sorted({h["takeover_after_hours"] for h in hosts if h["takeover_after_hours"] > 0}):
            at = (now - dt.timedelta(hours=silent + 0.5)).strftime("%Y-%m-%dT%H:%M:%SZ")
            (ev / "sim.jsonl").write_text(json.dumps({"at": at, "host": hosts[0]["id"], "loops": []}) + "\n", encoding="utf-8")
            runs = [h["id"] for h in hosts if h["id"] != hosts[0]["id"] and failover.decide(tmp, h["id"], now, sync=False)["run"]]
            took.append(f"silent {silent + 0.5}h: {', '.join(runs) or 'nobody'} takes over")
        ok = all(not t.endswith("nobody takes over") for t in took) and len(hosts) >= 2
        second = deps(root).get("second-clock", {}).get("status")
        cap = 0.6 if second != "closed" else 0.8
        return R("recovers" if ok else "fatal", cap if ok else 0, ok, True, "; ".join(took) + f"; independent second clock: {second}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def drill_github_down(root, today):
    return R("recovers", 0.0, True, False, "while GitHub is down nothing merges anywhere; the loops resume from the repository when it returns (declared, not exercised)")


def drill_cloudflare_incident(root, today):
    hosts = [h["id"] for h in json.loads((Path(root) / "instances/ultrastable/loops.json").read_text(encoding="utf-8"))["hosts"]]
    other = [h for h in hosts if "cloudflare" not in h]
    return R("recovers", 0.3 if other else 0.0, True, False, f"Cloudflare-hosted loops and deploys pause; {', '.join(other) or 'no host'} keeps the checks and merges going (declared)")


def drill_checks_elsewhere(root, today):
    """When GitHub refuses jobs, checks run in a cloud session (foundation/checksrun.py) and the tick Worker's lane keeps merging (seed/worker/src/sweeper.js)."""
    have = [p for p in ("foundation/checksrun.py", "seed/worker/src/sweeper.js", "seed/worker/src/handoff.js") if (Path(root) / p).is_file()]
    try:
        from . import checksrun
        steps = len(getattr(checksrun, "steps", lambda *a: [])(root)) if hasattr(checksrun, "steps") else None
    except Exception as e:  # noqa: BLE001 - recorded, the drill reports what it could not import
        steps = f"import failed: {type(e).__name__}"
    ok = len(have) == 3
    return R("degrades" if ok else "fatal", 0.5 if ok else 0, ok, False, f"second route present: {', '.join(have)}; checksrun steps: {steps}")


def drill_budget_governor(root, today):
    """The real governor (seed/worker/src/budget.js decide) with usage pushed past the day's allowance, then the next day."""
    js = ("import { allowance, budgetConfig, decide } from %s;"
          "const a = allowance(budgetConfig({}, { CF_PLAN: 'paid', BUDGET_USD_PER_MONTH: '5' }));"
          "const over = decide(a, { ai_neurons_today: a.ai_neurons_day * 3, ai_usd_month_to_date: 0 });"
          "const lean = decide(a, { ai_neurons_today: a.ai_neurons_day * 0.95, ai_usd_month_to_date: 0 });"
          "const next = decide(a, { ai_neurons_today: 0, ai_usd_month_to_date: 0 });"
          "console.log(JSON.stringify({ over, lean, next }));") % json.dumps((Path(root) / "seed/worker/src/budget.js").as_uri())
    try:
        out = subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True, timeout=60)
        r = json.loads(out.stdout.strip().splitlines()[-1])
    except (OSError, ValueError, IndexError, subprocess.TimeoutExpired) as e:
        return R("degrades", 0.6, True, False, f"governor not exercised ({type(e).__name__}); assumed to reset at the day boundary")
    soft = r["over"]["mode"] != "frozen"
    ev = f"over allowance: {r['over']['mode']} ({r['over']['calls_per_tick']} calls a tick); near it: {r['lean']['mode']}; next day: {r['next']['mode']}"
    if r["next"]["mode"] != "normal":
        return R("fatal", 0, False, True, ev + "; the governor does not recover the next day")
    # frozen stops model calls for the rest of the day; loops that need no model keep running (soft at day scale, owned by the cost governor)
    return R("recovers", 0.8 if soft else 0.6, True, True, ev, soft=soft)


def drill_conflict_resolver(root, today):
    """scripts/resolve_generated.py on a real conflict in an append-only ledger, in a scratch git repository."""
    tmp = Path(tempfile.mkdtemp(prefix="yearsim-git-"))
    try:
        g = lambda *a: subprocess.run(["git", *a], cwd=tmp, capture_output=True, text=True)
        g("init", "-q", "-b", "main"); g("config", "user.email", "sim@example.invalid"); g("config", "user.name", "sim")
        (tmp / "ops").mkdir(); (tmp / "ops/x.jsonl").write_text('{"a":1}\n')
        g("add", "."); g("commit", "-qm", "base"); g("checkout", "-qb", "side")
        (tmp / "ops/x.jsonl").write_text('{"a":1}\n{"side":1}\n'); g("commit", "-qam", "side"); g("checkout", "-q", "main")
        (tmp / "ops/x.jsonl").write_text('{"a":1}\n{"main":1}\n'); g("commit", "-qam", "main")
        g("merge", "side")
        r = subprocess.run([sys.executable, str(Path(root) / "scripts/resolve_generated.py")], cwd=tmp, capture_output=True, text=True, timeout=120,
                           env={**os.environ, "PYTHONPATH": str(root)})
        t = (tmp / "ops/x.jsonl").read_text()
        ok = r.returncode == 0 and "<<<<<<<" not in t and '"side"' in t and '"main"' in t
        return R("recovers" if ok else "degrades", 0.95 if ok else 0.8, ok, True, f"resolver exit {r.returncode}; both sides kept: {ok}")
    except (OSError, subprocess.TimeoutExpired) as e:
        return R("degrades", 0.8, False, False, f"resolver not exercised: {type(e).__name__}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def drill_credential_watch(root, today):
    """credwatch.assess with a credential the provider reports as expiring, then revoked: each must file a Q-CRED item before the loops stop.
    Recovery after detection needs the credential to renew itself (doctrine/unattended.json renewal auto)."""
    from . import credwatch
    c = {**credwatch.cfg(root), "credentials": [{"name": "SIM_TOKEN", "kind": "github-token", "used_by": "sim"}], "registrations": []}
    soon = (today + dt.timedelta(days=10)).isoformat()
    exp = credwatch.assess(c, today, {"SIM_TOKEN": "x"}, lambda url, tok: (200, {"github-authentication-token-expiration": soon}, ""))
    rev = credwatch.assess(c, today, {"SIM_TOKEN": "x"}, lambda url, tok: (401, {}, ""))
    detected = exp[0]["state"] == "expiring" and rev[0]["state"] == "invalid" and credwatch.item(rev[0])["id"] == "Q-CRED-SIM_TOKEN"
    d = deps(root)
    renew = [d.get(i, {}).get("renewal") for i in ("github-app-token", "cloudflare-api-tokens")]
    ev = f"expiring detected: {exp[0]['state']}; revoked detected: {rev[0]['state']}; renewal of the credentials the loops use: {renew}"
    if not detected:
        return R("degrades", 0.5, False, True, ev + "; detection failed")
    if all(x == "auto" for x in renew):
        # a forced revocation still needs the consent flow once; the credential-free route (Actions' per-run token) keeps merging meanwhile
        return R("degrades", 0.6, False, True, ev + "; revocation needs one sign-in through /connect, the per-run Actions token keeps merging meanwhile", gate=True)
    return R("degrades", 0.5, False, True, ev, gate=True)


def drill_dependency_loop(root, today):
    """Every dependency ecosystem in the repository is advanced by a server-side loop (Dependabot opens the change, the lane merges it green).
    Coverage is read by the one reader every system carries, seed/scripts/deprot.py through foundation/deprot.py (USER-BACKEND-1)."""
    from . import deprot
    have: dict[str, int] = {}
    base = deprot.baseline(root)
    held = sorted(m for m in deprot.manifests(root) if m in base)
    for e, d in deprot.manifests(root):
        if (e, d) not in base:
            have[e] = have.get(e, 0) + 1
    missing = [f"{e}:{d}" for e, d in deprot.missing(root)]
    sw = Path(root) / "seed/worker/src/sweeper.js"
    m = re.search(r"CLIENT_PREFIX\s*=\s*\[([^\]]*)\]", sw.read_text(encoding="utf-8")) if sw.is_file() else None
    if not (m and "dependabot/" in m.group(1)):
        missing.append("merge lane: seed/worker/src/sweeper.js CLIENT_PREFIX does not take dependabot/ branches, so updates are opened and never merged")
    if missing:
        return R("degrades", 0.9, False, True, f"no loop advances: {', '.join(missing)}", missing=missing)
    return R("recovers", 0.9, True, True, f"every ecosystem is advanced by Dependabot: {', '.join(f'{e} {n}' for e, n in sorted(have.items()))}"
             + (f"; {len(held)} manifest(s) on the shrink-only baseline doctrine/deprot.json" if held else ""))


def node_pins(root) -> dict:
    out = {}
    for p in sorted((Path(root) / ".github/workflows").glob("*.yml")):
        for m in re.finditer(r"node-version:\s*['\"]?(\d+)", p.read_text(encoding="utf-8")):
            out.setdefault(m.group(1), []).append(p.name)
    return out


def drill_node_runtime(root, today, c=None):
    c = c or cfg(root)
    pins = node_pins(root)
    eol = {v: dt.date.fromisoformat(d) for v, d in c["node_eol"].items()}
    worst = min(pins, key=lambda v: eol.get(v, dt.date.min)) if pins else None
    when = eol.get(worst) if worst else None
    # the fix exists as code: fix_node rewrites the pins; exercise it on a scratch copy of the first pinned workflow
    fixed = None
    if pins:
        src = next(iter(pins.values()))[0]
        t = (Path(root) / ".github/workflows" / src).read_text(encoding="utf-8")
        fixed = c["node_lts"] in re.findall(r"node-version:\s*['\"]?(\d+)", rewrite_node(t, c["node_lts"]))
    ev = f"pins: {', '.join(f'{v} x{len(f)}' for v, f in sorted(pins.items()))}; earliest end of maintenance {when}; automatic rewrite to {c['node_lts']} works: {fixed}"
    if when is None or not fixed:
        return R("degrades", 0.8, False, True, ev, date=str(when) if when else None)
    return R("recovers", 0.95, True, True, ev, date=str(when))


def drill_domain_renewal(root, today):
    d = deps(root)
    dom, pay = d.get("domain-renewal", {}), d.get("payment-method", {})
    auto = dom.get("renewal") == "auto"
    ev = f"domains renew {dom.get('renewal')}, expire {dom.get('expires')}; payment method: {pay.get('status')} ({pay.get('renewal')})"
    # losing the domains takes down the public pages, not the release path (deploys go through the workers.dev endpoints)
    return R("recovers" if auto else "degrades", 0.95 if auto else 0.7, auto, False, ev, date=dom.get("expires"), gate=pay.get("status") == "gate")


DRILLS = {k[6:]: v for k, v in globals().items() if k.startswith("drill_")}


def drills(root=REPO, today=None, only=None) -> dict:
    c, today = cfg(root), today or dt.date.today()
    out = {}
    for f in c["faults"] + c["scheduled"]:
        if only and f["id"] != only:
            continue
        try:
            out[f["id"]] = DRILLS[f["drill"]](root, today)
        except Exception as e:  # noqa: BLE001 - a drill that crashes is a finding, never a pass
            out[f["id"]] = R("degrades", 0.5, False, False, f"drill crashed: {type(e).__name__}: {str(e)[:160]}")
    return out


# ---------------------------------------------------------------- the simulated years

def self_commits(root=REPO, days=14, now=None) -> list[dict] | None:
    """Commits on main in the window that the server originated (executor or its own agent), with their size outside ledgers and generated
    data; None when the clone's history does not reach back past the window (unmeasured, never zero)."""
    from . import criticality
    since = ((now or dt.datetime.now(dt.timezone.utc)) - dt.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    r = subprocess.run(["git", "log", f"--since={since}", "--format=%H%x1f%B%x1e"], cwd=root, capture_output=True, text=True)
    if r.returncode != 0:
        return None
    if (Path(root) / ".git/shallow").exists():  # a shallow clone measures only when its history reaches back past the window
        tail = subprocess.run(["git", "rev-list", "--max-parents=0", "HEAD"], cwd=root, capture_output=True, text=True).stdout.split()
        first = subprocess.run(["git", "log", "-1", "--format=%cI", tail[0]], cwd=root, capture_output=True, text=True).stdout.strip() if tail else ""
        if not first or first > since:
            return None
    c, out = criticality.cfg(root), []
    for chunk in r.stdout.split("\x1e"):
        if "\x1f" not in chunk:
            continue
        h, msg = chunk.strip().split("\x1f", 1)
        msg = msg.strip()
        if not msg or "[skip ci]" in msg.splitlines()[0] or criticality.origin_of(msg, c) not in ("executor", "self-agent"):
            continue
        ns = subprocess.run(["git", "show", "--numstat", "--format=", h], cwd=root, capture_output=True, text=True).stdout
        lines = 0
        for ln in ns.splitlines():
            a, d, f = (ln.split("\t") + ["", "", ""])[:3]
            if a.isdigit() and d.isdigit() and f.endswith(CODE_EXT) and not f.startswith(("ops/", "docs/", "doctrine/writeback/")) and "-data.js" not in f:
                lines += int(a) + int(d)
        out.append({"sha": h[:12], "lines": lines, "title": msg.splitlines()[0][:100]})
    return out


CODE_EXT = (".py", ".js", ".mjs", ".ts", ".html", ".css", ".yml", ".yaml", ".sql", ".toml", ".sh")
SUBSTANTIVE_LINES = 10  # NO-TRIVIAL-COMMITS (Rowan, 2026-11-21): a one-line import removal is upkeep, not a release


def self_rate(root=REPO, days=14, now=None, substantive=True) -> float | None:
    cs = self_commits(root, days, now)
    if cs is None:
        return None
    return round(sum(1 for x in cs if not substantive or x["lines"] >= SUBSTANTIVE_LINES) / days, 3)


# The engine (events, one_year, pct, horizon, sensitivity) is shared with every system: seed/scripts/yearsim.py is the one copy, so an improvement
# to the simulator reaches the platform and every tenant (USER-BACKEND-1: a local copy is a defect).
import importlib.util as _ilu
_spec = _ilu.spec_from_file_location("yearsim_core", REPO / "seed/scripts/yearsim.py")
_core = _ilu.module_from_spec(_spec)
sys.modules["yearsim_core"] = _core
_spec.loader.exec_module(_core)
events, one_year, pct, horizon, sensitivity, apply_observed = _core.events, _core.one_year, _core.pct, _core.horizon, _core.sensitivity, _core.apply_observed


def simulate(root=REPO, results=None, today=None, runs=None, now=None) -> dict:
    c = cfg(root)
    tp = Path(root) / "ops/trajectory.json"  # TRAJECTORY-1: observed rates and trends replace the assumed ones where the history holds enough events
    c, observed_from = apply_observed(c, json.loads(tp.read_text(encoding="utf-8")).get("observed") if tp.is_file() else None)
    today = today or dt.date.today()
    results = results if results is not None else drills(root, today)
    runs = runs or c["runs"]
    out = {"normal": horizon(c, results, runs, today, seed=c["seed"]), "strict": horizon(c, results, runs, today, strict=True, seed=c["seed"])}
    cs = self_commits(root, c["self_rate_window_days"], now)
    rate = None if cs is None else round(sum(1 for x in cs if x["lines"] >= SUBSTANTIVE_LINES) / c["self_rate_window_days"], 3)
    rel = None if rate is None else (out["normal"]["p10"] if rate > 0 else 0)
    return {"rates_observed": observed_from, "horizon": out["normal"], "strict": out["strict"], "sensitivity": sensitivity(c, results, today, runs=min(runs, 60), seed=c["seed"]), "self_rate_per_day": rate,
            "self_commits": None if cs is None else {"all": len(cs), "substantive": sum(1 for x in cs if x["lines"] >= SUBSTANTIVE_LINES), "window_days": c["self_rate_window_days"], "latest": cs[:5]}, "release_horizon_p10": rel,
            "self_releases_year_p50": None if rate is None else round(rate * c["target_days"] * (out["normal"]["capacity_year_p50"] or 0), 1)}


# ---------------------------------------------------------------- findings, records, page

def findings(c, results, sim) -> list[dict]:
    out = []
    for fid, r in results.items():
        why = None
        if r["mode"] == "fatal":
            why = "nothing recovers from it without a person"
        elif not r["recover"] and r["capacity"] < 1:
            why = f"capacity stays at {r['capacity']} after it, for good"
        elif not r["exercised"]:
            why = "its recovery is declared but no drill exercises code"
        if why:
            out.append({"id": fid, "why": why, "evidence": r["evidence"]})
    if sim["release_horizon_p10"] == 0:
        out.append({"id": "self-release", "why": "the server originated no substantive change in the measured window, so the system ships nothing on its own", "evidence": f"self_rate_per_day {sim['self_rate_per_day']}"})
    return out


def _item(root, c, f):
    iid = f"{c['item_prefix']}-{f['id']}"
    p = Path(root) / "docs/issues" / (iid + ".json")
    probe = "cmd:python3 -m foundation yearsim --probe " + f["id"] if f["id"] != "self-release" else "cmd:python3 -m foundation yearsim --probe self-release"
    body = (f"**Owner:** executor\n**Trigger:** the year simulation (YEAR-SIM-1) on the watchdog run\n**Done check:** {probe}\n**Status:** open\n\n"
            f"Fault class `{f['id']}`: {f['why']}. Drill evidence: {f['evidence'][:600]}\n\nBuild the mechanism that recovers from it without a person, then the "
            f"drill in foundation/yearsim.py must exercise it.\n\nsize: M\n\n**Closing probe:** `python3 -m foundation yearsim --probe {f['id']}` exits 0.\n")
    if not p.exists():
        p.write_text(json.dumps({"id": iid, "title": f"{iid}: {f['why']}", "body": body, "labels": ["p1", "agent-ready", "unattended"], "milestone": "Now", "workstream": "Ultrastability"}, indent=2) + "\n", encoding="utf-8")
        return iid
    return None


def _close_recovered(root, c, fs, results, sim, at):
    """Self-remediation closes its own loop: an open Q-YEAR-SIM item whose fault class is no longer a finding is closed with the drill evidence
    that now passes, so the queue never holds work the code already did. A class still failing stays open."""
    still, closed = {f["id"] for f in fs}, []
    for p in sorted((Path(root) / "docs/issues").glob(c["item_prefix"] + "-*.json")):
        j = json.loads(p.read_text(encoding="utf-8"))
        fid = j["id"][len(c["item_prefix"]) + 1:]
        if "**Status:** open" not in j.get("body", "") or fid in still or fid == "node-eol-upgrade":
            continue
        ev = (results.get(fid) or {}).get("evidence") or (f"self rate {sim.get('self_rate_per_day')} a day" if fid == "self-release" else "no longer a finding")
        j["body"] = j["body"].replace("**Status:** open", "**Status:** closed", 1) + f"\n**Evidence:** year simulation at {at}: {str(ev)[:300]}\n"
        p.write_text(json.dumps(j, indent=2) + "\n", encoding="utf-8")
        closed.append(j["id"])
    return closed


def run(root=REPO, apply=False, today=None, now=None, runs=None, changed_file=None) -> dict:
    root, c = Path(root), cfg(root)
    now = now or dt.datetime.now(dt.timezone.utc)
    today = today or now.date()
    results = drills(root, today)
    sim = simulate(root, results, today, runs, now)
    fs = findings(c, results, sim)
    rec = {"at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "marker": c["marker"], "target_days": c["target_days"], "runs": runs or c["runs"], "days": c["days"],
           **sim, "drills": results, "findings": fs, "meets_target": (sim["horizon"]["p10"] or 0) >= c["target_days"]}
    if apply:
        prev = json.loads((root / c["latest"]).read_text(encoding="utf-8")) if (root / c["latest"]).is_file() else {}
        if changed_file and (prev.get("at", "")[:10] != rec["at"][:10] or prev.get("horizon") != rec["horizon"] or [f["id"] for f in prev.get("findings", [])] != [f["id"] for f in fs]):
            Path(changed_file).write_text("1", encoding="utf-8")
        (root / c["latest"]).write_text(json.dumps(rec, indent=1, sort_keys=True) + "\n", encoding="utf-8")
        with (root / c["ledger"]).open("a", encoding="utf-8", newline="\n") as fh:
            fh.write(json.dumps({k: rec[k] for k in ("at", "horizon", "strict", "self_rate_per_day", "release_horizon_p10", "meets_target")} | {"findings": [f["id"] for f in fs]}, sort_keys=True) + "\n")
        rec["filed"] = [i for i in (_item(root, c, f) for f in fs) if i]
        rec["closed"] = _close_recovered(root, c, fs, results, sim, rec["at"])
        ne = results.get("node-eol", {})
        if ne.get("date") and (dt.date.fromisoformat(ne["date"]) - today).days <= c["node_warn_days"]:
            nid = _item(root, c, {"id": "node-eol-upgrade", "why": f"the pinned Node release leaves maintenance on {ne['date']}", "evidence": ne["evidence"] + ". Fix: python3 -m foundation yearsim --fix-node --apply (bump node_eol and node_lts in doctrine/yearsim.json first when a newer LTS exists)"})
            if nid:
                rec["filed"].append(nid)
        (root / DATA).write_text(render(root), encoding="utf-8")
    return rec


def probe(root, fid) -> int:
    if fid == "self-release":
        r = self_rate(root)
        print(f"self_rate_per_day {r}")
        return 0 if r else 1
    res = drills(root, only=fid).get(fid)
    if res is None:
        print("unknown fault class", fid); return 2
    print(json.dumps(res))
    return 0 if res["recover"] and res["exercised"] else 1


def page_data(root=REPO) -> dict:
    p = Path(root) / cfg(root)["latest"]
    if not p.is_file():
        return {"measured": False}
    j = json.loads(p.read_text(encoding="utf-8"))
    c = cfg(root)
    meta = {f["id"]: f for f in c["faults"] + c["scheduled"]}
    return {"measured": True, "at": j["at"], "target_days": j["target_days"], "runs": j["runs"], "days": j["days"], "horizon": j["horizon"], "strict": j["strict"],
            "self_rate_per_day": j["self_rate_per_day"], "self_commits": j.get("self_commits"), "release_horizon_p10": j["release_horizon_p10"], "meets_target": j["meets_target"],
            "classes": [{"id": k, "what": meta.get(k, {}).get("what", k), "rate": meta.get(k, {}).get("rate_per_year"), "basis": meta.get(k, {}).get("basis", "scheduled"),
                         "mode": v["mode"], "capacity": v["capacity"], "recover": v["recover"], "exercised": v["exercised"], "evidence": v["evidence"]} for k, v in j["drills"].items()],
            "sensitivity": [{"id": r["id"], "what": meta.get(r["id"], {}).get("what", r["id"]), "swing": r["swing"]} for r in (j.get("sensitivity") or {}).get("ranked", [])[:5]],
            "findings": j["findings"]}


def render(root=REPO) -> str:
    return ("// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0\n// GENERATED by python3 -m foundation yearsim --run --apply from ops/yearsim.json. Do not edit; --check fails when stale.\n"
            "export default " + json.dumps(page_data(root), indent=1, sort_keys=True) + ";\n")


def rewrite_node(text: str, lts: str) -> str:
    return re.sub(r"(node-version:\s*['\"]?)(\d+)", lambda m: m.group(1) + (lts if int(m.group(2)) < int(lts) else m.group(2)), text)


def fix_node(root=REPO, apply=False) -> list[str]:
    lts, changed = cfg(root)["node_lts"], []
    for p in sorted((Path(root) / ".github/workflows").glob("*.yml")):
        t = p.read_text(encoding="utf-8")
        n = rewrite_node(t, lts)
        if n != t:
            changed.append(p.name)
            if apply:
                p.write_text(n, encoding="utf-8")
    return changed


def check(root=REPO) -> list[str]:
    root, errs = Path(root), []
    c = cfg(root)
    for k in ("runs", "days", "target_days", "fatal_floor", "fatal_after_days", "faults", "scheduled", "node_eol", "node_lts", "latest", "ledger", "item_prefix"):
        if k not in c:
            errs.append("missing " + k)
    if c.get("days", 0) < c.get("target_days", 365) or c.get("target_days", 0) < 365:
        errs.append("the simulated span must cover the target, and the target is never below 365 days")
    d = deps(root)
    for f in c.get("faults", []) + c.get("scheduled", []):
        if f.get("drill") not in DRILLS:
            errs.append(f"{f.get('id')}: drill {f.get('drill')!r} is not in foundation/yearsim.py")
        if f in c.get("faults", []) and not str(f.get("basis", "")).startswith(("observed:", "assumed:")):
            errs.append(f"{f['id']}: basis must say observed: or assumed:")
        for x in f.get("depends", []):
            if x not in d:
                errs.append(f"{f['id']}: depends on {x}, which doctrine/unattended.json does not register")
    if (root / DATA).is_file() and (root / DATA).read_text(encoding="utf-8") != render(root):
        errs.append(f"{DATA} is stale: run yearsim --run --apply")
    return errs


def main(argv=None) -> int:
    a = sys.argv[1:] if argv is None else argv
    if "--check" in a:
        e = check(); print("\n".join(e) or "yearsim ok"); return 1 if e else 0
    if "--fix-node" in a:
        print(json.dumps(fix_node(apply="--apply" in a))); return 0
    if "--probe" in a:
        i = a.index("--probe"); return probe(REPO, a[i + 1] if i + 1 < len(a) else "")
    if "--drill" in a:
        i = a.index("--drill"); only = a[i + 1] if i + 1 < len(a) and not a[i + 1].startswith("--") else None
        print(json.dumps(drills(REPO, only=only), indent=1)); return 0
    if "--run" in a:
        r = run(REPO, apply="--apply" in a, changed_file=a[a.index("--changed-file") + 1] if "--changed-file" in a else None)
        print(json.dumps({k: r[k] for k in ("horizon", "strict", "self_rate_per_day", "release_horizon_p10", "meets_target")} | {"findings": [f["id"] for f in r["findings"]], "filed": r.get("filed", [])}, indent=1))
        return 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main())

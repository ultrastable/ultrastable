# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""ULTRASTABILITY-1: Ashby's two loops, as code. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation ultrastability [--tick [--apply] | --check | --data [--apply] | --status | --tenants [--apply]]

ESSENTIAL VARIABLES  doctrine/ultrastability.json declares, per scope (platform, tenant), the variables whose bounds are the system's viability limits.
FIRST ORDER          the existing loops (probe-and-revert, cost probe, claims check, executor) correct disturbance without changing the system.
SECOND ORDER         when a variable has been out of bounds for `patience_ticks` consecutive ticks, one discrete step from its ladder is taken: a parameter
                     change within declared limits, or a restructure item with a closing probe. The step is logged with its provenance row and kept only if the
                     variable is back inside its bounds within `settle_ticks`; otherwise a parameter is restored and the next step on the ladder is taken.
                     When the ladder is spent and the variable is still out, the search continues as in Ashby's ultrastable system (Design for a
                     Brain, 1952, chapters 7 and 8; ASHBY-SEARCH-1): an untried value for one of the variable's parameters is drawn at random (seeded,
                     so a run replays) from its declared range, kept if the variable returns, undone if not. Only when every value has been tried,
                     or the variable has no parameter to change, is an incident item filed for redesign. `ashby()` measures how far the declaration
                     matches the mechanism (limits on every variable, share with a step-function); research paper ashby-1952 reports it.
Every reading, step and verdict is a row in ops/ultrastability.jsonl. Tests: tests/foundation/test_ultrastability.py.
"""
from __future__ import annotations
import json, re, sys, urllib.request
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/ultrastability.json"
DATA = "site/ultrastability-data.js"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def in_bounds(v: dict, value) -> bool:
    if value is None:
        return False  # an unreadable variable is unmeasured, never in bounds
    lo, hi = v.get("min"), v.get("max")
    return (lo is None or value >= lo) and (hi is None or value <= hi)


def readings(root=REPO) -> dict:
    """Current value of every platform variable, read from the ledgers the first-order loops already write."""
    from . import claims, criticality
    c = criticality.compute(root, feed_ok=True)
    verified = (c["verified_deploys"] / c["deploys"]) if c["deploys"] else 1.0
    try:
        drift = len(claims.evaluate(root)[2])
    except (OSError, ValueError, KeyError):
        drift = None
    cost = fresh_cost(root, c["cost"])
    from . import resilience, uiux
    return {"yearsim.horizon_p10": yearsim_reading(root), "yearsim.self_rate": yearsim_field(root, "self_rate_per_day"),
            "criticality.cost": cost, "criticality.verified_share": round(verified, 3), "claims.drift": drift, "criticality.k": c["k"], "resilience.stalled": resilience.stalled_reading(root),
            "uiux.findings": uiux.status_reading(root, "findings_blocking"), "uiux.happy_paths": uiux.status_reading(root, "happy_path_pass_share"),
            "owner.interventions_7d": owner_interventions(root), "ultra.keep_rate": keep_rate(root), "spec.quality": spec_quality(root),
            "research.met_share": research_met(root)}


def research_met(root):
    """RESEARCH-LOOP-1: the share of findings in every published paper whose own measurement meets its target. A paper that says the system
    does something it does not is out of bounds here, and the ladder builds the mechanism, never edits the paper to match."""
    from . import research
    try:
        return research.measures(root)["research_findings_met_share"]["value"]
    except (OSError, ValueError, KeyError) as e:
        print(f"ultrastability: research reading failed: {e}", file=sys.stderr)
        return None


def owner_interventions(root, now=None, days=7):
    """SECOND-LOOP-2: how often a person had to act as the second loop. Each owner-driven thread session that changed the repository in the
    window is one intervention (provenance rows with origin channel thread, counted by distinct actor). Target 0: a system that needs its owner
    to notice and redirect it is not ultrastable. None when the provenance ledger cannot be read."""
    p = Path(root) / "ops/provenance.jsonl"
    try:
        lines = p.read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    from datetime import timedelta
    cut = ((now or datetime.now(timezone.utc)) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    actors = set()
    for l in lines:
        try:
            r = json.loads(l)
        except ValueError:
            continue
        o = r.get("origin") or {}
        if r.get("at", "") >= cut and (o.get("class") == "owner" or o.get("channel") == "thread"):
            actors.add(o.get("actor") or r.get("id"))
    return len(actors)


def keep_rate(root, last=30, least=5):
    """SECOND-LOOP-2: the second loop judged by its own outcomes. Share of its last `last` verdicts that were kept. A loop whose every step is
    reverted is moving, not learning. None until `least` verdicts exist."""
    try:
        rows = [json.loads(l) for l in (Path(root) / load(root)["ledger"]).read_text(encoding="utf-8").splitlines() if '"verdict"' in l]
    except (OSError, ValueError):
        return None
    v = [r for r in rows if r.get("ev") == "verdict"][-last:]
    return round(sum(r.get("verdict") == "kept" for r in v) / len(v), 3) if len(v) >= least else None


def spec_quality(root):
    from . import specgate
    try:
        return specgate.quality(root)
    except (OSError, ValueError, KeyError):
        return None


def common_mode(targets, least=3) -> set:
    """SECOND-LOOP-2: when every tenant reads the same out-of-bounds value on one variable, the fault is in the sensor or the shared path, not in
    each tenant. Stepping on each tenant (retire, rebuild) would act on the wrong system, so those keys are held and one measurement item is filed."""
    by = {}
    for key, v, value in targets:
        if ":" in key:
            by.setdefault(v["id"], []).append((key, v, value))
    held = set()
    for vid, rows in by.items():
        vals = {x[2] for x in rows}
        if len(rows) >= least and len(vals) == 1 and None not in vals and not in_bounds(rows[0][1], rows[0][2]):
            held |= {x[0] for x in rows}
    return held


def readiness(root=REPO, last=None) -> dict:
    """ONE-YEAR-READY-1: one number for "could this run a year with nobody touching it". The product of three parts, each 0 to 1:
    horizon (simulated 10th-percentile unattended days / 365, capped at 1), bounds (share of platform essential variables in bounds now;
    unmeasured counts as out) and learning (0.5 + 0.5 x the second loop's keep rate, 0.5 when it has no verdicts yet)."""
    c = load(root)
    last = last if last is not None else last_readings(root)
    vs = c["scopes"]["platform"]["variables"]
    inb = sum(1 for v in vs if (last.get(v["id"]) or {}).get("ok")) / len(vs)
    h = (last.get("unattended_horizon") or {}).get("value")
    hz = min(1.0, h / 365) if isinstance(h, (int, float)) else 0.0
    kr = (last.get("second_loop_keep_rate") or {}).get("value")
    learn = 0.5 + 0.5 * kr if isinstance(kr, (int, float)) else 0.5
    return {"score": round(100 * hz * inb * learn), "horizon": round(hz, 3), "bounds": round(inb, 3), "learning": round(learn, 3)}


def last_readings(root=REPO) -> dict:
    out = {}
    try:
        for l in (Path(root) / load(root)["ledger"]).read_text(encoding="utf-8").splitlines():
            if '"reading"' not in l:
                continue
            r = json.loads(l)
            if r.get("ev") == "reading" and ":" not in r.get("var", ""):
                out[r["var"]] = {"value": r.get("value"), "ok": bool(r.get("ok")), "at": r.get("at")}
    except (OSError, ValueError):
        pass
    return out


def yearsim_reading(root, now=None, max_age_days=3):
    """The 10th-percentile simulated unattended horizon from ops/yearsim.json (foundation/yearsim.py); stale or missing is unmeasured."""
    p = Path(root) / "ops/yearsim.json"
    try:
        j = json.loads(p.read_text(encoding="utf-8"))
        at = datetime.fromisoformat(j["at"].replace("Z", "+00:00"))
    except (OSError, ValueError, KeyError):
        return None
    if ((now or datetime.now(timezone.utc)) - at).total_seconds() > max_age_days * 86400:
        return None
    return j.get("horizon", {}).get("p10")


def yearsim_field(root, key, now=None, max_age_days=3):
    p = Path(root) / "ops/yearsim.json"
    try:
        j = json.loads(p.read_text(encoding="utf-8"))
        at = datetime.fromisoformat(j["at"].replace("Z", "+00:00"))
    except (OSError, ValueError, KeyError):
        return None
    return j.get(key) if ((now or datetime.now(timezone.utc)) - at).total_seconds() <= max_age_days * 86400 else None


def fresh_cost(root, value, now=None, max_age_days=3):
    """Cost is judged only from a recent reading of this account: a stale row (or none) is unmeasured, never a breach."""
    p = Path(root) / "ops/cost.jsonl"
    rows = [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()] if p.is_file() else []
    if not rows:
        return None
    last = rows[-1]
    stamp = last.get("at") or last.get("ts")  # cost-probe.mjs writes `ts`, the session-read rows write `at`
    if not stamp or last.get("unmeasured"):
        return None  # an unmeasured row (no Cloudflare credential on the runner) is unmeasured, never a breach and never a crash
    at = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    return value if ((now or datetime.now(timezone.utc)) - at).total_seconds() <= max_age_days * 86400 else None


def tenant_readings(root=REPO, fetch=None) -> dict:
    """Per live tenant (spinoff apps not retired), the tenant variables that can be read now: uptime from a live probe of its URL, the rest from
    ops/tenants/<slug>.json when the tenant's own loop writes it. A value nothing can read is None (unmeasured)."""
    root, out = Path(root), {}
    get = fetch or _get
    for led in (root / "ops/spinoff/ledger.jsonl",):
        apps = {}
        if led.is_file():
            for ln in led.read_text(encoding="utf-8").splitlines():
                if ln.strip():
                    r = json.loads(ln)
                    if r.get("slug"):
                        apps[r["slug"]] = {**apps.get(r["slug"], {}), **{k: r[k] for k in ("url", "event") if k in r}}
        for slug, a in sorted(apps.items()):
            if a.get("event") == "retire" or not a.get("url"):
                continue
            own = root / "ops/tenants" / (slug + ".json")
            have = json.loads(own.read_text(encoding="utf-8")) if own.is_file() else {}
            out[slug] = {"uptime": get(a["url"]), "spend": have.get("spend_vs_budget"), "claims_drift": have.get("claims_drift"), "value": _ratio(have.get("declared_metric"), have.get("declared_target"))}
    return out


def _ratio(value, target):
    """A tenant's declared metric against its own declared target: 1.0 means on target. Without both numbers it is unmeasured, never in bounds."""
    try:
        return round(float(value) / float(target), 3) if value is not None and target not in (None, 0) else None
    except (TypeError, ValueError):
        return None


def spinoff_readings(root=REPO, platform_cost=None) -> dict:
    """TENANT-READINGS-1: the spend and value readings a spinoff's own loop already makes, as the tenant variables expect them. Value is the latest
    measured value from the portfolio decision rows (ops/spinoff/ledger.jsonl) against doctrine/spinoff.json portfolio.kill_below_value, so 1.0 is the keep line.
    Spend is an upper bound: an app cannot spend more than the whole account, so (account spend as a share of budget) / (the app's budget_share)
    bounds its spend against its own allocation. No per-app meter exists yet; an unmeasured account cost leaves spend unmeasured, never 0."""
    root, out = Path(root), {}
    led = root / "ops/spinoff/ledger.jsonl"
    try:
        target = json.loads((root / "doctrine/spinoff.json").read_text(encoding="utf-8")).get("portfolio", {}).get("kill_below_value")
    except (OSError, ValueError):
        target = None
    if not led.is_file():
        return out
    for ln in led.read_text(encoding="utf-8").splitlines():
        if not ln.strip():
            continue
        r = json.loads(ln)
        if r.get("event") != "decision" or not r.get("slug"):
            continue
        o = out.setdefault(r["slug"], {})
        if r.get("value") is not None:
            o["declared_metric"], o["declared_target"] = r["value"], target
        if r.get("budget_share"):
            o["budget_share"] = r["budget_share"]
    for o in out.values():
        share = o.get("budget_share")
        o["spend_vs_budget"] = round(platform_cost / share, 3) if platform_cost is not None and share else None
    return out


def write_tenants(root=REPO, fetch=None, now=None) -> list[str]:
    """Write ops/tenants/<slug>.json for every live tenant: the uptime probe now, and the other readings kept from the tenant's own loop (null until it writes them)."""
    root, now = Path(root), (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
    done = []
    try:
        cost = readings(root).get("criticality.cost")
    except (OSError, ValueError, KeyError) as e:  # no criticality inputs in this root: spend stays unmeasured, never 0
        print(f"tenant spend unmeasured: {e}", file=sys.stderr); cost = None
    own = spinoff_readings(root, cost)
    for slug, r in tenant_readings(root, fetch).items():
        p = root / "ops/tenants" / (slug + ".json")
        have = json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {}
        p.parent.mkdir(parents=True, exist_ok=True)
        mine = own.get(slug, {})
        pick = lambda k: mine.get(k) if mine.get(k) is not None else have.get(k)  # a fresh reading from the spinoff loop wins; the tenant's own write is kept otherwise
        doc = {"slug": slug, "at": now, "uptime": r["uptime"], "spend_vs_budget": pick("spend_vs_budget"), "claims_drift": have.get("claims_drift"),
               "declared_metric": pick("declared_metric"), "declared_target": pick("declared_target")}
        p.write_text(json.dumps(doc, indent=1, sort_keys=True) + "\n", encoding="utf-8")
        done.append(slug)
    return done


def _get(url):
    # UPTIME-UA-1 (2026-11-21): every spinoff read uptime 0.0 while serving 200. Cloudflare answers the default Python-urllib agent with
    # 403 (error 1010, the same block push_main.py works around), so the probe measured its own user agent, not the app. Send a named agent.
    req = urllib.request.Request(url, headers={"user-agent": "ultrastable-ultrastability/1 (+https://ultrastable.io)"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return 1.0 if r.status < 400 else 0.0
    except urllib.error.HTTPError:
        return 0.0
    except (OSError, ValueError):
        return None  # cannot reach from here: unmeasured, not down


def _rows(root, c) -> list[dict]:
    from . import ledger
    return ledger.rows(root, c["ledger"], branch=False)


def _append(root, c, row: dict) -> None:
    p = Path(root) / c["ledger"]
    p.parent.mkdir(parents=True, exist_ok=True)
    n = len(p.read_text(encoding="utf-8").splitlines()) if p.is_file() else 0
    with p.open("a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps({**row, "seq": n}, sort_keys=True) + "\n")  # seq keeps two same-second rows distinct for the de-duplicating reader


def _key(d, k):
    """A path segment: a dict key, or `#id` for the list element whose id is that (KNOB-PATH-1: knobs in a list of goals by id, not by position)."""
    if k.startswith("#") and isinstance(d, list):
        return next(i for i, x in enumerate(d) if isinstance(x, dict) and x.get("id") == k[1:])
    return k


def _jget(d, path):
    for k in path.split("."):
        d = d[_key(d, k)]
    return d


def _jset(d, path, val):
    ks = path.split(".")
    for k in ks[:-1]:
        d = d[_key(d, k)]
    d[_key(d, ks[-1])] = val


def _param(root, step, revert_to=None, set_to=None):
    p = Path(root) / step["file"]
    doc = json.loads(p.read_text(encoding="utf-8"))
    cur = _jget(doc, step["path"])
    new = revert_to if revert_to is not None else set_to if set_to is not None else max(step["min"], min(step["max"], cur + step["delta"]))
    if new == cur:
        return cur, cur
    _jset(doc, step["path"], new)
    p.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    return cur, new


def _slug(key: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "-", key)


def _predict(v, hours=72) -> str:
    """SPEC-GATE-1: every item the second loop files carries the metric it should move, in the form the scorer reads."""
    return f"{v['reading']} >= {v['min']} within {hours} h" if v.get("min") is not None else f"{v['reading']} <= {v['max']} within {hours} h"


def _item(root, c, key, v, idx, step, value) -> str:
    iid = f"{c['item_prefix']}-{_slug(key)}-{idx + 1}"
    if step["kind"] == "spinoff":
        step = {**step, "labels": ["p1", "agent-ready"], "workstream": "Ultrastability", "what": f"{step['what']} ({key.split(':')[0]}; verb {step['verb']})"}
    p = Path(root) / "docs/issues" / (iid + ".json")
    if not p.exists():
        body = (f"**Owner:** executor\n**Trigger:** essential variable `{key}` out of bounds (reading {value}; limits {v.get('min')} to {v.get('max')})\n"
                f"**Done check:** cmd:python3 -m foundation ultrastability --check\n**Status:** open\n\nULTRASTABILITY-1 second-order step: {step['what']}. {v['why']}\n\n"
                f"**Prediction:** {_predict(v)}\n**Out of scope:** changing the bounds of `{v['id']}` or any other essential variable; a step is judged by the reading, never by relaxing the limit.\n\n"
                f"size: M\n\n**Closing probe:** `python3 -m foundation ultrastability --tick` reads `{v['id']}` inside its bounds.\n")
        p.write_text(json.dumps({"id": iid, "title": f"{iid}: {v['name']} out of bounds: {step['what']}", "body": body, "labels": step["labels"], "milestone": "Now", "workstream": step["workstream"]}, indent=2) + "\n", encoding="utf-8")
    return iid


def tick(root=REPO, apply=False, now=None, read=None, tenants=True, fetch=None) -> dict:
    root = Path(root)
    c = load(root)
    now = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
    vals = read if read is not None else readings(root)
    rows = _rows(root, c)
    out = {"at": now, "variables": {}, "steps": [], "verdicts": [], "unmeasured": [], "unregistered": []}
    try:  # SELF-MODEL-1: the tick consults what the system says it is before it changes anything
        from . import selfmodel
        known = set(selfmodel.build(root, readings=False)["index"])
    except (OSError, KeyError, ValueError):
        known = None  # no self-model in this checkout (a bare test root): nothing to consult
    targets = [(v["id"], v, vals.get(v["reading"])) for v in c["scopes"]["platform"]["variables"]]
    for slug, tv in (tenant_readings(root, fetch) if tenants else {}).items():
        for v in c["scopes"]["tenant"]["variables"]:
            targets.append((f"{slug}:{v['id']}", v, tv.get(v["id"])))
    held = common_mode(targets)
    out["common_mode"] = sorted(held)
    for key in held:  # one sensor fault, one item; no per-tenant step until the reading differs between tenants
        out["variables"][key] = {"value": dict((k, x) for k, _, x in targets)[key], "ok": False, "common_mode": True}
    if held and apply:
        _common(root, c, sorted(held))
    targets = [t for t in targets if t[0] not in held]
    for key, v, value in targets:
        if value is None:  # unmeasured is never in bounds and never a reason to act: one item names what cannot be read
            out["unmeasured"].append(key)
            out["variables"][key] = {"value": None, "ok": False, "unmeasured": True}
            if apply:
                _append(root, c, {"at": now, "ev": "reading", "var": key, "value": None, "ok": False, "unmeasured": True})
                _unmeasured(root, c, key, v)
            continue
        lost = [x for x in v["first_order"] if known is not None and x not in known]
        if lost:  # a system that cannot name the regulators of a variable does not change itself on that variable
            out["unregistered"].append(key)
            out["variables"][key] = {"value": value, "ok": in_bounds(v, value), "unregistered_regulators": lost}
            if apply:
                _unregistered(root, c, key, lost)
            continue
        ok = in_bounds(v, value)
        hist = [r for r in rows if r.get("ev") == "reading" and r["var"] == key and not r.get("unmeasured")]
        recent_out = 0
        for r in reversed(hist):
            if r["ok"]:
                break
            recent_out += 1
        consecutive = 0 if ok else recent_out + 1
        steps = [r for r in rows if r.get("ev") == "step" and r["var"] == key]
        verdicts = {r["step_id"] for r in rows if r.get("ev") == "verdict"}
        pending = next((s for s in reversed(steps) if s["id"] not in verdicts), None)
        # episode = steps since the variable was last in bounds; a ladder position is spent when its step was reverted
        last_ok = max((i + 1 for i, r in enumerate(hist) if r["ok"]), default=0)
        episode = [s for s in steps if s["n"] > last_ok]
        entry = {"value": value, "ok": ok, "consecutive_out": consecutive}
        if pending:
            since = len(hist) - pending["n"] + 1
            verdict = settle_verdict(root, c, pending, ok, since)
            if verdict:
                vr = {"at": now, "ev": "verdict", "var": key, "step_id": pending["id"], "verdict": verdict, "value": value}
                if verdict == "reverted" and pending["kind"] == "param" and apply:
                    _param(root, v["ladder"][pending["idx"]], revert_to=pending["before"])
                out["verdicts"].append(vr)
                if apply:
                    _append(root, c, vr)
                    _settle(root, pending, verdict, value, v)
                pending = None if verdict else pending
        if not ok and not pending and consecutive >= c["patience_ticks"]:
            idx = next((i for i in range(len(v["ladder"])) if not _taken(episode, i)), None)
            draw = _search(root, key, v, episode) if idx is None else None
            if draw:  # ASHBY-SEARCH-1: the ladder is spent and the variable is still out; keep changing step-functions to a field not yet tried
                sidx, val = draw
                step = v["ladder"][sidx]
                row = {"at": now, "ev": "step", "var": key, "idx": sidx, "kind": "param", "search": True, "value": value, "what": f"search: {step['path']} = {val} (untried in this episode)",
                       "id": f"{key}-s{len(episode)}-{now}", "n": len(hist) + 1, "consulted": v["first_order"], "prediction": f"{v['reading']} within bounds within {c['settle_ticks']} ticks"}
                if apply:
                    row["before"], row["after"] = _param(root, step, set_to=val)
                    _append(root, c, row)
                    _provenance(root, row, v, key)
                out["steps"].append(row)
            elif idx is None:
                inc = f"{c['item_prefix']}-{_slug(key)}-REDESIGN"
                entry["exhausted"] = inc
                if apply:
                    p = Path(root) / "docs/issues" / (inc + ".json")
                    if not p.exists():
                        p.write_text(json.dumps({"id": inc, "title": f"{inc}: every second-order step failed to bring {v['name']} back in bounds; redesign", "body": f"**Owner:** executor\n**Trigger:** ladder exhausted for `{key}`\n**Done check:** cmd:python3 -m foundation ultrastability --check\n**Status:** open\n\nThe same failure three times is a design defect (GUIDING-DIRECTIVE section 2): change the structure, not the parameter.\n\nsize: L\n\n**Closing probe:** `python3 -m foundation ultrastability --tick` reads `{key}` inside its bounds.\n", "labels": ["p0", "agent-ready"], "milestone": "Now", "workstream": "Ultrastability"}, indent=2) + "\n", encoding="utf-8")
            else:
                step = v["ladder"][idx]
                row = {"at": now, "ev": "step", "var": key, "idx": idx, "kind": step["kind"], "value": value, "what": step["what"],
                       "id": f"{key}-{idx}-{now}", "n": len(hist) + 1, "consulted": v["first_order"], "prediction": f"{v['reading']} within bounds within {c['settle_ticks']} ticks"}
                if apply:
                    if step["kind"] == "param":
                        row["before"], row["after"] = _param(root, step)
                    else:
                        row["item"] = _item(root, c, key, v, idx, step, value)
                    _append(root, c, row)
                    _provenance(root, row, v, key)
                out["steps"].append(row)
        out["variables"][key] = entry
        if apply:
            _append(root, c, {"at": now, "ev": "reading", "var": key, "value": value, "ok": ok})
    return out


def settle_verdict(root, c, pending, ok, since):
    """SECOND-LOOP-SETTLE-1: kept the moment the variable is back in bounds. A param acts at once, so it is undone after settle_ticks readings.
    An item or spinoff step is work that has to be done first: it is undone only when its item reached a final status and the variable is
    still out, or after item_settle_ticks readings (judging it after 3 readings reverted 14 of 14 before any could act)."""
    if ok:
        return "kept"
    if pending.get("kind") == "param":
        return "reverted" if since >= c["settle_ticks"] else None
    if since >= c.get("item_settle_ticks", c["settle_ticks"]):
        return "reverted"
    st = item_status(root, pending.get("item"))
    return "reverted" if st in ("closed", "done", "live", "shelved", "gate") else None


def item_status(root, iid):
    if not iid:
        return None
    try:
        b = json.loads((Path(root) / "docs/issues" / (iid + ".json")).read_text(encoding="utf-8")).get("body", "")
    except (OSError, ValueError, AttributeError):
        return None
    m = re.search(r"\*\*Status:\*\*\s*([A-Za-z-]+)", b)
    return m.group(1).lower() if m else None


def _taken(episode, idx) -> bool:
    return any(s["idx"] == idx and not s.get("search") for s in episode)


def _search(root, key, v, episode):
    """Ashby's step-function search after the ladder: a value for one of the variable's parameters, drawn at random (seeded by the variable and the
    episode, so a run is reproducible) from its declared range, never one this episode already tried. None when every value has been tried, or the
    variable has no parameter to change: only then does the loop file a redesign item."""
    import random
    cands = []
    for i, st in enumerate(v["ladder"]):
        if st.get("kind") != "param":
            continue
        try:
            cur = _jget(json.loads((Path(root) / st["file"]).read_text(encoding="utf-8")), st["path"])
        except (OSError, ValueError, KeyError, TypeError):
            continue
        tried = {cur} | {s.get("after") for s in episode if s["idx"] == i} | {s.get("before") for s in episode if s["idx"] == i}
        step = abs(st.get("delta") or 1)
        n = int(round((st["max"] - st["min"]) / step))
        cands += [(i, st["min"] + k * step) for k in range(n + 1) if st["min"] + k * step not in tried]
    if not cands:
        return None
    return random.Random(f"{key}|{len(episode)}").choice(cands)


def ashby(root=REPO) -> dict:
    """ASHBY-1: how far the declared system matches Ashby's ultrastable system (Design for a Brain, 1952: chapter 7 Step-functions, chapter 8 The Ultrastable System), computed from the declaration.
    Essential variables with limits; a second feedback that acts only when a variable leaves its limits; step-functions (parameters of the first
    loop) it can change; a search that continues past the ladder until a field holds the variables or the space is spent."""
    c = load(root)
    vs = [(s, v) for s in ("platform", "tenant") for v in c["scopes"][s]["variables"]]
    bounded = [v for _, v in vs if v.get("min") is not None or v.get("max") is not None]
    stepfn = [v for _, v in vs if any(st.get("kind") == "param" for st in v.get("ladder", []))]
    return {"variables": len(vs), "bounded": len(bounded), "with_step_function": len(stepfn), "patience_ticks": c["patience_ticks"], "settle_ticks": c["settle_ticks"],
            "search_after_ladder": True, "step_function_share": round(len(stepfn) / len(vs), 3) if vs else None, "bounded_share": round(len(bounded) / len(vs), 3) if vs else None}


def _unmeasured(root, c, key, v):
    iid = f"{c['item_prefix']}-{_slug(key)}-UNMEASURED"
    p = Path(root) / "docs/issues" / (iid + ".json")
    if not p.exists():
        p.write_text(json.dumps({"id": iid, "title": f"{iid}: essential variable {key} cannot be read", "body": f"**Owner:** executor\n**Trigger:** `{key}` has no fresh reading (source {v['reading']})\n**Done check:** cmd:python3 -m foundation ultrastability --status\n**Status:** open\n\nAn unmeasured variable is never in bounds and never a reason to change the system. Make the reading (probe, writer or fresh ledger row) so the loop can judge it.\n\nsize: S\n\n**Closing probe:** `python3 -m foundation ultrastability --status` shows `{key}` with a value.\n", "labels": ["p1", "agent-ready"], "milestone": "Now", "workstream": "Ultrastability"}, indent=2) + "\n", encoding="utf-8")


def _common(root, c, keys):
    vid = keys[0].split(":", 1)[1]
    iid = f"{c['item_prefix']}-{_slug(vid)}-COMMON-MODE"
    p = Path(root) / "docs/issues" / (iid + ".json")
    if not p.exists():
        p.write_text(json.dumps({"id": iid, "title": f"{iid}: every tenant reads the same out-of-bounds {vid}; fix the reading, not the tenants", "body": f"**Owner:** executor\n**Trigger:** {len(keys)} tenants read one identical out-of-bounds value for `{vid}` ({', '.join(keys[:6])})\n**Done check:** cmd:python3 -m foundation ultrastability --status\n**Status:** open\n\nThe second loop holds its per-tenant steps on this variable (SECOND-LOOP-2 common_mode): the fault is in the shared probe or path.\n\n**Prediction:** tenant.{vid}_distinct_values >= 2 within 72 h\n**Out of scope:** retiring, rebuilding or changing any single tenant.\n\nsize: S\n\n**Closing probe:** `python3 -m foundation ultrastability --status` shows no key in common_mode.\n", "labels": ["p0", "agent-ready"], "milestone": "Now", "workstream": "Ultrastability"}, indent=2) + "\n", encoding="utf-8")


def _unregistered(root, c, key, lost):
    iid = f"{c['item_prefix']}-{_slug(key)}-UNREGISTERED"
    p = Path(root) / "docs/issues" / (iid + ".json")
    if not p.exists():
        p.write_text(json.dumps({"id": iid, "title": f"{iid}: the self-model cannot resolve the regulators of {key}", "body": f"**Owner:** executor\n**Trigger:** `{key}` names regulators the self-model does not know: {', '.join(lost)}\n**Done check:** cmd:python3 -m foundation selfmodel --check\n**Status:** open\n\nRegister the regulator as a loop, clock or worker, or correct the variable's first_order list in doctrine/ultrastability.json.\n\nsize: S\n\n**Closing probe:** `python3 -m foundation selfmodel --check` exits 0.\n", "labels": ["p1", "agent-ready"], "milestone": "Now", "workstream": "Ultrastability"}, indent=2) + "\n", encoding="utf-8")


def _provenance(root, row, v, key=None):
    from . import provenance
    provenance.record(root, {"class": "loop", "actor": "ultrastability", "channel": "loop-run"}, "change",
                      f"second-order step on {key or v['id']}: {row['what']}", ref=row["id"], affected=[key or v["id"]], effect={"status": "pending", "metric": v["reading"], "note": row["prediction"]})
    return row


def _settle(root, step, verdict, value, v):
    from . import provenance
    pid = next((r["id"] for r in provenance.entries(root, raw=True) if r.get("ref") == step["id"] and r.get("kind") == "change"), None)
    if pid:
        provenance.settle(root, pid, verdict, f"{v['reading']}={value}", v["reading"])


def check(root=REPO) -> list[str]:
    root, errs = Path(root), []
    c = load(root)
    for k in ("ledger", "item_prefix", "patience_ticks", "settle_ticks", "credit", "scopes"):
        if k not in c:
            errs.append("missing " + k)
    if "Ashby" not in c.get("credit", ""):
        errs.append("credit to Ashby is missing")
    known = set(readings_keys())
    for scope in ("platform", "tenant"):
        s = c["scopes"].get(scope)
        if not s or not s.get("variables"):
            errs.append(f"scope {scope} declares no essential variables"); continue
        for v in s["variables"]:
            for k in ("id", "name", "reading", "min", "max", "first_order", "ladder", "why"):
                if k not in v:
                    errs.append(f"{scope}.{v.get('id')} missing {k}")
            if v.get("min") is not None and v.get("max") is not None and v["min"] > v["max"]:
                errs.append(f"{scope}.{v['id']} min above max")
            if not v.get("ladder"):
                errs.append(f"{scope}.{v['id']} has no second-order step: a variable with no step cannot be kept in bounds")
            if v.get("min") is None and v.get("max") is None:
                errs.append(f"{scope}.{v['id']} has no limits: an essential variable without limits can never trigger the second loop (Ashby, Design for a Brain, 1952, chapter 8)")
            if scope == "platform" and v.get("reading") not in known:
                errs.append(f"platform.{v['id']} reads {v.get('reading')!r}, which nothing computes")
            for st in v.get("ladder", []):
                if st["kind"] == "param":
                    try:
                        _jget(json.loads((root / st["file"]).read_text(encoding="utf-8")), st["path"])
                    except (OSError, KeyError, ValueError):
                        errs.append(f"{scope}.{v['id']} step names {st['file']}:{st['path']}, which does not exist")
                    if st["min"] > st["max"]:
                        errs.append(f"{scope}.{v['id']} step limits are inverted")
                elif st["kind"] == "spinoff":
                    if st["verb"] not in (root / "foundation/spinoff.py").read_text(encoding="utf-8"):
                        errs.append(f"{scope}.{v['id']} step verb {st['verb']!r} is not in foundation/spinoff.py")
                elif st["kind"] != "item":
                    errs.append(f"{scope}.{v['id']} unknown step kind {st['kind']}")
    if (root / DATA).is_file() and _declared(_parse(root)) != _declared(data(root)):  # the readings part moves with every tick; only the declaration must match
        errs.append(f"{DATA} is stale: run ultrastability --data --apply")
    return errs


def _declared(d) -> dict:
    return {k: v for k, v in (d or {}).items() if k not in ("now", "readiness", "self_changes")}


def _parse(root):
    t = (Path(root) / DATA).read_text(encoding="utf-8")
    try:
        return json.loads(t[t.index("export default ") + len("export default "):].rstrip().rstrip(";"))
    except ValueError:
        return None


def readings_keys():
    return ("yearsim.horizon_p10", "yearsim.self_rate", "criticality.cost", "criticality.verified_share", "claims.drift", "criticality.k", "resilience.stalled", "uiux.findings", "uiux.happy_paths",
            "owner.interventions_7d", "ultra.keep_rate", "spec.quality", "research.met_share")


def data(root=REPO) -> dict:
    c = load(root)
    d = {"credit": c["credit"], "scopes": {}}
    for name, s in c["scopes"].items():
        d["scopes"][name] = {"status": s["status"], "what": s["what"], "variables": [
            {"id": v["id"], "name": v["name"], "min": v["min"], "max": v["max"], "unit": v["unit"], "why": v["why"], "first_order": v["first_order"], "steps": [st["what"] for st in v["ladder"]]}
            for v in s["variables"]]}
    last = last_readings(root)  # ONE-YEAR-READY-1: the page shows what the variables read at the last tick, regenerated with the ledger
    d["now"] = {v["id"]: last.get(v["id"]) for v in c["scopes"]["platform"]["variables"]}
    d["readiness"] = readiness(root, last)
    d["self_changes"] = self_changes(root)
    return d


def self_changes(root=REPO, last=12) -> list:
    """SECOND-LOOP-2: the latest parameter changes the slow loop made to itself, each with the value before and after and its verdict."""
    try:
        rows = [json.loads(l) for l in (Path(root) / load(root)["ledger"]).read_text(encoding="utf-8").splitlines() if '"step"' in l or '"verdict"' in l]
    except (OSError, ValueError):
        return []
    verdict = {r["step_id"]: r.get("verdict") for r in rows if r.get("ev") == "verdict"}
    steps = [r for r in rows if r.get("ev") == "step" and r.get("kind") == "param" and ":" not in r.get("var", "")]
    return [{"at": r["at"], "var": r["var"], "what": r["what"], "before": r.get("before"), "after": r.get("after"), "reading": r.get("value"),
             "verdict": verdict.get(r["id"], "pending")} for r in steps[-last:]][::-1]


def render(root=REPO) -> str:
    return ("// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0\n// GENERATED by python3 -m foundation ultrastability --data --apply from doctrine/ultrastability.json. Do not edit; --check fails when stale.\n"
            "export default " + json.dumps(data(root), indent=1, sort_keys=True) + ";\n")


def _followers() -> dict:
    """WATCHDOG-FOLLOW-1: the year simulation (YEAR-SIM-1), say-do (SAY-DO-1) and trajectory (TRAJECTORY-1) run inside every
    watchdog tick, through the tick the watchdog already runs. A failure is returned, never swallowed."""
    import importlib
    res = {}
    try:
        from . import modelwatch
        res["modelwatch"] = "changed %d" % len(modelwatch.observed(REPO, apply=True).get("changed", []))  # MODEL-HEAL-1
    except Exception as e:  # reported in the tick output; the other followers still run
        res["modelwatch"] = "failed: " + repr(e)
    for name in ("yearsim", "saydo", "trajectory"):
        try:
            r = importlib.import_module("foundation." + name).run(REPO, apply=True)
            res[name] = "ok" if r is not None else "no result"
        except Exception as e:  # recorded in the tick output and the ledgers it writes; the next follower still runs
            res[name] = "failed: " + repr(e)
    return res


def main(argv=None) -> int:
    a = argv if argv is not None else sys.argv[1:]
    if "--check" in a:
        e = check(); print("\n".join(e) or "ultrastability ok: two loops, every variable has a bound and a second-order step"); return 1 if e else 0
    if "--data" in a:
        if "--apply" in a:
            (REPO / DATA).write_text(render(), encoding="utf-8"); print("wrote", DATA)
        else:
            print(render())
        return 0
    if "--tenants" in a:
        print(json.dumps(write_tenants(REPO) if "--apply" in a else tenant_readings(REPO), indent=1)); return 0
    if "--tick" in a or "--status" in a:
        out = tick(apply="--apply" in a and "--tick" in a)
        if "--apply" in a and "--tick" in a:
            out["followers"] = _followers()
        print(json.dumps(out, indent=2)); return 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main())

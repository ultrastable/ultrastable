# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""ULTRASTABILITY-1: Ashby's two loops, as code. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation ultrastability [--tick [--apply] | --check | --data [--apply] | --status | --tenants [--apply]]

ESSENTIAL VARIABLES  doctrine/ultrastability.json declares, per scope (platform, tenant), the variables whose bounds are the system's viability limits.
FIRST ORDER          the existing loops (probe-and-revert, cost probe, claims check, executor) correct disturbance without changing the system.
SECOND ORDER         when a variable has been out of bounds for `patience_ticks` consecutive ticks, one discrete step from its ladder is taken: a parameter
                     change within declared limits, or a restructure item with a closing probe. The step is logged with its provenance row and kept only if the
                     variable is back inside its bounds within `settle_ticks`; otherwise a parameter is restored and the next step on the ladder is taken.
                     A ladder that is exhausted files an incident item for redesign (the same failure three times).
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
    return {"criticality.cost": cost, "criticality.verified_share": round(verified, 3), "claims.drift": drift, "criticality.k": c["k"], "resilience.stalled": resilience.stalled_reading(root),
            "uiux.findings": uiux.status_reading(root, "findings_blocking"), "uiux.happy_paths": uiux.status_reading(root, "happy_path_pass_share")}


def fresh_cost(root, value, now=None, max_age_days=3):
    """Cost is judged only from a recent reading of this account: a stale row (or none) is unmeasured, never a breach."""
    p = Path(root) / "ops/cost.jsonl"
    rows = [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()] if p.is_file() else []
    if not rows:
        return None
    at = datetime.fromisoformat(rows[-1]["at"].replace("Z", "+00:00"))
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
            out[slug] = {"uptime": get(a["url"]), "spend": have.get("spend_vs_budget"), "claims_drift": have.get("claims_drift"), "value": have.get("declared_metric")}
    return out


def write_tenants(root=REPO, fetch=None, now=None) -> list[str]:
    """Write ops/tenants/<slug>.json for every live tenant: the uptime probe now, and the other readings kept from the tenant's own loop (null until it writes them)."""
    root, now = Path(root), (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
    done = []
    for slug, r in tenant_readings(root, fetch).items():
        p = root / "ops/tenants" / (slug + ".json")
        have = json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {}
        p.parent.mkdir(parents=True, exist_ok=True)
        doc = {"slug": slug, "at": now, "uptime": r["uptime"], "spend_vs_budget": have.get("spend_vs_budget"), "claims_drift": have.get("claims_drift"), "declared_metric": have.get("declared_metric")}
        p.write_text(json.dumps(doc, indent=1, sort_keys=True) + "\n", encoding="utf-8")
        done.append(slug)
    return done


def _get(url):
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
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


def _jget(d, path):
    for k in path.split("."):
        d = d[k]
    return d


def _jset(d, path, val):
    ks = path.split(".")
    for k in ks[:-1]:
        d = d[k]
    d[ks[-1]] = val


def _param(root, step, revert_to=None):
    p = Path(root) / step["file"]
    doc = json.loads(p.read_text(encoding="utf-8"))
    cur = _jget(doc, step["path"])
    new = revert_to if revert_to is not None else max(step["min"], min(step["max"], cur + step["delta"]))
    if new == cur:
        return cur, cur
    _jset(doc, step["path"], new)
    p.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    return cur, new


def _slug(key: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "-", key)


def _item(root, c, key, v, idx, step, value) -> str:
    iid = f"{c['item_prefix']}-{_slug(key)}-{idx + 1}"
    if step["kind"] == "spinoff":
        step = {**step, "labels": ["p1", "agent-ready"], "workstream": "Ultrastability", "what": f"{step['what']} ({key.split(':')[0]}; verb {step['verb']})"}
    p = Path(root) / "docs/issues" / (iid + ".json")
    if not p.exists():
        body = (f"**Owner:** executor\n**Trigger:** essential variable `{key}` out of bounds (reading {value}; limits {v.get('min')} to {v.get('max')})\n"
                f"**Done check:** probe:python3 -m foundation ultrastability --check\n**Status:** open\n\nULTRASTABILITY-1 second-order step: {step['what']}. {v['why']}\n\n"
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
            if ok:
                verdict = "kept"
            elif since >= c["settle_ticks"]:
                verdict = "reverted"
            else:
                verdict = None
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
            if idx is None:
                inc = f"{c['item_prefix']}-{_slug(key)}-REDESIGN"
                entry["exhausted"] = inc
                if apply:
                    p = Path(root) / "docs/issues" / (inc + ".json")
                    if not p.exists():
                        p.write_text(json.dumps({"id": inc, "title": f"{inc}: every second-order step failed to bring {v['name']} back in bounds; redesign", "body": f"**Owner:** executor\n**Trigger:** ladder exhausted for `{key}`\n**Done check:** probe:python3 -m foundation ultrastability --check\n**Status:** open\n\nThe same failure three times is a design defect (GUIDING-DIRECTIVE section 2): change the structure, not the parameter.\n\nsize: L\n\n**Closing probe:** `python3 -m foundation ultrastability --tick` reads `{key}` inside its bounds.\n", "labels": ["p0", "agent-ready"], "milestone": "Now", "workstream": "Ultrastability"}, indent=2) + "\n", encoding="utf-8")
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


def _taken(episode, idx) -> bool:
    return any(s["idx"] == idx for s in episode)


def _unmeasured(root, c, key, v):
    iid = f"{c['item_prefix']}-{_slug(key)}-UNMEASURED"
    p = Path(root) / "docs/issues" / (iid + ".json")
    if not p.exists():
        p.write_text(json.dumps({"id": iid, "title": f"{iid}: essential variable {key} cannot be read", "body": f"**Owner:** executor\n**Trigger:** `{key}` has no fresh reading (source {v['reading']})\n**Done check:** probe:python3 -m foundation ultrastability --status\n**Status:** open\n\nAn unmeasured variable is never in bounds and never a reason to change the system. Make the reading (probe, writer or fresh ledger row) so the loop can judge it.\n\nsize: S\n\n**Closing probe:** `python3 -m foundation ultrastability --status` shows `{key}` with a value.\n", "labels": ["p1", "agent-ready"], "milestone": "Now", "workstream": "Ultrastability"}, indent=2) + "\n", encoding="utf-8")


def _unregistered(root, c, key, lost):
    iid = f"{c['item_prefix']}-{_slug(key)}-UNREGISTERED"
    p = Path(root) / "docs/issues" / (iid + ".json")
    if not p.exists():
        p.write_text(json.dumps({"id": iid, "title": f"{iid}: the self-model cannot resolve the regulators of {key}", "body": f"**Owner:** executor\n**Trigger:** `{key}` names regulators the self-model does not know: {', '.join(lost)}\n**Done check:** probe:python3 -m foundation selfmodel --check\n**Status:** open\n\nRegister the regulator as a loop, clock or worker, or correct the variable's first_order list in doctrine/ultrastability.json.\n\nsize: S\n\n**Closing probe:** `python3 -m foundation selfmodel --check` exits 0.\n", "labels": ["p1", "agent-ready"], "milestone": "Now", "workstream": "Ultrastability"}, indent=2) + "\n", encoding="utf-8")


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
    if (root / DATA).is_file() and (root / DATA).read_text(encoding="utf-8") != render(root):
        errs.append(f"{DATA} is stale: run ultrastability --data --apply")
    return errs


def readings_keys():
    return ("criticality.cost", "criticality.verified_share", "claims.drift", "criticality.k", "resilience.stalled", "uiux.findings", "uiux.happy_paths")


def data(root=REPO) -> dict:
    c = load(root)
    d = {"credit": c["credit"], "scopes": {}}
    for name, s in c["scopes"].items():
        d["scopes"][name] = {"status": s["status"], "what": s["what"], "variables": [
            {"id": v["id"], "name": v["name"], "min": v["min"], "max": v["max"], "unit": v["unit"], "why": v["why"], "first_order": v["first_order"], "steps": [st["what"] for st in v["ladder"]]}
            for v in s["variables"]]}
    return d


def render(root=REPO) -> str:
    return ("// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0\n// GENERATED by python3 -m foundation ultrastability --data --apply from doctrine/ultrastability.json. Do not edit; --check fails when stale.\n"
            "export default " + json.dumps(data(root), indent=1, sort_keys=True) + ";\n")


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
        print(json.dumps(tick(apply="--apply" in a and "--tick" in a), indent=2)); return 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main())

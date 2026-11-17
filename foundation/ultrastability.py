# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""ULTRASTABILITY-1: Ashby's two loops, as code. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation ultrastability [--tick [--apply] | --check | --data [--apply] | --status]

ESSENTIAL VARIABLES  doctrine/ultrastability.json declares, per scope (platform, tenant), the variables whose bounds are the system's viability limits.
FIRST ORDER          the existing loops (probe-and-revert, cost probe, claims check, executor) correct disturbance without changing the system.
SECOND ORDER         when a variable has been out of bounds for `patience_ticks` consecutive ticks, one discrete step from its ladder is taken: a parameter
                     change within declared limits, or a restructure item with a closing probe. The step is logged with its provenance row and kept only if the
                     variable is back inside its bounds within `settle_ticks`; otherwise a parameter is restored and the next step on the ladder is taken.
                     A ladder that is exhausted files an incident item for redesign (the same failure three times).
Every reading, step and verdict is a row in ops/ultrastability.jsonl. Tests: tests/foundation/test_ultrastability.py.
"""
from __future__ import annotations
import json, sys
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
    return {"criticality.cost": c["cost"], "criticality.verified_share": round(verified, 3), "claims.drift": drift, "criticality.k": c["k"]}


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


def _item(root, c, v, idx, step, value) -> str:
    iid = f"{c['item_prefix']}-{v['id']}-{idx + 1}"
    p = Path(root) / "docs/issues" / (iid + ".json")
    if not p.exists():
        body = (f"**Owner:** executor\n**Trigger:** essential variable `{v['id']}` out of bounds (reading {value}; limits {v.get('min')} to {v.get('max')})\n"
                f"**Done check:** probe:python3 -m foundation ultrastability --check\n**Status:** open\n\nULTRASTABILITY-1 second-order step: {step['what']}. {v['why']}\n\n"
                f"size: M\n\n**Closing probe:** `python3 -m foundation ultrastability --tick` reads `{v['id']}` inside its bounds.\n")
        p.write_text(json.dumps({"id": iid, "title": f"{iid}: {v['name']} out of bounds: {step['what']}", "body": body, "labels": step["labels"], "milestone": "Now", "workstream": step["workstream"]}, indent=2) + "\n", encoding="utf-8")
    return iid


def tick(root=REPO, apply=False, now=None, read=None) -> dict:
    root = Path(root)
    c = load(root)
    now = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ")
    vals = read if read is not None else readings(root)
    rows = _rows(root, c)
    out = {"at": now, "variables": {}, "steps": [], "verdicts": []}
    for v in c["scopes"]["platform"]["variables"]:
        value = vals.get(v["reading"])
        ok = in_bounds(v, value)
        hist = [r for r in rows if r.get("ev") == "reading" and r["var"] == v["id"]]
        recent_out = 0
        for r in reversed(hist):
            if r["ok"]:
                break
            recent_out += 1
        consecutive = 0 if ok else recent_out + 1
        steps = [r for r in rows if r.get("ev") == "step" and r["var"] == v["id"]]
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
                vr = {"at": now, "ev": "verdict", "var": v["id"], "step_id": pending["id"], "verdict": verdict, "value": value}
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
                inc = f"{c['item_prefix']}-{v['id']}-REDESIGN"
                entry["exhausted"] = inc
                if apply:
                    p = Path(root) / "docs/issues" / (inc + ".json")
                    if not p.exists():
                        p.write_text(json.dumps({"id": inc, "title": f"{inc}: every second-order step failed to bring {v['name']} back in bounds; redesign", "body": f"**Owner:** executor\n**Trigger:** ladder exhausted for `{v['id']}`\n**Done check:** probe:python3 -m foundation ultrastability --check\n**Status:** open\n\nThe same failure three times is a design defect (GUIDING-DIRECTIVE section 2): change the structure, not the parameter.\n\nsize: L\n\n**Closing probe:** `python3 -m foundation ultrastability --tick` reads `{v['id']}` inside its bounds.\n", "labels": ["p0", "agent-ready"], "milestone": "Now", "workstream": "Ultrastability"}, indent=2) + "\n", encoding="utf-8")
            else:
                step = v["ladder"][idx]
                row = {"at": now, "ev": "step", "var": v["id"], "idx": idx, "kind": step["kind"], "value": value, "what": step["what"],
                       "id": f"{v['id']}-{idx}-{now}", "n": len(hist) + 1, "prediction": f"{v['reading']} within bounds within {c['settle_ticks']} ticks"}
                if apply:
                    if step["kind"] == "param":
                        row["before"], row["after"] = _param(root, step)
                    else:
                        row["item"] = _item(root, c, v, idx, step, value)
                    _append(root, c, row)
                    _provenance(root, row, v)
                out["steps"].append(row)
        out["variables"][v["id"]] = entry
        if apply:
            _append(root, c, {"at": now, "ev": "reading", "var": v["id"], "value": value, "ok": ok})
    return out


def _taken(episode, idx) -> bool:
    return any(s["idx"] == idx for s in episode)


def _provenance(root, row, v):
    from . import provenance
    provenance.record(root, {"class": "loop", "actor": "ultrastability", "channel": "loop-run"}, "change",
                      f"second-order step on {v['id']}: {row['what']}", ref=row["id"], affected=[v["id"]], effect={"status": "pending", "metric": v["reading"], "note": row["prediction"]})
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
    return ("criticality.cost", "criticality.verified_share", "claims.drift", "criticality.k")


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
    if "--tick" in a or "--status" in a:
        print(json.dumps(tick(apply="--apply" in a and "--tick" in a), indent=2)); return 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main())

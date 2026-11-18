# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""GOALS-1 (Rowan, 2026-11-18): what Ultrastable is working toward, set by the system itself, with knobs it turns to get there. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation goals [--tick [--apply] | --status | --propose [--apply] | --check | --page [--apply]]

GOAL TREE   doctrine/goals.json: the standing goal (bootstrap to criticality), bold goals the system proposed, and small goals down to single essential variables.
            Each goal has a measured variable (read from live ledgers), a bound, a deadline and the knobs that move it.
CONTROLLER  --tick reads every variable. A goal out of bounds for `patience_ticks` gets ONE knob turned ONE step inside the knob's safe range. The step is logged as a
            decision with a prediction (decision point goal-knob, DECISION-METRIC: goal-knob), kept only if the variable moves toward its target within `settle_ticks`,
            otherwise restored and the knob counted as spent for that episode. Contended knobs (also turned by the second-order loop or the product manager) wait out their cooldown.
RE-PLAN     When every knob is spent or at its limit and the goal is still missed, the step-function: a Q-GOAL-<id>-REPLAN item and a proposal row name the new knob or sub-goal.
SELF-SET    --propose revises goals (ratchet a target after a met streak) and adds goals from generators over the idea loop, each with a provenance row; adopted by the system.
Every reading, step, verdict and proposal is a row in ops/goals/*.jsonl. An unreadable variable is unmeasured, never in bounds and never a reason to turn a knob.
Consumers: .github/workflows/watchdog.yml (tick), scripts/regen_generated.py (page), site/worker.js (/goals, /api/goals), doctrine/rules.json (every-goal-has-knob). Tests: tests/foundation/test_goals.py."""
from __future__ import annotations
import datetime as dt, json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/goals.json"
OPS = {">=": lambda a, b: a >= b, "<=": lambda a, b: a <= b}
RESOURCE_KEYS = ("d1_rows_read", "d1_rows_written", "workers_requests", "ai_neurons")


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def _now(now=None) -> dt.datetime:
    return now or dt.datetime.now(dt.timezone.utc)


def _iso(t) -> str:
    return t.strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def _lines(p: Path) -> list[dict]:
    out = []
    if p.is_file():
        for l in p.read_text(encoding="utf-8").splitlines():
            if l.strip():
                try:
                    out.append(json.loads(l))
                except ValueError:
                    continue
    return out


def _append(root, rel: str, row: dict) -> None:
    p = Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(row, sort_keys=True, ensure_ascii=False) + "\n")


def _jget(d, path):
    for k in path.split("."):
        d = d[k]
    return d


def _jset(d, path, val):
    ks = path.split(".")
    for k in ks[:-1]:
        d = d[k]
    d[ks[-1]] = val


def knob_value(root, knob: dict):
    return _jget(json.loads((Path(root) / knob["file"]).read_text(encoding="utf-8")), knob["path"])


def _write_knob(root, knob: dict, val) -> None:
    """Change one number. A targeted text edit keeps the file's own formatting and diff small; it is verified by parsing, and falls back to a full rewrite."""
    p = Path(root) / knob["file"]
    text = p.read_text(encoding="utf-8")
    doc = json.loads(text)
    want = json.loads(text)
    _jset(want, knob["path"], val)
    last = knob["path"].split(".")[-1]
    hits = list(re.finditer(r'("' + re.escape(last) + r'"\s*:\s*)(-?\d+(?:\.\d+)?)', text))
    for m in hits:
        cand = text[:m.start(2)] + (json.dumps(val)) + text[m.end(2):]
        try:
            if json.loads(cand) == want:
                p.write_text(cand, encoding="utf-8")
                return
        except ValueError:
            continue
    ind = next((len(l) - len(l.lstrip()) for l in text.splitlines() if l.startswith(" ")), 2)
    _ = doc
    p.write_text(json.dumps(want, indent=ind, ensure_ascii=False) + "\n", encoding="utf-8")


def tree(root=REPO) -> list[dict]:
    """The goals in force: the doctrine goals, with targets revised by the system's own adopted proposals and goals the system added."""
    root, c = Path(root), load(root)
    goals = {g["id"]: dict(g) for g in c["goals"]}
    for r in _lines(root / c["proposals"]):
        if r.get("ev") != "adopt":
            continue
        if r["kind"] == "revise" and r["goal"] in goals:
            goals[r["goal"]]["target"] = r["new"]
            goals[r["goal"]]["revised_at"] = r["at"]
        elif r["kind"] == "add" and r["goal"]["id"] not in goals:
            goals[r["goal"]["id"]] = dict(r["goal"], proposed_by="system", added_at=r["at"])
    return list(goals.values())


# ---- readings ----------------------------------------------------------------------------------------------------------
def readings(root=REPO) -> dict:
    """Current value of every goal variable from the ledgers the loops already write. None means unmeasured."""
    root, out = Path(root), {}
    try:
        from . import criticality
        c = criticality.compute(root, feed_ok=True)
        regime = {"self-sustaining": 1.0, "driven": 0.5}.get(c.get("regime"), 0.0)
        out.update({"criticality.regime_score": regime, "criticality.self_deploys": c.get("self_deploys"), "criticality.cost": c.get("cost"),
                    "criticality.k": c.get("k"), "criticality.verified_share": round(c["verified_deploys"] / c["deploys"], 3) if c.get("deploys") else 1.0,
                    "criticality.autonomy_rate": round(1 - c["human_touches"] / max(1, c["deploys"] + c["human_touches"]), 4) if c.get("deploys") is not None else None})
        cp = root / "ops/cost.jsonl"
        if out["criticality.cost"] is not None and cp.is_file():  # cost is judged only from a recent reading of this account
            from . import ultrastability
            out["criticality.cost"] = ultrastability.fresh_cost(root, out["criticality.cost"])
    except (OSError, ValueError, KeyError, ImportError):
        pass
    sp = root / "ops/spinoff"
    latest: dict = {}
    for r in _lines(sp / "metrics.jsonl"):
        if r.get("slug"):
            latest[r["slug"]] = r
    out["spinoff.apps_used"] = sum(1 for r in latest.values() if (r.get("uses_7d") or 0) >= 1) if latest else None
    ev = _lines(sp / "queue.jsonl")
    launched = sum(1 for r in _lines(sp / "ledger.jsonl") if r.get("event") == "launch")
    out["spinoff.queued_ideas"] = max(0, sum(1 for r in ev if r.get("event") == "idea") - launched) if ev else None
    out["tenants.served"] = sum(1 for p in sorted((root / "instances").glob("*/instance.json")) if p.parent.name != "ultrastable")
    ft = root / "ops/free-tier.json"
    if ft.is_file():
        try:
            res = json.loads(ft.read_text(encoding="utf-8"))["resources"]
            out["free_tier.busiest_share"] = round(max(res[k]["used"] / res[k]["limit"] for k in RESOURCE_KEYS if k in res), 3)
        except (ValueError, KeyError, ZeroDivisionError):
            out["free_tier.busiest_share"] = None
    try:
        from . import claims
        out["claims.drift"] = len(claims.evaluate(root)[2])
    except Exception:  # a missing claims checker leaves the variable unmeasured; the item below names it
        out["claims.drift"] = None
    return out


def in_bounds(g: dict, value) -> bool:
    return value is not None and OPS[g["op"]](value, g["target"])


def toward(g: dict, before, after) -> bool:
    """True when the variable is now closer to its target than at `before`, or inside it."""
    if before is None or after is None:
        return False
    if in_bounds(g, after):
        return True
    return after > before if g["op"] == ">=" else after < before


# ---- controller --------------------------------------------------------------------------------------------------------
def _slug(s: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "-", s)


def _contended(root, c, knob, t) -> str | None:
    """Another controller turned the same parameter inside the cooldown: wait, never fight it."""
    since = t - dt.timedelta(hours=knob["cooldown_h"])
    for r in _lines(Path(root) / "ops/ultrastability.jsonl"):  # its ladder turns the executor wake count (doctrine/ultrastability.json)
        if knob["path"] == "chain.max_runs_per_day" and r.get("ev") == "step" and r.get("kind") == "param" and r.get("at") and _parse(r["at"]) >= since:
            return "the ultrastability second-order loop turned it " + r["at"]
    for r in _lines(Path(root) / "ops/growth/knob-log.jsonl"):
        if r.get("file") == knob["file"] and r.get("path") == knob["path"] and r.get("at") and _parse(r["at"]) >= since:
            return "the product manager turned it " + r["at"]
    return None


def _item(root, c, g, kind, title, body, labels=("p1", "agent-ready")) -> str:
    iid = f"{c['item_prefix']}-{_slug(g['id'])}-{kind}"
    p = Path(root) / "docs/issues" / (iid + ".json")
    if not p.exists():
        p.parent.mkdir(parents=True, exist_ok=True)
        full = (f"**Owner:** executor\n**Trigger:** goal `{g['id']}` out of bounds with every knob spent (reading vs {g['op']} {g['target']} {g['unit']}; deadline {g['deadline']})\n"
                f"**Done check:** cmd:python3 -m foundation goals --check\n**Status:** open\n\n{body}\n\nsize: M\n\n**Closing probe:** `python3 -m foundation goals --tick` reads `{g['id']}` inside its bound.\n")
        p.write_text(json.dumps({"id": iid, "title": f"{iid}: {title}", "body": full, "labels": list(labels), "milestone": "Now", "workstream": "Goals"}, indent=2) + "\n", encoding="utf-8")
    return iid


def _decision(root, g, knob, before, after, step_id, t):
    from . import decisions
    return decisions.record(root, "goal-knob", f"{knob['id']} {before} to {after}", f"{g['id']}:{step_id}", 1.0,
                            f"{g['reading']} {g['op']} {g['target']} missed; turned {knob['id']} one step ({knob['what']})", alternatives=max(0, len(g["knobs"]) - 1), now=t)


def _provenance(root, row, g, knob):
    try:
        from . import provenance
        provenance.record(root, {"class": "loop", "actor": "goals", "channel": "loop-run"}, "change",
                          f"goal {g['id']}: turned knob {knob['id']} {row['before']} to {row['after']}", ref=row["id"], affected=[g["id"], knob["id"]],
                          effect={"status": "pending", "metric": g["reading"], "note": row["prediction"]})
    except (ImportError, OSError, ValueError, KeyError, TypeError):
        pass  # provenance is a second record of a step already in the goals ledger; never a reason to skip the step


def tick(root=REPO, apply=False, now=None, read=None) -> dict:
    """One controller pass. `read` injects the readings (tests); otherwise they come from the live ledgers."""
    root, c, t = Path(root), load(root), _now(now)
    at = _iso(t)
    vals = read if read is not None else readings(root)
    rows = _lines(root / c["ledger"])
    kb = {k["id"]: k for k in c["knobs"]}
    out = {"at": at, "goals": {}, "steps": [], "verdicts": [], "replans": [], "unmeasured": []}
    for g in tree(root):
        gid, value = g["id"], vals.get(g["reading"])
        if value is None:  # never in bounds and never a reason to act
            out["unmeasured"].append(gid)
            out["goals"][gid] = {"value": None, "ok": False, "unmeasured": True}
            if apply:
                _append(root, c["ledger"], {"at": at, "ev": "reading", "goal": gid, "value": None, "ok": False, "unmeasured": True})
            continue
        ok = in_bounds(g, value)
        hist = [r for r in rows if r.get("ev") == "reading" and r["goal"] == gid and not r.get("unmeasured")]
        out_streak = 0
        for r in reversed(hist):
            if r["ok"]:
                break
            out_streak += 1
        consecutive = 0 if ok else out_streak + 1
        steps = [r for r in rows if r.get("ev") == "step" and r["goal"] == gid]
        done = {r["step_id"] for r in rows if r.get("ev") == "verdict"}
        pending = next((s for s in reversed(steps) if s["id"] not in done), None)
        last_ok = max((i + 1 for i, r in enumerate(hist) if r["ok"]), default=0)
        episode = [s for s in steps if s["n"] > last_ok]
        entry = {"value": value, "ok": ok, "consecutive_out": consecutive}
        if pending:
            since = len(hist) - pending["n"] + 1
            verdict = "kept" if toward(g, pending["value"], value) else "reverted" if since >= c["settle_ticks"] else None
            if verdict:
                vr = {"at": at, "ev": "verdict", "goal": gid, "step_id": pending["id"], "verdict": verdict, "value": value, "from": pending["value"]}
                if verdict == "reverted" and apply:
                    _write_knob(root, kb[pending["knob"]], pending["before"])
                out["verdicts"].append(vr)
                rows.append(vr)  # this tick's verdict counts when the next knob is chosen below
                if apply:
                    _append(root, c["ledger"], vr)
                pending = None
        if not ok and not pending and consecutive >= c["patience_ticks"]:
            spent = {s["knob"] for s in episode}
            reverted = {r["step_id"] for r in rows if r.get("ev") == "verdict" and r["verdict"] == "reverted"}
            cand, why_not = None, []
            for ref in g["knobs"]:
                if "ref" in ref:
                    continue  # the second-order loop owns this ladder (ULTRASTABILITY-1)
                k = kb[ref["knob"]]
                if k["id"] in spent and any(s["id"] in reverted for s in episode if s["knob"] == k["id"]):
                    why_not.append(f"{k['id']}: tried, no improvement"); continue
                need_up = g["op"] == ">="
                incr = (ref["up_moves"] == "up") == need_up
                cur = knob_value(root, k)
                new = round(min(k["max"], cur + k["step"]) if incr else max(k["min"], cur - k["step"]), 6)
                if new == cur:
                    why_not.append(f"{k['id']}: at its {'max' if incr else 'min'} {cur}"); continue
                wait = _contended(root, c, k, t)
                if wait:
                    why_not.append(f"{k['id']}: {wait}"); continue
                last = max((_parse(s["at"]) for s in steps if s["knob"] == k["id"]), default=None)
                if last and t < last + dt.timedelta(hours=k["cooldown_h"]):
                    why_not.append(f"{k['id']}: cooling down"); continue
                cand = (k, cur, new)
                break
            if cand:
                k, cur, new = cand
                row = {"at": at, "ev": "step", "goal": gid, "knob": k["id"], "before": cur, "after": new, "value": value, "n": len(hist) + 1,
                       "id": f"{gid}-{k['id']}-{at}", "what": k["what"],
                       "prediction": f"{g['reading']} moves toward {g['op']} {g['target']} within {c['settle_ticks']} ticks"}
                if apply:
                    _write_knob(root, k, new)
                    row["decision"] = (_decision(root, g, k, cur, new, row["id"], t) or {}).get("id")
                    _append(root, c["ledger"], row)
                    _provenance(root, row, g, k)
                out["steps"].append(row)
            elif why_not and not any("cooling" in w or "turned" in w for w in why_not):
                entry["replan"] = why_not  # every knob spent or at its limit: change the structure, not the parameter
                out["replans"].append({"goal": gid, "why": why_not})
                if apply:
                    iid = _item(root, c, g, "REPLAN", f"every knob is spent for {g['name']}; add a knob or a sub-goal",
                                f"Knobs tried: {'; '.join(why_not)}.\nThe step-function (GOALS-1): propose a new knob (a parameter that moves {g['reading']}) or a sub-goal, register it in doctrine/goals.json with a range, and let the controller try it.")
                    _append(root, c["proposals"], {"at": at, "ev": "replan", "goal": gid, "item": iid, "why": why_not, "reading": value,
                                                   "by": {"class": "loop", "actor": "goals", "channel": "loop-run"}})
            entry["blocked"] = why_not
        out["goals"][gid] = entry
        if apply:
            _append(root, c["ledger"], {"at": at, "ev": "reading", "goal": gid, "value": value, "ok": ok})
    return out


# ---- the system sets and revises its own goals --------------------------------------------------------------------------
def propose(root=REPO, apply=False, now=None, read=None) -> dict:
    """Ratchet: a goal met for `ratchet_after_met_ticks` readings in a row gets a tighter target (by `ratchet_step` of the distance still available, never past a bound),
    adopted by the system with a provenance row. Generators over the idea loop add goals that do not exist yet."""
    root, c, t = Path(root), load(root), _now(now)
    at = _iso(t)
    vals = read if read is not None else readings(root)
    rows = _lines(root / c["ledger"])
    out = {"at": at, "revised": [], "added": []}
    ratchetable = {"criticality.autonomy_rate": 0.999, "criticality.self_deploys": None, "spinoff.apps_used": None, "tenants.served": None}
    for g in tree(root):
        hist = [r for r in rows if r.get("ev") == "reading" and r["goal"] == g["id"] and not r.get("unmeasured")]
        if g["reading"] not in ratchetable or len(hist) < c["ratchet_after_met_ticks"] or not all(r["ok"] for r in hist[-c["ratchet_after_met_ticks"]:]):
            continue
        if g.get("revised_at") and _parse(g["revised_at"]) >= _parse(hist[-c["ratchet_after_met_ticks"]]["at"]):
            continue  # one revision per met streak
        cap = ratchetable[g["reading"]]
        old = g["target"]
        new = round(old * (1 + c["ratchet_step"]), 4) if g["op"] == ">=" else round(old * (1 - c["ratchet_step"]), 4)
        if cap is not None:
            new = min(new, cap)
        if g["op"] == ">=" and isinstance(old, int):
            new = max(old + 1, int(round(new)))
        if new == old:
            continue
        row = {"at": at, "ev": "adopt", "kind": "revise", "goal": g["id"], "old": old, "new": new, "basis": f"met for {c['ratchet_after_met_ticks']} consecutive readings (value {vals.get(g['reading'])}); raise the bar",
               "by": {"class": "loop", "actor": "goals", "channel": "loop-run"}}
        out["revised"].append(row)
        if apply:
            _append(root, c["proposals"], row)
            _prov_goal(root, row, f"revised goal {g['id']}: target {old} to {new}")
    have = {g["id"] for g in tree(root)}
    for gen in c.get("generators", []):
        if gen["when"] == "queued_ideas_over" and (vals.get("spinoff.queued_ideas") or 0) > gen["threshold"] and gen["goal_exists"] not in have:
            seed = next(g for g in c["goals"] if g["id"] == gen["goal_exists"]) if any(g["id"] == gen["goal_exists"] for g in c["goals"]) else None
            if seed:
                row = {"at": at, "ev": "adopt", "kind": "add", "goal": seed, "basis": gen["what"], "by": {"class": "loop", "actor": "goals", "channel": "idea-loop"}}
                out["added"].append(row)
                if apply:
                    _append(root, c["proposals"], row)
                    _prov_goal(root, row, f"added goal {seed['id']} from the idea loop")
    return out


def _prov_goal(root, row, text):
    try:
        from . import provenance
        provenance.record(root, row["by"], "change", text, ref=f"goal-{row['goal'] if isinstance(row['goal'], str) else row['goal']['id']}-{row['at']}",
                          affected=["doctrine/goals.json"], effect={"status": "pending", "metric": "goals_met_share", "note": row["basis"]})
    except (ImportError, OSError, ValueError, KeyError, TypeError):
        pass


# ---- status, check, page -----------------------------------------------------------------------------------------------
def status(root=REPO, now=None, read=None) -> dict:
    root, c, t = Path(root), load(root), _now(now)
    vals = read if read is not None else readings(root)
    rows = _lines(root / c["ledger"])
    kb = {k["id"]: k for k in c["knobs"]}
    gs = []
    for g in tree(root):
        v = vals.get(g["reading"])
        days = (dt.date.fromisoformat(g["deadline"]) - t.date()).days
        steps = [r for r in rows if r.get("ev") == "step" and r["goal"] == g["id"]]
        verd = {r["step_id"]: r for r in rows if r.get("ev") == "verdict"}
        knobs = []
        for ref in g["knobs"]:
            if "ref" in ref:
                knobs.append({"id": ref["ref"], "what": "second-order ladder of the essential variable (ULTRASTABILITY-1)", "value": None, "min": None, "max": None, "owner": "ultrastability"})
                continue
            k = kb[ref["knob"]]
            try:
                cur = knob_value(root, k)
            except (OSError, KeyError, ValueError):
                cur = None
            knobs.append({"id": k["id"], "what": k["what"], "value": cur, "min": k["min"], "max": k["max"], "step": k["step"], "up_moves": ref["up_moves"], "file": k["file"], "path": k["path"], "owner": "goals"})
        adj = [{"at": s["at"], "knob": s["knob"], "before": s["before"], "after": s["after"], "value_then": s["value"], "prediction": s["prediction"],
                "verdict": (verd.get(s["id"]) or {}).get("verdict", "pending"), "value_after": (verd.get(s["id"]) or {}).get("value")} for s in steps[-5:]]
        hist = [r for r in rows if r.get("ev") == "reading" and r["goal"] == g["id"] and not r.get("unmeasured")]
        state = "unmeasured" if v is None else "met" if in_bounds(g, v) else "overdue" if days < 0 else "behind"
        gs.append({"id": g["id"], "level": g["level"], "parent": g.get("parent"), "children": g.get("children", []), "name": g["name"], "why": g["why"], "reading": g["reading"],
                   "value": v, "op": g["op"], "target": g["target"], "unit": g["unit"], "deadline": g["deadline"], "days_left": days, "state": state,
                   "proposed_by": g["proposed_by"], "knobs": knobs, "adjustments": adj, "series": [r["value"] for r in hist[-24:]],
                   "revised_at": g.get("revised_at"), "added_at": g.get("added_at"), "note": g.get("note")})
    props = _lines(root / c["proposals"])
    return {"as_of": _iso(t), "goals": gs, "proposals": props[-10:], "counts": {s: sum(1 for x in gs if x["state"] == s) for s in ("met", "behind", "overdue", "unmeasured")},
            "knob_turns": sum(1 for r in rows if r.get("ev") == "step"), "kept": sum(1 for r in rows if r.get("ev") == "verdict" and r["verdict"] == "kept"),
            "reverted": sum(1 for r in rows if r.get("ev") == "verdict" and r["verdict"] == "reverted")}


def check(root=REPO) -> list[str]:
    root, bad = Path(root), []
    c = load(root)
    kb = {k["id"]: k for k in c["knobs"]}
    for k in c["knobs"]:
        for f in ("id", "file", "path", "min", "max", "step", "cooldown_h", "what"):
            if f not in k:
                bad.append(f"knob {k.get('id')} missing {f}")
        try:
            cur = knob_value(root, k)
            if not (k["min"] <= cur <= k["max"]):
                bad.append(f"knob {k['id']} value {cur} outside its safe range {k['min']}..{k['max']}")
        except (OSError, KeyError, ValueError):
            bad.append(f"knob {k['id']} names {k['file']}:{k['path']}, which does not exist")
    ids = [g["id"] for g in c["goals"]]
    bad += [f"goal {i} duplicated" for i in set(ids) if ids.count(i) > 1]
    try:
        from . import ultrastability
        ultra = {v["id"] for v in ultrastability.load(root)["scopes"]["platform"]["variables"]}
    except (OSError, KeyError, ValueError):
        ultra = set()
    known = set(readings_keys())
    for g in tree(root):
        for f in ("name", "why", "reading", "op", "target", "unit", "deadline", "proposed_by", "knobs", "level"):
            if f not in g or g[f] in ("", None, []):
                bad.append(f"goal {g['id']}: missing {f} (every goal has a measured variable, a target, a deadline and at least one knob)")
        if g.get("op") not in OPS:
            bad.append(f"goal {g['id']}: op {g.get('op')} unknown")
        if g.get("reading") not in known:
            bad.append(f"goal {g['id']}: reads {g.get('reading')!r}, which nothing computes")
        for ref in g.get("knobs", []):
            if "ref" in ref:
                if ref["ref"].split(":", 1)[-1] not in ultra:
                    bad.append(f"goal {g['id']}: ladder ref {ref['ref']} is not an essential variable")
            elif ref.get("knob") not in kb:
                bad.append(f"goal {g['id']}: knob {ref.get('knob')} is not registered")
            elif ref.get("up_moves") not in ("up", "down"):
                bad.append(f"goal {g['id']}: knob {ref['knob']} needs up_moves up|down")
        try:
            dt.date.fromisoformat(g["deadline"])
        except (KeyError, ValueError):
            bad.append(f"goal {g['id']}: deadline is not a date")
        for ch in g.get("children", []):
            if ch not in ids and ch not in {x["id"] for x in tree(root)}:
                bad.append(f"goal {g['id']}: child {ch} does not exist")
    if not any(g["level"] == 0 and g["id"] == "bootstrap-to-criticality" for g in c["goals"]):
        bad.append("the standing goal bootstrap-to-criticality is missing")
    if not any(g["proposed_by"] == "system" for g in c["goals"]):
        bad.append("no goal was proposed by the system itself")
    pg = root / c["page_data"]
    if pg.is_file():
        have = re.findall(r'"id": "([a-z0-9-]+)",\s*"level"', pg.read_text(encoding="utf-8"))
        if have != [g["id"] for g in tree(root)]:
            bad.append(f"{c['page_data']} is stale: run `python3 -m foundation goals --page --apply`")
    else:
        bad.append(f"{c['page_data']} missing: run `python3 -m foundation goals --page --apply`")
    return bad


def readings_keys():
    return ("criticality.regime_score", "criticality.self_deploys", "criticality.cost", "criticality.k", "criticality.verified_share", "criticality.autonomy_rate",
            "spinoff.apps_used", "spinoff.queued_ideas", "tenants.served", "free_tier.busiest_share", "claims.drift")


def render(root=REPO, now=None, read=None) -> str:
    st = status(root, now, read)
    return ("// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0\n// Copyright (c) Ultrastable\n"
            "// GENERATED by foundation/goals.py (GOALS-1) from doctrine/goals.json, ops/goals/*.jsonl and the live ledgers. Do not edit; regenerated after every merge.\n"
            "export default " + json.dumps(st, indent=1, ensure_ascii=False) + ";\n")


def page(root=REPO, apply=False, now=None, read=None) -> str:
    txt = render(root, now, read)
    if apply:
        (Path(root) / load(root)["page_data"]).write_text(txt, encoding="utf-8")
    return txt


def main(argv=None) -> int:
    a, ap = argv if argv is not None else sys.argv[1:], "--apply" in (argv if argv is not None else sys.argv[1:])
    if "--check" in a:
        e = check(); print("\n".join(e) or "goals ok: every goal has a measured variable, a target, a deadline and at least one knob"); return 1 if e else 0
    if "--tick" in a:
        print(json.dumps(tick(apply=ap), indent=1)); return 0
    if "--propose" in a:
        print(json.dumps(propose(apply=ap), indent=1, default=str)); return 0
    if "--status" in a:
        print(json.dumps(status(), indent=1)); return 0
    if "--page" in a:
        page(REPO, ap); print("goals page data " + ("written" if ap else "ok")); return 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main())

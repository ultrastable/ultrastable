# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""FREELY-ADAPTIVE-1: Pérez López's freely-adaptive system, as code. Ultrastable is the foundation for any autonomous system.

Source: J. A. Pérez López, "Organizational Theory: A Cybernetic Approach", IESE Business School Working Paper No. 5, July 1974 (study file
research/studies/perez-lopez-1974.json). The paper extends Ashby's ultrastable system from an organism to an organization and makes two points this
module turns into readings the loops act on:

ACTION LEVEL (chapter III). Every action has an effectiveness (its explicit, predicted consequence), an efficiency (its consequences for the system's
other needs, found only after the fact) and a consistency (how its efficiency changes as the system learns). A failed action teaches one of two
different things: the model was INCORRECT (the predicted result did not happen) or the model was INCOMPLETE (the result happened, but another need
was disturbed: Barnard's "offsetting dissatisfactions"). A system that scores only the first cannot learn the second. Here every settled action of the
decision scorer (ops/decisions/outcomes.jsonl), the growth loop (ops/growth/experiments.json) and the second loop (ops/ultrastability.jsonl) gets both
verdicts: effectiveness from its own outcome, efficiency from whether another essential variable of the same scope went from inside its limits to
outside them while the action was open. "An ultrastable system is one that has a built-in mechanism which systematically discards action alternatives
that have been found to have decreasing efficiency": an action class whose recent efficiency falls below EFFICIENCY_FLOOR files Q-FAS-<class>, closed
only by `freeadapt --probe <class>`.

ORGANIZATION LEVEL (chapter V). An organization survives only if it is at once effective (it generates more than it spends to motivate membership:
criticality k at or above k_floor), attractive (its members accept the control system: the share of the executor's attempts on work orders that end
merged, not discarded) and consistent (attractiveness does not fall as members learn: the later half of those attempts does no worse than the earlier
half). `levels()` reads the three; the essential variable survival_levels in doctrine/ultrastability.json holds it at 3, so the second loop acts when
one level fails.

  python3 -m foundation freeadapt --report                         levels, learning classes and action-class consistency, as JSON
  python3 -m foundation freeadapt --run [--apply] [--changed-file F] file Q-FAS-<class> for every inconsistent action class
  python3 -m foundation freeadapt --probe CLASS                     exit 0 when that action class is consistent again
  python3 -m foundation freeadapt --levels                          exit 0 when all three survival levels hold
  python3 -m foundation freeadapt --check                           the readings compute and the study file names this module

Honesty: an action with no prior reading of any other variable has efficiency None (unmeasured), never efficient; a class with fewer than
MIN_ACTIONS measured actions is not judged; an unmeasured level counts as not met. Co-occurrence is not causation: a variable disturbed while an
action was open is attributed to every action open at the time, and the paper's limits section says so. Tests: tests/foundation/test_freeadapt.py.
"""
from __future__ import annotations
import bisect, datetime as dt, json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
STUDY = "research/studies/perez-lopez-1974.json"
MIN_ACTIONS = 4        # a class is judged once it has this many actions whose efficiency was measured
RECENT = 6             # consistency reads the class's most recent actions
EFFICIENCY_FLOOR = 0.5  # below this share of efficient recent actions the alternative is discarded (Q-FAS item)
ATTRACT_FLOOR = 0.5    # members accept the control system when at least this share of their attempts is merged
WINDOW_DAYS = 30
PREFIX = "Q-FAS"


def _t(s):
    try:
        return dt.datetime.fromisoformat(str(s).replace("Z", "+00:00")) if s else None
    except ValueError:
        return None


def _jsonl(p: Path) -> list[dict]:
    out = []
    for line in (p.read_text(encoding="utf-8").splitlines() if p.is_file() else []):
        try:
            out.append(json.loads(line))
        except ValueError:
            continue
    return out


def _scope(var: str) -> str:
    return var.split(":", 1)[0] if ":" in var else "platform"


def disturbance_index(root=REPO) -> dict:
    """var -> (times, oks) of every measured reading, in time order. Unmeasured readings are not disturbances and are left out."""
    idx = {}
    for r in _jsonl(Path(root) / "ops/ultrastability.jsonl"):
        if r.get("ev") != "reading" or r.get("unmeasured") or r.get("value") is None or not r.get("var"):
            continue
        t = _t(r.get("at"))
        if t:
            idx.setdefault(r["var"], []).append((t, bool(r.get("ok"))))
    return {v: ([x[0] for x in sorted(rs)], [x[1] for x in sorted(rs)]) for v, rs in idx.items()}


def actions(root=REPO) -> list[dict]:
    """Every settled action the loops recorded: {cls, id, var, scope, start, end, effective}."""
    root, out = Path(root), []
    for r in _jsonl(root / "ops/decisions/outcomes.jsonl"):
        if isinstance(r.get("hit"), bool) and _t(r.get("decided_at")) and _t(r.get("at")):
            out.append({"cls": f"decision:{r.get('point', '?')}", "id": r.get("id"), "var": None, "scope": "platform",
                        "start": _t(r["decided_at"]), "end": _t(r["at"]), "effective": r["hit"]})
    gp = root / "ops/growth/experiments.json"
    try:
        exps = json.loads(gp.read_text(encoding="utf-8")).get("experiments", []) if gp.is_file() else []
    except ValueError:
        exps = []
    for e in exps:
        if e.get("verdict") in ("kept", "reverted") and _t(e.get("started")) and _t(e.get("reviewed")):
            out.append({"cls": f"growth:{e.get('metric', '?')}", "id": e.get("item"), "var": None, "scope": "platform",
                        "start": _t(e["started"]), "end": _t(e["reviewed"]), "effective": e["verdict"] == "kept"})
    us = _jsonl(root / "ops/ultrastability.jsonl")
    steps = {r.get("id"): r for r in us if r.get("ev") == "step"}
    for r in us:
        if r.get("ev") != "verdict" or r.get("verdict") not in ("kept", "reverted"):
            continue
        st = steps.get(r.get("step_id")) or {}
        var = r.get("var") or st.get("var") or "?"
        if _t(st.get("at")) and _t(r.get("at")):
            out.append({"cls": f"second-loop:{var}", "id": r.get("step_id"), "var": var, "scope": _scope(var),
                        "start": _t(st["at"]), "end": _t(r["at"]), "effective": r["verdict"] == "kept"})
    return sorted(out, key=lambda a: a["end"])


def efficiency(action: dict, idx: dict) -> dict:
    """Did another essential variable of the action's scope leave its limits while the action was open? None when nothing was read before it."""
    disturbed, read = [], 0
    for var, (ts, oks) in idx.items():
        if var == action["var"] or _scope(var) != action["scope"]:
            continue
        i = bisect.bisect_right(ts, action["start"]) - 1
        if i < 0:
            continue
        read += 1
        if not oks[i]:
            continue  # already outside its limits before the action: not this action's unsought consequence
        j = bisect.bisect_right(ts, action["end"])
        if any(not ok for ok in oks[i + 1:j]):
            disturbed.append(var)
    return {"efficient": None if read == 0 else not disturbed, "disturbed": sorted(disturbed), "read": read}


def classify(root=REPO, idx=None) -> list[dict]:
    """Each action with both verdicts and its kind of learning: sound, incorrect (prediction missed) or incomplete (other need disturbed)."""
    idx = disturbance_index(root) if idx is None else idx
    out = []
    for a in actions(root):
        e = efficiency(a, idx)
        kind = "incorrect" if not a["effective"] else ("incomplete" if e["efficient"] is False else "sound" if e["efficient"] else "efficiency-unmeasured")
        out.append({**a, **e, "learning": kind})
    return out


def consistency(rows: list[dict]) -> dict:
    """Per action class: efficiency of its most recent measured actions against the earlier ones. A class is judged only with MIN_ACTIONS."""
    by = {}
    for r in rows:
        if r["efficient"] is not None:
            by.setdefault(r["cls"], []).append(r)
    out = {}
    for cls, rs in by.items():
        if len(rs) < MIN_ACTIONS:
            out[cls] = {"judged": False, "n": len(rs)}
            continue
        recent, earlier = rs[-RECENT:], rs[:-RECENT]
        er = round(sum(r["efficient"] for r in recent) / len(recent), 3)
        ee = round(sum(r["efficient"] for r in earlier) / len(earlier), 3) if earlier else None
        out[cls] = {"judged": True, "n": len(rs), "recent_efficiency": er, "earlier_efficiency": ee,
                    "consistent": er >= EFFICIENCY_FLOOR, "disturbed": sorted({v for r in recent for v in r["disturbed"]})}
    return out


def levels(root=REPO, now=None) -> dict:
    """The three survival levels of chapter V, each {ok, value, n, source}. ok is False when unmeasured."""
    root, now = Path(root), now or dt.datetime.now(dt.timezone.utc)
    crit = _jsonl(root / "ops/criticality.jsonl")
    try:
        floor = json.loads((root / "doctrine/criticality.json").read_text(encoding="utf-8")).get("k_floor", 1.0)
    except (OSError, ValueError):
        floor = 1.0
    last = crit[-1] if crit else {}
    k = last.get("k")
    eff = {"ok": isinstance(k, (int, float)) and k >= floor, "value": k, "floor": floor, "k_self": last.get("k_self"), "regime": last.get("regime"),
           "n": last.get("deploys"), "source": f"ops/criticality.jsonl at {last.get('at', '?')}"}
    cut = now - dt.timedelta(days=WINDOW_DAYS)
    att = [r for r in _jsonl(root / "ops/executor-log.jsonl") if r.get("result") and r.get("result") != "verified-no-change" and (_t(r.get("at")) or cut) >= cut]
    att.sort(key=lambda r: _t(r.get("at")))
    merged = lambda rs: round(sum(r["result"] == "pr-merged" for r in rs) / len(rs), 3) if rs else None
    share = merged(att)
    attract = {"ok": share is not None and share >= ATTRACT_FLOOR, "value": share, "floor": ATTRACT_FLOOR, "n": len(att),
               "source": f"ops/executor-log.jsonl, last {WINDOW_DAYS} days (work orders the executor took: merged against discarded)"}
    half = len(att) // 2
    early, late = merged(att[:half]), merged(att[half:])
    cons_ok = len(att) >= MIN_ACTIONS and early is not None and late is not None and late >= early
    cons = {"ok": cons_ok, "value": round(late - early, 3) if early is not None and late is not None else None, "earlier": early, "later": late, "n": len(att),
            "source": "ops/executor-log.jsonl, later half of the attempts against the earlier half"}
    lv = {"effective": eff, "attractive": attract, "consistent": cons}
    return {**lv, "met": sum(1 for x in lv.values() if x["ok"]), "measured": sum(1 for x in lv.values() if x["value"] is not None)}


def report(root=REPO, now=None) -> dict:
    idx = disturbance_index(root)
    rows = classify(root, idx)
    settled = len(rows)
    both = [r for r in rows if r["efficient"] is not None]
    cons = consistency(rows)
    judged = {c: v for c, v in cons.items() if v["judged"]}
    kinds = {}
    for r in rows:
        kinds[r["learning"]] = kinds.get(r["learning"], 0) + 1
    return {"levels": levels(root, now), "settled_actions": settled, "learning": kinds,
            "efficiency_verdict_share": round(len(both) / settled, 3) if settled else None,
            "classes_judged": len(judged), "classes_consistent": sum(1 for v in judged.values() if v["consistent"]),
            "action_classes_consistent_share": round(sum(1 for v in judged.values() if v["consistent"]) / len(judged), 3) if judged else None,
            "classes": cons}


def slug(cls: str) -> str:
    return re.sub(r"[^A-Za-z0-9]+", "-", cls).strip("-")[:60]


def _item(cls: str, v: dict) -> dict:
    iid = f"{PREFIX}-{slug(cls)}"
    body = (f"**Owner:** executor\n**Trigger:** freeadapt pass: action class `{cls}` kept {v['recent_efficiency']} of its last {min(RECENT, v['n'])} measured actions "
            f"efficient (floor {EFFICIENCY_FLOOR}); essential variables disturbed while they were open: {', '.join(v['disturbed']) or 'none recorded'}\n"
            f"**Done check:** cmd:python3 -m foundation freeadapt --probe {cls}\n"
            "**Prediction:** action_classes_consistent_share >= 0.9 within 336 h\n"
            f"**Out of scope:** changing the floor, the window or the ledgers this reading comes from; the action's own target metric (scored elsewhere)\n"
            "**Status:** open\n\n"
            "FREELY-ADAPTIVE-1 (Pérez López, IESE WP 5, 1974, chapter III): an ultrastable system discards action alternatives found to have decreasing "
            "efficiency. These actions reached their own targets or were reverted, but while they were open other needs of the system left their limits "
            "(the model was incomplete, not incorrect). Redesign the alternative so it guards the disturbed variables, or retire it from its loop.\n\n"
            "size: M\n\n"
            f"**Closing probe:** `python3 -m foundation freeadapt --probe {cls}`\n")
    return {"id": iid, "title": f"{iid}: action class {cls} keeps disturbing other essential variables", "body": body,
            "labels": ["p1", "agent-ready", "raises-self"], "milestone": "Now", "workstream": "Ultrastability"}


def run(root=REPO, apply=False, now=None) -> dict:
    rep = report(root, now)
    filed = []
    for cls, v in sorted(rep["classes"].items()):
        if not v.get("judged") or v["consistent"]:
            continue
        it = _item(cls, v)
        p = Path(root) / "docs/issues" / f"{it['id']}.json"
        if p.exists():
            continue
        filed.append(it["id"])
        if apply:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(it, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return {"filed": filed, "levels_met": rep["levels"]["met"], "classes_judged": rep["classes_judged"], "classes_consistent": rep["classes_consistent"]}


def probe(root, cls) -> tuple[bool, str]:
    v = report(root)["classes"].get(cls)
    if not v:
        return False, f"{cls}: no settled action of this class has a measured efficiency"
    if not v["judged"]:
        return False, f"{cls}: {v['n']} measured actions, fewer than {MIN_ACTIONS}; not judged yet"
    return v["consistent"], f"{cls}: recent efficiency {v['recent_efficiency']} (floor {EFFICIENCY_FLOOR}, n {v['n']})"


def check(root=REPO) -> list[str]:
    root, bad = Path(root), []
    try:
        rep = report(root)
    except (OSError, ValueError, KeyError, TypeError) as e:
        return [f"freeadapt: readings failed: {e}"]
    for k in ("effective", "attractive", "consistent"):
        if k not in rep["levels"]:
            bad.append(f"freeadapt: level {k} missing")
    sp = root / STUDY
    if not sp.is_file() or "foundation/freeadapt.py" not in sp.read_text(encoding="utf-8"):
        bad.append(f"freeadapt: {STUDY} must name foundation/freeadapt.py as a mechanism")
    return bad


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    if "--check" in a:
        bad = check()
        print("\n".join(bad) or "freeadapt ok: three survival levels and both kinds of learning are read from the ledgers")
        return 1 if bad else 0
    if "--probe" in a:
        ok, msg = probe(REPO, a[a.index("--probe") + 1])
        print(msg)
        return 0 if ok else 1
    if "--levels" in a:
        lv = levels()
        print(json.dumps(lv, indent=1, default=str))
        return 0 if lv["met"] == 3 else 1
    if "--run" in a:
        r = run(REPO, apply="--apply" in a)
        print(json.dumps(r, indent=1))
        if "--changed-file" in a and r["filed"] and "--apply" in a:
            Path(a[a.index("--changed-file") + 1]).write_text("1", encoding="utf-8")
        return 0
    print(json.dumps(report(), indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())

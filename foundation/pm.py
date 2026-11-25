"""GROWTH-2: the product manager loop as code: targets with a trajectory, experiments with keep-or-replace verdicts, knobs it may turn, and growth and repair changes it files.

  python3 -m foundation pm --report            what the loop would do now (no writes)
  python3 -m foundation pm --run [--apply] [--pr]   measure, review experiments and knobs, file growth and repair items; --apply writes the files, --pr opens the change as a pull request

One pass (doctrine/growth.json, doctrine/knobs.json, doctrine/clocks.json):
1. Targets: every growth metric has a baseline, a target and a horizon; the expected value today is the straight line between them, and a metric below that line is behind.
2. Experiments: a growth item that closes is registered with the metric it should move, the baseline and its prediction; after `experiment_check_after_days` it is kept
   if the metric moved by at least the predicted share and no guard worsened, otherwise it is marked replace and the next entry of that metric's idea bank is filed. A
   change that did not move its metric in a week is replaced, not repeated.
3. Knobs: a few parameters the loop may turn (target growth share, executor runs per day, merge window), each bounded, logged with its prediction and reverted when the
   next review finds the metric no better. At most one change a week.
4. Filing: every metric behind its line gets the next growth item from its idea bank; every stale pipeline stage at its incident step gets a p0 repair item. Both are
   queue items the executor takes (growth first when the mix is below target), so growth and repair are filed by the same loop, with owners, metrics and probes.
"""
from __future__ import annotations
import json, re, subprocess, sys
from datetime import datetime, timezone
from pathlib import Path

from . import growth as G

REPO = G.REPO
KNOBS, EXPERIMENTS, KNOBLOG, REPORT = "doctrine/knobs.json", "ops/growth/experiments.json", "ops/growth/knob-log.jsonl", "ops/growth/pm-report.json"
WEEKLY = "ops/growth/weekly.json"   # WEEKLY-REPORT-1: one report per ISO week, read by the transparency snapshot and shown on /live


def _now(now=None) -> float:
    return now or datetime.now(timezone.utc).timestamp()


def _iso(t: float) -> str:
    return datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ts(s: str) -> float:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def _read(root, rel, default):
    p = Path(root) / rel
    try:
        return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else default
    except ValueError:
        return default


def _write(root, rel, data):
    p = Path(root) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, indent=1) + chr(10), encoding="utf-8")


# ---- 1. targets with a trajectory ----

def trajectory(m: dict, cfg: dict, value, now: float) -> dict:
    start = _ts(cfg["start"] + "T00:00:00Z")
    frac = max(0.0, min(1.0, (now - start) / (cfg["horizon_days"] * 86400)))
    expected = round(m["baseline"] + (m["target"] - m["baseline"]) * frac, 1)
    behind = None if value is None else value < expected * 0.95
    return {"id": m["id"], "baseline": m["baseline"], "target": m["target"], "expected_today": expected, "value": value, "behind": behind, "progress": None if value is None else round((value - m["baseline"]) / max(1, m["target"] - m["baseline"]), 2)}


def targets(root, metrics: dict, now: float) -> list[dict]:
    cfg = G.load(root)
    return [trajectory(m, cfg, metrics.get(m["id"]), now) for m in cfg["metrics"]]


# ---- 2. experiments ----

def _items(root):
    from . import queue as qmod
    return qmod.items(root)


def _parse_item(it) -> dict:
    body = it["json"].get("body", "")
    mm = re.search(r"Metric moved:\s*([^\n]+)", body)
    pr = re.search(r"(\d+)\s*percent", body)
    ids = re.findall(r"[a-z_]+_7d", mm[1]) if mm else []
    return {"metrics": ids, "pct": int(pr[1]) if pr else 10}


def sync_experiments(root, metrics: dict, now: float) -> list[dict]:
    """Register every closed growth item that names a metric and is not yet an experiment."""
    cfg, ex = G.load(root), _read(root, EXPERIMENTS, {"experiments": []})
    known = {e["item"] for e in ex["experiments"]}
    for it in _items(root):
        names = [l for l in it["json"].get("labels", [])]
        if cfg["label"] not in names or it["status"] not in ("closed", "done") or it["id"] in known:
            continue
        p = _parse_item(it)
        if not p["metrics"]:
            continue
        m = p["metrics"][0]
        ex["experiments"].append({"item": it["id"], "metric": m, "baseline": metrics.get(m), "predicted_pct": p["pct"], "started": _iso(now), "check_after_days": cfg["experiment_check_after_days"], "verdict": None})
    return ex["experiments"]


def review_experiments(experiments: list[dict], metrics: dict, now: float, guards_ok: bool = True) -> list[dict]:
    for e in experiments:
        if e.get("verdict") or _ts(e["started"]) + e["check_after_days"] * 86400 > now:
            continue
        v, b = metrics.get(e["metric"]), e.get("baseline")
        if v is None or not b:
            e["verdict"] = "unmeasured"
        else:
            moved = (v - b) / b * 100
            e["moved_pct"] = round(moved, 1)
            e["verdict"] = "kept" if moved >= e["predicted_pct"] and guards_ok else "replace"
        e["reviewed"] = _iso(now)
    return experiments


# ---- 3. knobs ----

def _dig(d, path):
    for k in path.split("."):
        d = d[k]
    return d


def _put(d, path, v):
    ks = path.split(".")
    for k in ks[:-1]:
        d = d[k]
    d[ks[-1]] = v


def knob_value(root, k: dict):
    p = Path(root) / k["file"]
    return _dig(json.loads((p if p.is_file() else REPO / k["file"]).read_text(encoding="utf-8")), k["path"])


def set_knob(root, k: dict, value, why: str, prediction: str, metric_value, now: float, write=True) -> dict:
    if value < k["min"] or value > k["max"]:
        return {"knob": k["id"], "changed": False, "why": f"{value} is outside {k['min']}..{k['max']}"}
    old = knob_value(root, k)
    row = {"at": _iso(now), "knob": k["id"], "old": old, "new": value, "why": why, "prediction": prediction, "metric": k["metric"], "baseline": metric_value, "reviewed": None}
    if write:
        p = Path(root) / k["file"]
        d = json.loads(p.read_text(encoding="utf-8"))
        _put(d, k["path"], value)
        p.write_text(json.dumps(d, indent=2) + chr(10), encoding="utf-8")
        Path(root, KNOBLOG).parent.mkdir(parents=True, exist_ok=True)
        with (Path(root) / KNOBLOG).open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, separators=(",", ":")) + chr(10))
    return {**row, "changed": True}


def knob_log(root) -> list[dict]:
    p = Path(root) / KNOBLOG
    rows = []
    for line in (p.read_text(encoding="utf-8").splitlines() if p.is_file() else []):
        try:
            rows.append(json.loads(line))
        except ValueError:
            pass
    return rows


def tune(root, state: dict, now: float, write=True) -> dict:
    """Review the last knob change (keep or revert), then turn at most one knob, at most once a week. `state` carries measured values by metric id."""
    kn = _read(root, KNOBS, {"knobs": [], "min_days_between_changes": 7, "review_after_days": 7})["knobs"]
    cfgk = _read(root, KNOBS, {})
    log, out = knob_log(root), {"reviewed": None, "changed": None}
    last = log[-1] if log else None
    if last and not last.get("reviewed") and _ts(last["at"]) + cfgk["review_after_days"] * 86400 <= now:
        k = next((x for x in kn if x["id"] == last["knob"]), None)
        cur = state.get(last["metric"])
        base = last.get("baseline")
        hold = bool(k) and k.get("keep_if") == "hold"   # a knob that raises a bar is kept when the metric holds; one that adds capacity must move its metric
        better = cur is not None and base is not None and (cur >= base if hold else cur > base)
        out["reviewed"] = {"knob": last["knob"], "kept": better, "baseline": last.get("baseline"), "now": cur}
        if not better and k and write:
            set_knob(root, k, last["old"], "reverted: " + last["metric"] + " was no better after " + str(cfgk["review_after_days"]) + " days", "restores the previous value", cur, now)
            log = knob_log(root)
            log[-2]["reviewed"] = "reverted"
        elif write:
            log[-1]["reviewed"] = "kept"
        if write:
            Path(root, KNOBLOG).write_text("".join(json.dumps(r, separators=(",", ":")) + chr(10) for r in log), encoding="utf-8")
        return out  # one decision per pass: the review is the change
    if last and _ts(last["at"]) + cfgk["min_days_between_changes"] * 86400 > now:
        return out
    for k in kn:
        want = None
        m = state.get(k["metric"])
        if k["id"] == "chain_max_runs_per_day" and (state.get("takeable") or 0) >= 5 and (state.get("executor_merged_7d") or 0) == 0:
            want, why, pred = knob_value(root, k) + k["step"], "work is waiting and nothing merged unattended in 7 days: more attempts per day", "executor_merged_7d rises above 0 within 7 days"
        elif k["id"] == "target_growth_share" and (state.get("growth_share") or 0) >= knob_value(root, k) + 0.15:
            want, why, pred = round(knob_value(root, k) + k["step"], 2), "the growth share is well above target: raise the bar", "growth_share stays at or above the new target"
        if want is not None and k["min"] <= want <= k["max"]:
            out["changed"] = set_knob(root, k, want, why, pred, m, now, write)
            break
    return out


# ---- 4. filing ----

def _item_exists(root, iid: str) -> bool:
    return (Path(root) / "docs/issues" / f"{iid}.json").is_file()


def _write_item(root, iid, title, probe, body_text, labels, workstream, owner):
    body = (f"**Owner:** {owner}\n**Trigger:** executor tick, driver order\n**Done check:** {probe}\n**Status:** open\n\n" + body_text + f"\n\nsize: M\n\n**Closing probe:** {probe}.")
    p = Path(root) / "docs/issues" / f"{iid}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"id": iid, "title": f"{iid}: {title}", "body": body, "labels": labels, "milestone": "Now", "workstream": workstream}, indent=2) + chr(10), encoding="utf-8")


def file_growth(root, tgt: list[dict], experiments: list[dict], write=True, growth_share=None) -> list[str]:
    """For each metric behind its line, file the next idea from its bank that was not filed; a replaced experiment's metric also gets the next idea.
    GROWTH-STARVE-1 (2026-11-25): with no analytics reading every metric was None, `behind` was None, and the pass filed nothing for days while the
    growth share sat at 0. An unmeasured metric now counts as behind whenever the growth share is under target, so the loop never goes quiet."""
    cfg, filed = G.load(root), []
    starving = growth_share is not None and growth_share < cfg.get("target_growth_share", 0)
    replace = {e["metric"] for e in experiments if e.get("verdict") == "replace"}
    open_metrics = set()
    for it in _items(root):
        if cfg["label"] in it["json"].get("labels", []) and it["status"] == "open":
            open_metrics.update(_parse_item(it)["metrics"])
    for t in tgt:
        if not (t["behind"] or t["id"] in replace or (t["behind"] is None and starving)) or t["id"] in open_metrics:
            continue
        for idea in cfg["bank"].get(t["id"], []):
            iid = "Q-GROW-" + idea["id"]
            if _item_exists(root, iid):
                continue
            text = (idea["desc"] + f"\n\nMetric moved: {t['id']}. Prediction: {t['id']} rises at least {idea.get('pct', 15)} percent within 14 days of the change "
                    f"(baseline {t['baseline']}, today {t['value']}, expected today {t['expected_today']}). Keep only if the target moved and no guard worsened.")
            if write:
                _write_item(root, iid, idea["title"], idea["probe"], text, ["p1", cfg["label"], "agent-ready"], "Growth", "product-manager")
            filed.append(iid)
            break
    return filed


def file_repairs(root, stage_rows: list[dict], ladder: list[dict], write=True) -> list[str]:
    """A stage that reached the incident step of the escalation ladder gets a p0 repair item, once."""
    incident = next((s["missed"] for s in ladder if s["action"] == "incident"), None)
    filed = []
    for s in stage_rows:
        if incident is None or s["status"] not in ("stale", "expired", "missing") or max(1, s["missed"]) < incident:
            continue
        iid = "Q-REPAIR-STAGE-" + s["id"].upper()
        if _item_exists(root, iid):
            continue
        probe = f"cmd:python3 -m foundation clock --check"
        text = (f"The pipeline stage `{s['id']}` ({s['what']}) has missed {s['missed']} SLAs (age {s['age_s']} s, SLA {s['sla_s']} s) and reached the incident step of the escalation ladder. "
                "Find the earliest cause, fix it at the root and leave a test; the stage must be fresh in the next stage report.")
        if write:
            _write_item(root, iid, f"repair the {s['id']} stage", probe, text, ["p0", "repair", "agent-ready"], "Clockwork", "operations")
        filed.append(iid)
    return filed


# ---- the pass ----

def week_id(now: float) -> str:
    y, w, _ = datetime.fromtimestamp(now, timezone.utc).isocalendar()
    return f"{y}-W{w:02d}"


def weekly(root, vals: dict, experiments: list[dict], now: float, write=True) -> dict:
    """WEEKLY-REPORT-1: once per ISO week, week-over-week change of every growth metric, the breaches, the verdict of each experiment
    reviewed since the last report, and the next three experiments (metric, prediction, closing probe). An idea whose experiment was
    replaced or is already running is never proposed again; an unmeasured week writes nothing, so the next measured pass still reports."""
    cfg, prev = G.load(root), _read(root, WEEKLY, {})
    wk = week_id(now)
    if prev.get("week") == wk:
        return prev
    ids = [m["id"] for m in cfg["metrics"]]
    if all(vals.get(i) is None for i in ids):
        return {"week": wk, "unmeasured": True, "previous_week": prev.get("week")}
    last = {m["id"]: m.get("value") for m in prev.get("metrics", [])}
    metrics = []
    for m in cfg["metrics"]:
        v, b = vals.get(m["id"]), last.get(m["id"])
        breach = None if v is None else (v < m["target"] if m["direction"] == ">=" else v > m["target"])
        metrics.append({"id": m["id"], "value": v, "previous": b, "delta_pct": None if v is None or not b else round((v - b) / b * 100, 1), "target": m["target"], "breach": breach})
    reported = {(v["item"], v["verdict"]) for v in prev.get("verdict_history", [])}
    verdicts = [{"item": e["item"], "metric": e["metric"], "verdict": e["verdict"], "moved_pct": e.get("moved_pct")} for e in experiments if e.get("verdict") and (e["item"], e["verdict"]) not in reported]
    tried = {e["item"] for e in experiments}
    order = [m["id"] for m in metrics if m["breach"]] + [m["id"] for m in metrics if not m["breach"]]
    nxt = []
    for mid in order:
        for idea in cfg["bank"].get(mid, []):
            iid = "Q-GROW-" + idea["id"]
            if iid in tried or any(n["item"] == iid for n in nxt):
                continue
            base, pct = vals.get(mid), idea.get("pct", 15)
            nxt.append({"item": iid, "title": idea["title"], "metric": mid,
                        "prediction": f"{mid} >= {int(base * (1 + pct / 100))} within 168 h" if base is not None else f"{mid} rises {pct} percent within 168 h of its first measured value",
                        "closing_probe": idea["probe"]})
            break
    for mid in order:   # second sweep fills the three slots when fewer than three metrics have an untried idea
        for idea in cfg["bank"].get(mid, []):
            iid = "Q-GROW-" + idea["id"]
            if len(nxt) < 3 and iid not in tried and not any(n["item"] == iid for n in nxt):
                base, pct = vals.get(mid), idea.get("pct", 15)
                nxt.append({"item": iid, "title": idea["title"], "metric": mid,
                            "prediction": f"{mid} >= {int(base * (1 + pct / 100))} within 168 h" if base is not None else f"{mid} rises {pct} percent within 168 h of its first measured value",
                            "closing_probe": idea["probe"]})
    rep = {"week": wk, "generated": _iso(now), "previous_week": prev.get("week"), "metrics": metrics, "breaches": [m["id"] for m in metrics if m["breach"]],
           "verdicts": verdicts, "next_experiments": nxt[:3],
           "verdict_history": (prev.get("verdict_history", []) + [{"item": v["item"], "verdict": v["verdict"]} for v in verdicts])[-200:]}
    if write:
        _write(root, WEEKLY, rep)
    return rep


def measure(root, use_live=True, env=None) -> dict:
    from . import clockwork
    snap = G.snapshot(root, use_live=use_live, env=env)
    vals = {m["id"]: m["value"] for m in snap["metrics"]}
    vals["growth_share"] = snap["mix"]["growth_share"]
    vals["takeable"] = snap.get("items_takeable")
    try:
        prs = clockwork.executor_prs()
        vals["executor_merged_7d"] = sum(1 for p in prs if p.get("mergedAt") and _ts(p["mergedAt"]) >= _now() - 7 * 86400)
    except Exception:  # an unmeasured value is a finding, not a crash
        vals["executor_merged_7d"] = None
    return vals


def run(root=REPO, apply=False, now=None, use_live=True, env=None, vals=None, stage_rows=None) -> dict:
    from . import clock, clockwork
    now = _now(now)
    cfgc = clock.load(root)
    vals = measure(root, use_live, env) if vals is None else vals
    tgt = targets(root, vals, now)
    ex = sync_experiments(root, vals, now)
    ex = review_experiments(ex, vals, now, guards_ok=True)
    tuned = tune(root, vals, now, write=apply)
    stage_rows = clockwork.stages(root, now) if stage_rows is None else stage_rows
    growth_filed = file_growth(root, tgt, ex, write=apply, growth_share=vals.get("growth_share"))
    repair_filed = file_repairs(root, stage_rows, cfgc["escalation"], write=apply)
    # INSIGHT-1: the per-page analytics loop (trends, findings, growth items, settled outcomes, self-tuned threshold) runs inside the pass.
    from . import insight
    try:
        ins = insight.run(root, apply=apply, now=now, use_live=use_live, env=env)
    except Exception as e:  # an unmeasured loop is a finding, never a crash of the pass
        ins = {"measured": False, "why": type(e).__name__ + ": " + str(e)[:160], "filed": []}
    # UIUX-1: the UI/UX manager (audit status, path funnels, A/B verdicts, front-end fix items) runs in the same daily pass.
    from . import uiux
    try:
        ui = uiux.tick(root, apply=apply)
    except Exception as e:  # an unmeasured loop is a finding, never a crash of the pass
        ui = {"status": {"unmeasured": [type(e).__name__ + ": " + str(e)[:160]]}, "filed": []}
    # CODE-ONLY-ORDER: a decision recorded without a code consumer becomes a work item in the same pass.
    from . import standingorder
    try:
        order_filed = standingorder.file_items(root) if apply else []
    except Exception as e:  # never crash the pass; the CI check still fails the change
        order_filed = [f"error: {type(e).__name__}"]
    # BLINDSPOT-1: the blind-spot clocks (domain expiry, backup and restore drill, closed ledger, overdue sweeps) run in the same daily pass.
    from . import blindspots
    try:
        bs = blindspots.tick(root, apply=apply, live=use_live, env=env)
    except Exception as e:  # an unmeasured loop is a finding, never a crash of the pass
        bs = {"error": type(e).__name__ + ": " + str(e)[:160], "filed": []}
    rep = {"generated": _iso(now), "blindspots": bs, "targets": tgt, "experiments": ex, "knobs": {"values": {k["id"]: knob_value(root, k) for k in _read(root, KNOBS, {"knobs": []})["knobs"]}, "last": tuned},
           "filed": {"growth": growth_filed, "repair": repair_filed, "insight": ins.get("filed", []), "uiux": ui.get("filed", []), "order": order_filed}, "insight": ins, "uiux": {"filed": ui.get("filed", []), "blocking": ui["status"].get("findings_blocking"), "happy_path_pass_share": ui["status"].get("happy_path_pass_share"), "unmeasured": ui["status"].get("unmeasured", [])}, "stages": [{"id": s["id"], "status": s["status"], "missed": s["missed"]} for s in stage_rows]}
    rep["weekly"] = weekly(root, vals, ex, now, write=apply)
    if apply and ex != _read(root, EXPERIMENTS, {"experiments": []}).get("experiments"):
        _write(root, EXPERIMENTS, {"experiments": ex})   # state that persists; the report itself is recomputed from live measurements, so a quiet day changes no file
    return rep


def publish(root=REPO, rep=None) -> dict:
    """Open the pass's changes as a pull request through the executor's own path (draft, ready, checks dispatched; the lane merges on green)."""
    from . import executor
    st = subprocess.run(["git", "-C", str(root), "status", "--porcelain"], capture_output=True, text=True, encoding="utf-8").stdout.strip()
    if not st:
        return {"pr": None, "why": "nothing changed"}
    n = len((rep or {}).get("filed", {}).get("growth", [])) + len((rep or {}).get("filed", {}).get("repair", [])) + len((rep or {}).get("filed", {}).get("insight", [])) + len((rep or {}).get("filed", {}).get("uiux", []))
    day = datetime.now(timezone.utc).strftime("%Y%m%d%H")
    wc, wo = subprocess.run(["python3", "-m", "foundation", "writeback", "record", "--kind", "decision", "--title", f"Product manager pass {day}: {n} item(s) filed", "--body",
                             "Growth and repair items, experiment verdicts and knob review recorded in ops/growth/pm-report.json by foundation/pm.py; tests pass.", "--owner", "product-manager",
                             "--probe", "file:foundation/pm.py"], cwd=str(root), capture_output=True, text=True, encoding="utf-8").returncode, ""
    return executor.publish_change(executor.REPO_SLUG, root, f"agent/pm-{day}", f"Product manager pass: {n} growth and repair item(s) filed", "Filed by the product manager loop (foundation/pm.py); see ops/growth/pm-report.json.")


def main(argv) -> int:
    a = list(argv)
    rep = run(apply="--apply" in a)
    if "--pr" in a and "--apply" in a:
        rep["publish"] = publish(REPO, rep)
    print(json.dumps(rep, indent=1) if "--report" in a or "--run" in a else "pm ok")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

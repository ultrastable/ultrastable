# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""TEMPORAL-1 (Rowan, 2026-11-21): time and iteration are part of the system, not snapshots. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation temporal --run [--apply] [--root DIR] [--tenant ID]   sense, diagnose, act (files items, writes series, findings, attention, page data)
  python3 -m foundation temporal --settled ID                                  closing probe of Q-TEMPORAL-<ID>: exit 0 once the finding no longer holds
  python3 -m foundation temporal --probe                                       failure-mode detector: exit 1 while a finding has persisted past escalate_runs
  python3 -m foundation temporal --check                                       config valid; every consumer of the findings exists
  python3 -m foundation temporal --report                                      the findings as text

"The only way to understand a loop is to run it. It is a process, not a snapshot." A snapshot says what exists; a series says what is being
touched, what is repeatedly breaking and what nobody has looked at since. This module turns the repository's own history into daily series
per component (git commits by area), per loop (every ledger in doctrine/temporal.json) and per entry (open items, a tenant's problems and solutions),
and reads the trends before they become failures:

  hotspot          an area whose recent rate is a multiple of its own baseline, or one file edited again and again (churn)
  neglect          an area that was active and decayed, or went untouched (decay, untouched)
  stale_entry      entries nobody has touched for stale_days (open queue items; a tenant's problems and solutions)
  stopped_loop     a ledger whose events used to arrive every g and have not for stop_factor x g
  repeated_failure a ledger key failing again and again (a streak, or a failure rate that doubled)

Windows are measured in complete days and shrink to the history that exists, so a young repository is judged on its own short past and a tenant
needs no tuning. Every detection is a finding with a prediction. Findings feed the machinery that already exists: a queue item with the area's
advocate as owner (Q-TEMPORAL-<id>, closed by --settled), the failure-mode detector `temporal-drift` (doctrine/detectors.json, which files Q-AUDIT
when a finding persists), the pathfinder (a stopped loop or repeated failure becomes an integration whose suspects --regress lists) and attention
weights (ops/temporal/attention.json, read by the executor's queue boost: neglected areas rise, hot ones fall). Published at /trends and in the
owner dashboard from the same data. Nothing here is typed by hand. Tests: tests/foundation/test_temporal.py."""
from __future__ import annotations
import datetime as dt, fnmatch, hashlib, json, re, statistics, subprocess, sys, time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CFG = "doctrine/temporal.json"
OUT = "ops/temporal"
DAY = 86400


def load(root=REPO) -> dict:
    p = Path(root) / CFG
    return json.loads((p if p.is_file() else REPO / CFG).read_text(encoding="utf-8"))


def _day(ts: float) -> int:
    return int(ts // DAY)


def _iso(day: int) -> str:
    return dt.datetime.fromtimestamp(day * DAY, dt.timezone.utc).strftime("%Y-%m-%d")


def _ts(v) -> float | None:
    if isinstance(v, (int, float)):
        return float(v)
    try:
        d = dt.datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except ValueError:
        return None
    return (d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)).timestamp()


def _git(root, *a, timeout=120) -> str:
    try:
        r = subprocess.run(["git", "-C", str(root), *a], capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return r.stdout if r.returncode == 0 else ""


# ---------------------------------------------------------------- sense
def generated_outputs(root) -> tuple:
    """Files a generator rewrites on every merge (scripts/regen_generated.py OUTPUTS). They churn by design, so counting them as hotspots flagged the
    generators, not the work (ROOTCAUSE-1, class edit-hotspot: the hand-kept noise list had drifted from the generators' own list). One list, read here."""
    p = Path(root) / "scripts/regen_generated.py"
    if not p.is_file():
        return ()
    import ast
    try:
        for n in ast.parse(p.read_text(encoding="utf-8")).body:
            if isinstance(n, ast.Assign) and any(getattr(t, "id", "") == "OUTPUTS" for t in n.targets):
                return tuple(str(x) for x in ast.literal_eval(n.value))
    except (SyntaxError, ValueError):
        return ()
    return ()


def git_events(root, cfg, now) -> dict:
    """Commits by area, edits by file and the last touch of every file, from one pass over the history inside history_days."""
    since = int(now - cfg["history_days"] * DAY)
    out = _git(root, "log", f"--since=@{since}", "--no-merges", "--name-only", "--format=@%ct")
    areas, files, last, first, commits = {}, {}, {}, None, []
    noise = tuple(cfg["noise"]) + generated_outputs(root)
    cur = None
    for line in out.splitlines():
        if line.startswith("@"):
            cur = float(line[1:])
            first = cur if first is None or cur < first else first
            commits.append(cur)
            seen = set()
            continue
        if not line or cur is None:
            continue
        last.setdefault(line, cur)  # newest first
        if line.startswith(noise):
            continue
        a = area_of(line, cfg)
        if a not in seen:
            seen.add(a)
            areas.setdefault(a, {})
            areas[a][_day(cur)] = areas[a].get(_day(cur), 0) + 1
        files.setdefault(line, {})
        files[line][_day(cur)] = files[line].get(_day(cur), 0) + 1
    return {"areas": areas, "files": files, "last_touch": last, "first": first, "commits": len(commits)}


def area_of(path: str, cfg) -> str:
    for a in cfg["areas"]:
        if any(path.startswith(p) for p in a["paths"]):
            return a["id"]
    return path.split("/")[0] if cfg.get("auto_areas", True) and "/" in path else "root"


def ledger_events(root, src) -> list[tuple[float, str, bool]]:
    p = Path(root) / src["file"]
    if not p.is_file():
        return []
    out = []
    for line in p.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if not isinstance(r, dict) or (src.get("where") and any(r.get(k) != v for k, v in src["where"].items())):
            continue
        t = _ts(r.get(src.get("time", "at")))
        if t is None:
            continue
        key = "/".join(str(r.get(k, "")) for k in src.get("key", [])) or "all"
        if "ok_field" in src:
            ok = r.get(src["ok_field"]) in src["ok_values"]
        else:
            ok = True
        out.append((t, key, ok))
    return sorted(out)


def entries(root, cfg, last_touch, now) -> list[dict]:
    out = []
    for e in cfg.get("entries", []):
        for f in sorted(Path(root).glob(e["glob"])):
            rel = f.relative_to(root).as_posix()
            if e.get("open_only"):
                try:
                    if e["open_only"] not in f.read_text(encoding="utf-8", errors="replace"):
                        continue
                except OSError:
                    continue
            t = last_touch.get(rel)
            out.append({"set": e["id"], "path": rel, "age_days": round((now - t) / DAY, 1) if t else None, "stale_days": e["stale_days"], "advocate": e.get("advocate", "")})
    return out


# ---------------------------------------------------------------- diagnose
def windows(counts: dict, today: int, R: int, B: int, floor: int):
    """(recent total, baseline total, baseline days actually available). Complete days only; the baseline shrinks to the history that exists."""
    span = max(0, min(B, today - R - floor))
    rec = sum(counts.get(d, 0) for d in range(today - R, today))
    base = sum(counts.get(d, 0) for d in range(today - R - span, today - R))
    return rec, base, span


def fid(kind, subject) -> str:
    return hashlib.sha256(f"{kind}|{subject}".encode()).hexdigest()[:10]


def finding(kind, subject, area, advocate, severity, evidence, prediction, files=(), last_good=None) -> dict:
    return {"id": fid(kind, subject), "kind": kind, "subject": subject, "area": area, "advocate": advocate, "severity": severity,
            "evidence": evidence, "prediction": prediction, "files": list(files), "last_good": last_good}


def diagnose(root, cfg, now, ev=None, led=None) -> tuple[list[dict], dict]:
    ev = ev or git_events(root, cfg, now)
    today, R, B = _day(now), cfg["recent_days"], cfg["baseline_days"]
    floor = _day(ev["first"]) if ev["first"] else today
    adv = {a["id"]: a.get("advocate", cfg["default_advocate"]) for a in cfg["areas"]}
    out, rows = [], {}
    for a, counts in sorted(ev["areas"].items()):
        rec, base, span = windows(counts, today, R, B, floor)
        rr, br = rec / R, (base / span if span else 0.0)
        rows[a] = {"recent": rec, "baseline": base, "baseline_days": span, "recent_rate": round(rr, 2), "baseline_rate": round(br, 2),
                   "last_active": _iso(max(counts)) if counts else None, "total": sum(counts.values())}
        who = adv.get(a, cfg["default_advocate"])
        if span >= cfg["min_baseline_days"] and rec >= cfg["hot_min_recent"] and rr >= cfg["hot_ratio"] * max(br, cfg["hot_floor_rate"]):
            out.append(finding("hotspot", f"area:{a}", a, who, "watch", f"{rec} commits in {R} days against a baseline of {br:.1f} a day ({rr / max(br, .01):.1f}x)",
                               f"area {a} recent_rate returns below {cfg['hot_ratio']}x baseline within {cfg['settle_days']} days"))
        if span >= cfg["min_baseline_days"] and base >= cfg["neglect_min_base"] and rr <= cfg["decay_ratio"] * br:
            kind = "untouched" if rec == 0 else "decay"
            out.append(finding("neglect", f"area:{a}", a, who, "act", f"{kind}: {rec} commits in {R} days after {base} in the {span} days before ({br:.1f} a day)",
                               f"area {a} gets at least {max(1, round(br * R * cfg['revive_ratio']))} commits in {R} days within {cfg['settle_days']} days"))
    churn = sorted(((sum(c.get(d, 0) for d in range(today - R, today)), f) for f, c in ev["files"].items()), reverse=True)
    for rec, f in churn[: cfg["max_file_hotspots"]]:  # the worst few, so one noisy week files a handful of items, not hundreds
        if rec >= cfg["file_churn_min"]:
            a = area_of(f, cfg)
            out.append(finding("hotspot", f"file:{f}", a, adv.get(a, cfg["default_advocate"]), "watch", f"{f} edited {rec} times in {R} days (outside generated and ledger paths)",
                               f"{f} is edited at most {cfg['file_churn_min'] // 2} times in {R} days within {cfg['settle_days']} days", files=[f]))
    series = {}
    for src in cfg["ledgers"]:
        evs = led[src["id"]] if led and src["id"] in led else ledger_events(root, src)
        if not evs:
            continue
        keys = {}
        for t, k, ok in evs:
            keys.setdefault(k, []).append((t, ok))
        for k, rows_ in keys.items():
            sid = f"ledger:{src['id']}:{k}"
            daily = {}
            for t, ok in rows_:
                daily[_day(t)] = daily.get(_day(t), 0) + 1
            series[sid] = {"daily": daily, "fails": {d: 0 for d in daily}}
            for t, ok in rows_:
                if not ok:
                    series[sid]["fails"][_day(t)] += 1
            ts_ = [t for t, _ in rows_]
            who = src.get("advocate", cfg["default_advocate"])
            fl = src.get("files", [])
            gaps = [b - a for a, b in zip(ts_, ts_[1:]) if b > a]
            if len(ts_) >= cfg["stop_min_events"] and gaps:
                g = max(src.get("expected_interval_s") or statistics.median(gaps), cfg["min_gap_s"])
                age = now - ts_[-1]
                if age > cfg["stop_factor"] * g:
                    out.append(finding("stopped_loop", sid, src.get("area", "loops"), who, "act", f"{k}: last event {age / 3600:.0f} h ago, it used to arrive every {g / 3600:.1f} h ({age / g:.1f} intervals)",
                                       f"{sid} records an event within {cfg['settle_days']} days", fl, _git_at(root, ts_[-1])))
            fr, fb, fs = _fail_windows(series[sid]["fails"], series[sid]["daily"], today, R, B, floor)
            streak = 0
            for _, ok in reversed(rows_):
                if ok:
                    break
                streak += 1
            if streak >= cfg["fail_streak"] or (fr >= cfg["fail_min"] and fs >= cfg["min_baseline_days"] and fr / R >= 2 * max(fb / fs, 0.1)):
                out.append(finding("repeated_failure", sid, src.get("area", "loops"), who, "act", f"{k}: {streak} failures in a row, {fr} in the last {R} days against {fb} in the {fs} before",
                                   f"{sid} has no failure in its next {cfg['fail_streak']} events within {cfg['settle_days']} days", fl, _git_at(root, next((t for t, ok in reversed(rows_) if ok), ts_[0]))))
    st = entries(root, cfg, ev["last_touch"], now)
    for s in cfg.get("entries", []):
        old = sorted([e for e in st if e["set"] == s["id"] and e["age_days"] is not None and e["age_days"] >= s["stale_days"]], key=lambda e: -e["age_days"])
        if len(old) >= s.get("min_count", 1):
            out.append(finding("stale_entry", f"entries:{s['id']}", s.get("area", "entries"), s.get("advocate", cfg["default_advocate"]), "act",
                               f"{len(old)} of {sum(1 for e in st if e['set'] == s['id'])} {s['id']} untouched for {s['stale_days']}+ days; oldest {old[0]['path']} ({old[0]['age_days']} d)",
                               f"untouched {s['id']} fall below {max(0, len(old) - s.get('batch', 3))} within {cfg['settle_days']} days", [e["path"] for e in old[: s.get("batch", 3)]]))
    summary = {"areas": rows, "series": series, "entries": {s["id"]: sum(1 for e in st if e["set"] == s["id"]) for s in cfg.get("entries", [])}, "history_from": _iso(floor)}
    out.sort(key=lambda f: ({"act": 0, "watch": 1}[f["severity"]], f["kind"], f["subject"]))
    return out, summary


def _fail_windows(fails, daily, today, R, B, floor):
    rec = sum(fails.get(d, 0) for d in range(today - R, today))
    span = max(0, min(B, today - R - floor))
    return rec, sum(fails.get(d, 0) for d in range(today - R - span, today - R)), span


def _git_at(root, ts) -> str | None:
    o = _git(root, "rev-list", "-1", f"--before=@{int(ts)}", "HEAD").strip()
    return o[:12] or None


# ---------------------------------------------------------------- act
def read_state(d) -> dict:
    """`d` is the directory that holds the state: ops/temporal for core, ops/temporal/tenants/<id> for a tenant."""
    p = Path(d) / "findings.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {"findings": {}, "settled": []}


def advance(state: dict, found: list[dict], now: float) -> dict:
    """Lifecycle: a finding seen again counts a run; one that stopped holding is settled with the time it stood; nothing leaves without a record."""
    iso = dt.datetime.fromtimestamp(now, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    cur = {f["id"]: f for f in found}
    for i, f in cur.items():
        s = state["findings"].get(i)
        if s and s["status"] == "open":
            s.update(f, last_seen=iso, runs=s["runs"] + 1)
        else:
            state["findings"][i] = dict(f, status="open", first_seen=iso, last_seen=iso, runs=1, item=(s or {}).get("item"), reopened=(s or {}).get("reopened", 0) + (1 if s else 0))
    for i, s in state["findings"].items():
        if s["status"] == "open" and i not in cur:
            s["status"] = "settled"
            s["settled_at"] = iso
            state["settled"].append({"id": i, "kind": s["kind"], "subject": s["subject"], "first_seen": s["first_seen"], "settled_at": iso, "runs": s["runs"]})
    state["settled"] = state["settled"][-200:]
    return state


def item_id(f: dict) -> str:
    return f"Q-TEMPORAL-{f['id']}" + (f"-r{f['reopened']}" if f.get("reopened") else "")


ASK = {
    "hotspot": "Find why this keeps being edited (a flaky generator, an unstable spec, a loop that rewrites its own output) and fix the cause with a test or guard. Do not slow the work down; stop the churn.",
    "neglect": "Assign the area's advocate to it: pick the highest-value open item or the stalest entry in this area, move it or record its disposition, and say what attention it needs from now on.",
    "stale_entry": "Review the named entries: update each from its source, or close it with a recorded disposition (superseded, fixed, backlogged with owner and trigger). Never leave it silent.",
    "stopped_loop": "Run the loop by hand, read why it stopped, fix the cause and make it fire again. `python3 -m foundation pathfinder --regress` lists the commits since it last worked.",
    "repeated_failure": "Find the root cause of the repeated failure, not the symptom. `python3 -m foundation pathfinder --regress` lists the commits since it last worked; fix, add a regression test, and let the ledger show a pass.",
}


def file_items(root, cfg, state, now, apply=True, out=None) -> list[str]:
    """One queue item per open `act` finding (and watch findings that persisted), capped per run, owned by the area's advocate."""
    from . import pm
    filed, queue = [], []
    tenant = cfg.get("tenant", "ultrastable") != "ultrastable"  # a tenant's findings go to the tenant's own queue (a GitHub issue its agents take), never into core's
    for s in sorted(state["findings"].values(), key=lambda f: -f["runs"]):
        if s["status"] != "open" or len(filed) >= cfg["max_items_per_run"]:
            continue
        if s["severity"] != "act" and s["runs"] < cfg["escalate_runs"]:
            continue
        iid = item_id(s)
        if s.get("item") == iid if tenant else (Path(root) / "docs/issues" / f"{iid}.json").exists():
            continue
        text = (f"Temporal loop finding ({s['kind']}) in {s['area']}: {s['evidence']}. Seen in {s['runs']} runs since {s['first_seen']}. Advocate: {s['advocate']}.\n\n{ASK[s['kind']]}"
                + (f"\n\nFiles: {', '.join(s['files'])}." if s["files"] else "")
                + f"\n\nPrediction: {s['prediction']}.\n\nThis item closes when the finding no longer holds (`python3 -m foundation temporal --settled {s['id']}` recomputes it from the repository's own history).")
        if tenant:
            queue.append({"id": iid, "title": f"{iid}: {s['kind'].replace('_', ' ')}: {s['subject']}", "body": text, "labels": ["temporal", "agent-task"]})
        elif apply:
            pm._write_item(root, iid, f"{s['kind'].replace('_', ' ')}: {s['subject']}", f"cmd:python3 -m foundation temporal --settled {s['id']}", text,
                           ["p1" if s["severity"] == "act" else "p2", "agent-ready", "temporal"], "Operations", s["advocate"])
        s["item"] = iid
        filed.append(iid)
    if tenant and apply and queue:
        o = Path(out)
        o.mkdir(parents=True, exist_ok=True)
        (o / "to_file.json").write_text(json.dumps(queue, indent=1) + "\n", encoding="utf-8")
    return filed


def attention(summary, found, cfg) -> dict:
    """Weights by advocate role that the executor multiplies a queue item's priority by (the item's Owner): a neglected area's advocate rises, a hot one's falls (bounded)."""
    w = {}
    for f in found:
        if f["kind"] == "neglect" and f["subject"].startswith("area:"):
            w[f["advocate"]] = min(cfg["attention_max"], w.get(f["advocate"], 1.0) + cfg["attention_step"])
        if f["kind"] == "hotspot" and f["subject"].startswith("area:"):
            w[f["advocate"]] = max(cfg["attention_min"], w.get(f["advocate"], 1.0) - cfg["attention_step"])
    return {k: round(v, 2) for k, v in sorted(w.items())}


def spark(counts, today, n):
    return [counts.get(d, 0) for d in range(today - n, today)]


def publish(d, root, cfg, state, summary, now, filed) -> dict:
    today = _day(now)
    n = cfg["spark_days"]
    ay = [{"id": a, **row, "spark": spark(_areas_daily(summary, a), today, n)} for a, row in sorted(summary["areas"].items(), key=lambda kv: -kv[1]["total"])[: cfg["publish_areas"]]]
    led = []
    for sid, s in sorted(summary["series"].items()):
        led.append({"id": sid, "events": sum(s["daily"].values()), "fails": sum(s["fails"].values()), "spark": spark(s["daily"], today, n), "fail_spark": spark(s["fails"], today, n),
                    "last": _iso(max(s["daily"])) if s["daily"] else None})
    opn = [f for f in state["findings"].values() if f["status"] == "open"]
    sim = None
    ys = Path(root) / cfg.get("simulation", "ops/yearsim.json")
    if ys.is_file():  # YEARSIM-1 (the simulated year) is the forward half of the same picture: reuse its result, never rerun or copy it
        try:
            m = json.loads(ys.read_text(encoding="utf-8"))["months"]
            sim = {"source": ys.relative_to(root).as_posix(), "months": len(m), "pass": sum(1 for x in m if x.get("result") == "PASS"), "fail": sum(1 for x in m if x.get("result") == "FAIL"),
                   "uncovered": sum(1 for x in m if x.get("result") == "UNCOVERED")}
        except (ValueError, KeyError):
            sim = None
    return {"marker": "TEMPORAL-1", "at": dt.datetime.fromtimestamp(now, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "tenant": cfg.get("tenant", "ultrastable"),
            "history_from": summary["history_from"], "window": {"recent_days": cfg["recent_days"], "baseline_days": cfg["baseline_days"], "spark_days": n},
            "areas": ay, "ledgers": led, "entries": summary["entries"], "findings": sorted(opn, key=lambda f: (f["severity"], -f["runs"])), "settled": state["settled"][-20:], "filed": filed,
            "attention": attention(summary, opn, cfg), "history": _history(d, cfg, state, now, len(opn)), "simulation": sim}


def _areas_daily(summary, a):
    return summary.get("_daily", {}).get(a, {})


def _history(d, cfg, state, now, n_open) -> list[dict]:
    """The loop's own shape over time: one row per run, kept to history_rows."""
    p = Path(d) / "history.jsonl"
    rows = [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()] if p.is_file() else []
    day = _iso(_day(now))
    if rows and rows[-1]["day"] == day:
        rows.pop()
    kinds = {}
    for s in state["findings"].values():
        if s["status"] == "open":
            kinds[s["kind"]] = kinds.get(s["kind"], 0) + 1
    rows.append({"day": day, "open": n_open, "settled": len(state["settled"]), **{k: kinds.get(k, 0) for k in ASK}})
    return rows[-cfg["history_rows"]:]


def tenants_of(d, cfg) -> list[dict]:
    """Published results of the tenants this core reads (each written by `--tenant ID --root CLONE --out CORE_ops_temporal_dir`)."""
    out = []
    for t in cfg.get("tenants", []):
        p = Path(d) / "tenants" / t["id"] / "pub.json"
        if p.is_file():
            out.append(json.loads(p.read_text(encoding="utf-8")))
    return out


def run(root=REPO, now=None, apply=False, cfg=None, out=None) -> dict:
    """Read `root` (git history, ledgers, entries); keep state, history and attention under `out` (default `root`)."""
    root, now = Path(root), now or time.time()
    core = cfg is None or cfg.get("tenant", "ultrastable") == "ultrastable"
    out = Path(out) if out else (root / OUT)
    cfg = cfg or load(root)
    ev = git_events(root, cfg, now)
    found, summary = diagnose(root, cfg, now, ev)
    summary["_daily"] = ev["areas"]
    state = advance(read_state(out), found, now)
    filed = file_items(root, cfg, state, now, apply, out)
    pub = publish(out, root, cfg, state, summary, now, filed)
    if core:
        pub["tenants"] = tenants_of(out, cfg)
    if apply:
        o = out
        o.mkdir(parents=True, exist_ok=True)
        (o / "findings.json").write_text(json.dumps(state, indent=1) + "\n", encoding="utf-8")
        (o / "attention.json").write_text(json.dumps(pub["attention"], indent=1) + "\n", encoding="utf-8")
        (o / "history.jsonl").write_text("".join(json.dumps(r) + "\n" for r in pub["history"]), encoding="utf-8")
        (o / "series.json").write_text(json.dumps({"at": pub["at"], "areas": pub["areas"], "ledgers": pub["ledgers"]}, indent=1) + "\n", encoding="utf-8")
        for target, body in ((("site/temporal-data.js", pub), ("dashboard/temporal-data.js", {k: v for k, v in pub.items() if k not in ("areas", "ledgers")})) if core else (("pub.json", None),)):
            if body is None:
                (out / target).write_text(json.dumps({k: pub[k] for k in ("tenant", "at", "history_from", "window", "areas", "ledgers", "entries", "findings", "settled", "history")}, indent=1) + "\n", encoding="utf-8")
            elif (root / Path(target).parent).is_dir():
                (root / target).write_text("// GENERATED by python3 -m foundation temporal --run --apply; do not edit.\n// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0\nexport const TEMPORAL = "
                                           + json.dumps(body, indent=1) + ";\n", encoding="utf-8")
    return pub


def settled(root, fid_, now=None) -> tuple[bool, str]:
    """Closing probe: recompute from the repository's own history; the finding settles when it is no longer produced."""
    cfg = load(root)
    found, _ = diagnose(root, cfg, now or time.time())
    hit = next((f for f in found if f["id"] == fid_), None)
    return (hit is None, "no longer detected" if hit is None else "still holds: " + hit["evidence"])


def probe(root=REPO, now=None) -> list[str]:
    """Failure-mode detector: findings that stood for escalate_runs runs are drift nothing has corrected."""
    cfg = load(root)
    live = {f["id"] for f in diagnose(root, cfg, now or time.time())[0]}
    return [f"{s['kind']} {s['subject']} stood for {s['runs']} runs: {s['evidence']}" for s in read_state(Path(root) / OUT)["findings"].values()
            if s["status"] == "open" and s["id"] in live and s["runs"] >= cfg["escalate_runs"]]


def check(root=REPO) -> list[str]:
    root, bad = Path(root), []
    cfg = load(root)
    for k in ("recent_days", "baseline_days", "history_days", "areas", "ledgers", "noise", "default_advocate", "hot_ratio", "decay_ratio", "stop_factor", "escalate_runs", "settle_days"):
        if k not in cfg:
            bad.append(f"{CFG}: missing {k}")
    if bad:
        return bad
    if cfg["recent_days"] < 1 or cfg["baseline_days"] <= cfg["recent_days"] or cfg["history_days"] < cfg["recent_days"] + cfg["baseline_days"]:
        bad.append("windows must satisfy recent < baseline <= history - recent")
    for s in cfg["ledgers"]:
        if not s.get("id") or not s.get("file"):
            bad.append(f"ledger source needs id and file: {s}")
        if "ok_field" in s and "ok_values" not in s:
            bad.append(f"ledger {s.get('id')}: ok_field needs ok_values")
    for a in cfg["areas"]:
        if not a.get("id") or not a.get("paths"):
            bad.append(f"area needs id and paths: {a}")
    roles = {p.stem for p in (root / "agents/roles").glob("*.md")} if (root / "agents/roles").is_dir() else set()
    for who in {cfg["default_advocate"], *[a.get("advocate") for a in cfg["areas"] if a.get("advocate")]}:
        if roles and who not in roles:
            bad.append(f"advocate {who} has no role file in agents/roles")
    for need in ("doctrine/detectors.json", ".github/workflows/temporal.yml"):
        if not (root / need).is_file():
            bad.append(f"consumer missing: {need}")
    dp = root / "doctrine/detectors.json"
    if dp.is_file() and "temporal-drift" not in dp.read_text(encoding="utf-8"):
        bad.append("doctrine/detectors.json has no temporal-drift detector")
    return bad


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    root = Path(a[a.index("--root") + 1]) if "--root" in a else REPO
    if "--settled" in a:
        ok, why = settled(root, a[a.index("--settled") + 1])
        print(why)
        return 0 if ok else 1
    if "--probe" in a:
        bad = probe(root)
        print("\n".join(bad) or "no finding has persisted past escalation")
        return 1 if bad else 0
    if "--check" in a:
        bad = check(root)
        print("\n".join(bad) or "temporal: ok")
        return 1 if bad else 0
    if "--run" in a or "--report" in a:
        cfg = load(root)
        out = None
        if "--tenant" in a:  # a tenant run: core's thresholds, the tenant's own overrides from doctrine/temporal.json in core (tenants[].config)
            tid = a[a.index("--tenant") + 1]
            cfg = {**cfg, **next((t.get("config", {}) for t in cfg.get("tenants", []) if t["id"] == tid), {}), "tenant": tid}
            out = Path(a[a.index("--out") + 1]) / OUT / "tenants" / tid  # --out is the core checkout; the tenant's state lives in it, not in the tenant's clone
        pub = run(root, apply="--apply" in a, cfg=cfg, out=out)
        if "--report" in a or "--run" in a:
            print(f"temporal {pub['at']}: history from {pub['history_from']}, {len(pub['areas'])} areas, {len(pub['ledgers'])} ledger series, {len(pub['findings'])} open findings, filed {pub['filed'] or 'none'}")
            for f in pub["findings"]:
                print(f" [{f['severity']}] {f['kind']:<16} {f['subject']}: {f['evidence']} (advocate {f['advocate']}, {f['runs']} runs)")
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())

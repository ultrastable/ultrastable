# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""TRAJECTORY-1: how a system evolves over time, not a snapshot. Ultrastable is the foundation for any autonomous system.

  python3 scripts/trajectory.py --run [--apply]   read the system's own history (git and its ops ledgers), bucket it per day, and write ops/trajectory.json
                                                  (and append one summary row to ops/trajectory.jsonl, so the trajectory itself accumulates)

Rowan, 2026-11-21: "These things are built as snapshots without the implication for how time will affect them ... the only way to understand a loop is
to iterate it, to actually run it. That's a process, not a snapshot." For every area (code areas by directory, loops by their ledgers, issues opened and
closed, files by churn) the module keeps a per-day series of attention and change, and reads three failure modes out of the shape of the series before they
hurt: a HOTSPOT (an area drawing a large and rising share of all change, or one file rewritten on many days), a NEGLECTED area or loop (it had steady
activity and then went quiet while the rest of the system kept moving) and DRIFT (an area's share of attention moved a long way between the first and
second half of the window). Observed event series (CI unavailable, deploy that did not go live, merge conflicts, reverts) feed the year simulator
(`rate_from` in autonomy/yearsim.json): its yearly rates come from what actually happened and how it is trending, not from a guess. Pure functions
(`analyze`, `observed_rate`) are shared by the platform (foundation/trajectory.py imports this file)."""
from __future__ import annotations
import datetime as dt, json, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LATEST, LEDGER = "ops/trajectory.json", "ops/trajectory.jsonl"
RECORD = re.compile(r"^(ops/|docs/issues/|doctrine/writeback/|docs/handoff/)|-data\.js$|\.jsonl$|^docs/PROJECT-MEMORY\.md$")
TWO = {"seed", "docs", "ops", "tests", "doctrine", "site", "dashboard", "deploy"}
DEFAULT = {"days": 30, "hotspot_share": 0.30, "hotspot_growth": 1.5, "neglect_days": 7, "neglect_min_prior": 20, "drift_points": 0.15, "file_days": 6, "min_events": 3}


def area_of(path: str) -> str:
    p = path.split("/")
    return "/".join(p[:2]) if p[0] in TWO and len(p) > 2 else p[0]


def _git(root, *a):
    r = subprocess.run(["git", *a], cwd=root, capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else ""


def day_index(ts: float, today: dt.date) -> int:
    return (today - dt.datetime.fromtimestamp(ts, dt.timezone.utc).date()).days  # 0 = today


def series(days: int):
    return [0] * days  # index 0 = oldest day, last = today


def history(root, days, today):
    """Per-area change (lines), per-area touches, per-file distinct days, issue opens and closes, event counters, all from git."""
    since = (today - dt.timedelta(days=days)).isoformat()
    out = _git(root, "log", f"--since={since}", "--format=@@%ct\x1f%s", "--numstat", "--no-merges")
    lines, touches, filedays = {}, {}, {}
    cur = None
    for ln in out.splitlines():
        if ln.startswith("@@"):
            ts, _, subj = ln[2:].partition("\x1f")
            cur = (days - 1 - day_index(int(ts), today), subj)
            continue
        if not ln.strip() or cur is None or "\t" not in ln:
            continue
        a, d, path = ln.split("\t", 2)
        i = cur[0]
        if not (0 <= i < days) or "{" in path:
            continue
        n = (int(a) if a.isdigit() else 0) + (int(d) if d.isdigit() else 0)
        ar = area_of(path)
        lines.setdefault(ar, series(days))[i] += n
        touches.setdefault(ar, series(days))[i] += 1
        if not RECORD.search(path):
            filedays.setdefault(path, set()).add(i)
    ev = {"reverts": series(days), "conflict_merges": series(days)}
    for ln in _git(root, "log", f"--since={since}", "--format=%ct\x1f%s").splitlines():
        ts, _, subj = ln.partition("\x1f")
        i = days - 1 - day_index(int(ts), today)
        if 0 <= i < days:
            if re.match(r"(?i)revert", subj):
                ev["reverts"][i] += 1
            if re.match(r"(?i)merge (main|the lane|origin)", subj) or "conflict" in subj.lower():
                ev["conflict_merges"][i] += 1
    opened, closed = series(days), series(days)
    for ln in _git(root, "log", f"--since={since}", "--diff-filter=A", "--format=@@%ct", "--name-only", "--", "docs/issues").splitlines():
        if ln.startswith("@@"):
            i = days - 1 - day_index(int(ln[2:]), today)
        elif ln.endswith(".json") and 0 <= i < days:
            opened[i] += 1
    for ln in _git(root, "log", f"--since={since}", "-G\\*\\*Status:\\*\\* closed", "--format=@@%ct", "--name-only", "--", "docs/issues").splitlines():
        if ln.startswith("@@"):
            i = days - 1 - day_index(int(ln[2:]), today)
        elif ln.endswith(".json") and 0 <= i < days:
            closed[i] += 1
    return {"lines": lines, "touches": touches, "filedays": {k: sorted(v) for k, v in filedays.items()}, "events": ev, "issues": {"opened": opened, "closed": closed}}


def ledger_series(root, days, today):
    """Loop activity: rows per day in each ops ledger that stamps its rows with `at`."""
    out = {}
    for p in sorted((Path(root) / "ops").glob("*.jsonl")):
        s = series(days)
        for ln in p.read_text(encoding="utf-8", errors="replace").splitlines():
            m = re.search(r'"(?:at|ts|time)":\s*"(\d{4}-\d\d-\d\d)', ln)
            if m:
                i = days - 1 - (today - dt.date.fromisoformat(m.group(1))).days
                if 0 <= i < days:
                    s[i] += 1
        if sum(s):
            out[p.stem] = s
    return out


def observed_events(root, days, today):
    """Event series the simulator reads. Each is a count per day of something that actually went wrong."""
    ev = dict(history(root, days, today)["events"])
    ci, dep = series(days), series(days)
    f = Path(root) / "ops/checks-session.jsonl"  # a checks run in a cloud session exists because hosted CI could not run
    if f.is_file():
        for ln in f.read_text(encoding="utf-8", errors="replace").splitlines():
            m = re.search(r'"at":\s*"(\d{4}-\d\d-\d\d)', ln)
            if m and 0 <= days - 1 - (today - dt.date.fromisoformat(m.group(1))).days < days:
                ci[days - 1 - (today - dt.date.fromisoformat(m.group(1))).days] += 1
    f = Path(root) / "ops/deploys.jsonl"
    if f.is_file():
        for ln in f.read_text(encoding="utf-8", errors="replace").splitlines():
            if '"live_matches_commit":false' in ln.replace(" ", ""):
                m = re.search(r'"at":\s*"(\d{4}-\d\d-\d\d)', ln)
                if m and 0 <= days - 1 - (today - dt.date.fromisoformat(m.group(1))).days < days:
                    dep[days - 1 - (today - dt.date.fromisoformat(m.group(1))).days] += 1
    ev["ci_unavailable"], ev["deploy_not_live"] = ci, dep
    return ev


def slope(xs):
    n = len(xs)
    if n < 2:
        return 0.0
    mx, my = (n - 1) / 2, sum(xs) / n
    den = sum((i - mx) ** 2 for i in range(n))
    return round(sum((i - mx) * (y - my) for i, y in enumerate(xs)) / den, 4) if den else 0.0


def observed_rate(s, min_days=7):
    """Yearly rate from a per-day event series, and how it is trending. `rate_year` is the whole-window mean annualised; `recent_year` the last third
    annualised; `trend` the relative change from the earlier two thirds to the last third (clamped to [-0.9, 4]), which the simulator applies as
    growth over the simulated year. None until the window holds min_days of history."""
    n = len(s)
    if n < min_days:
        return None
    k = max(3, n // 3)
    early, late = sum(s[:-k]) / max(1, n - k), sum(s[-k:]) / k
    trend = 0.0 if early == 0 and late == 0 else (4.0 if early == 0 else max(-0.9, min(4.0, late / early - 1)))
    return {"rate_year": round(sum(s) / n * 365, 1), "recent_year": round(late * 365, 1), "trend": round(trend, 2), "days": n, "events": sum(s)}


def analyze(lines, ledgers, filedays, issues, days, c=None):
    """Read hotspots, neglect and drift out of the per-day series. Record-keeping areas (ledgers, generated data, issue files) are measured but
    never named a hotspot or neglect: attention to bookkeeping is not attention to the system."""
    c = {**DEFAULT, **(c or {})}
    code = {k: v for k, v in lines.items() if not RECORD.search(k + "/x") and k not in ("ops", "docs/issues")}
    tot_recent = sum(sum(v[-7:]) for v in code.values()) or 1
    tot_all = sum(sum(v) for v in code.values()) or 1
    half = days // 2
    findings, areas = [], []
    for k, v in sorted(code.items(), key=lambda kv: -sum(kv[1])):  # noqa
        recent, prior = sum(v[-7:]), sum(v[:-7]) / max(1, days - 7) * 7
        share = recent / tot_recent
        d1 = sum(v[:half]) / (sum(sum(x[:half]) for x in code.values()) or 1)
        d2 = sum(v[half:]) / (sum(sum(x[half:]) for x in code.values()) or 1)
        last = next((days - 1 - i for i in range(days) if v[days - 1 - i] > 0), None)
        quiet = None if last is None else days - 1 - last
        row = {"area": k, "total": sum(v), "recent7": recent, "share_recent": round(share, 3), "share_trend": round(d2 - d1, 3), "slope": slope(v), "quiet_days": quiet, "series": v}
        areas.append(row)
        if share >= c["hotspot_share"] and recent >= c["hotspot_growth"] * max(prior, 1) and recent >= 40:
            findings.append({"kind": "hotspot", "id": k, "why": f"{k} drew {round(share * 100)}% of the last week's change, {round(recent / max(prior, 1), 1)}x its earlier weekly pace",
                             "evidence": f"recent7 {recent} lines, prior weekly mean {round(prior, 1)}"})
        active = sum(1 for x in (v[:-quiet] if quiet else v) if x > 0)
        if quiet is not None and quiet >= c["neglect_days"] and sum(v[:-quiet]) >= c["neglect_min_prior"] and active >= 3 and tot_recent > 40:
            findings.append({"kind": "neglected", "id": k, "why": f"{k} had {sum(v[:-quiet])} lines of change, then nothing for {quiet} days while the rest of the system moved",
                             "evidence": f"quiet_days {quiet}; system change in the last 7 days {tot_recent}"})
        if abs(d2 - d1) >= c["drift_points"]:
            findings.append({"kind": "drift", "id": k, "why": f"{k}'s share of attention moved {round((d2 - d1) * 100)} points between the first and second half of the window",
                             "evidence": f"share {round(d1 * 100)}% then {round(d2 * 100)}%"})
    neg = sorted([f for f in findings if f["kind"] == "neglected"], key=lambda f: -int(re.search(r"had (\d+) lines", f["why"]).group(1)))
    findings = [f for f in findings if f["kind"] != "neglected"] + neg[:8]
    files = sorted(((f, d) for f, d in filedays.items() if len(d) >= c["file_days"]), key=lambda x: -len(x[1]))
    for f, d in files[:5]:
        findings.append({"kind": "hotspot", "id": f, "why": f"{f} was rewritten on {len(d)} of {days} days", "evidence": f"days with changes: {len(d)}"})
    loops = []
    for k, v in sorted(ledgers.items()):
        last = next((days - 1 - i for i in range(days) if v[days - 1 - i] > 0), None)
        quiet = None if last is None else days - 1 - last
        loops.append({"loop": k, "rows": sum(v), "quiet_days": quiet, "slope": slope(v), "series": v})
        if quiet is not None and quiet >= c["neglect_days"] and sum(v[:-quiet]) >= c["min_events"] * 2:
            findings.append({"kind": "neglected", "id": "loop:" + k, "why": f"the {k} ledger had {sum(v[:-quiet])} rows, then none for {quiet} days: the loop that writes it has gone quiet",
                             "evidence": f"quiet_days {quiet}"})
    o, cl = issues["opened"], issues["closed"]
    backlog = [sum(o[:i + 1]) - sum(cl[:i + 1]) for i in range(days)]
    if days >= 14 and slope(backlog) > 0.5 and sum(o) >= c["min_events"]:
        findings.append({"kind": "drift", "id": "issues", "why": f"issues are opening faster than they close: backlog grew by {backlog[-1] - backlog[0]} over {days} days",
                         "evidence": f"opened {sum(o)}, closed {sum(cl)}"})
    return {"areas": areas[:25], "loops": loops, "files": [{"file": f, "days": len(d)} for f, d in files[:10]], "issues": {"opened": sum(o), "closed": sum(cl), "backlog_series": backlog},
            "findings": findings}


def run(root=ROOT, apply=False, today=None, days=None, conf=None):
    root, today = Path(root), today or dt.date.today()
    c = {**DEFAULT, **(conf or {})}
    n = days or c["days"]
    h = history(root, n, today)
    led = ledger_series(root, n, today)
    a = analyze(h["lines"], led, h["filedays"], h["issues"], n, c)
    ev = observed_events(root, n, today)
    first = min((next((i for i, x in enumerate(v) if x), n) for v in h["lines"].values()), default=n)  # the history starts here; earlier days are not zero, they are unknown
    rec = {"at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "days": n, "history_days": n - first, "today": today.isoformat(), **a,
           "observed": {k: {"series": v, **(observed_rate(v[first:]) or {"rate_year": None})} for k, v in ev.items()}}
    if apply:
        p = root / LATEST
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(rec, indent=1, sort_keys=True) + "\n", encoding="utf-8")
        with (root / LEDGER).open("a", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps({"at": rec["at"], "days": n, "findings": [f"{x['kind']}:{x['id']}" for x in a["findings"]], "hot": [x["area"] for x in a["areas"][:3]],
                                "observed": {k: v.get("rate_year") for k, v in rec["observed"].items()}}, sort_keys=True) + "\n")
    return rec


if __name__ == "__main__":
    root = Path(sys.argv[sys.argv.index("--root") + 1]) if "--root" in sys.argv else Path.cwd()
    r = run(root, apply="--apply" in sys.argv)
    print(json.dumps({"findings": [f"{x['kind']}:{x['id']}" for x in r["findings"]], "observed": {k: v.get("rate_year") for k, v in r["observed"].items()}}, indent=1))

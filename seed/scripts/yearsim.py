# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""YEAR-SIM-1 core: the year-unattended simulator every Ultrastable system carries. Ultrastable is the foundation for any autonomous system.

  python3 scripts/yearsim.py --run [--apply]    drill each fault class (a command that exercises the recovery, exit 0 = recovers), simulate seeded years,
                                                run the sensitivity analysis and write ops/yearsim.json
  python3 scripts/yearsim.py --check            autonomy/yearsim.json is well formed

The engine (events, one_year, horizon, sensitivity) is pure and shared: the Ultrastable platform imports it from here (foundation/yearsim.py), so one
improvement reaches every system. A system declares its faults in autonomy/yearsim.json: each has a yearly rate with a stated basis (observed or
assumed), a duration range, and a `drill` command that injects the fault into the system's real recovery code and exits 0 when the system recovers by
itself. A fault with no drill is `exercised: false` and is never read as a pass. The standing goal is horizon p10 >= target_days (365): a year unattended.
Sensitivity: each fault's rate is doubled and halved and the horizon re-measured, so the faults that move it most are named before they happen."""
from __future__ import annotations
import datetime as dt, json, math, random, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONF = "autonomy/yearsim.json"
LATEST = "ops/yearsim.json"


def R(mode, capacity, recover, exercised, evidence, **kw):
    return {"mode": mode, "capacity": capacity, "recover": recover, "exercised": exercised, "evidence": evidence, **kw}


def events(c, results, rng, today, strict=False):
    """(day, class, duration, drill result) for one simulated span."""
    ev = []
    for f in c["faults"]:
        g = f.get("growth", 0.0)  # TRAJECTORY-1: an observed trend changes the rate over the simulated year, rate(t) = rate * (1 + g * t / 365), by thinning
        lam = f["rate_per_year"] * (1 + max(g, 0.0) * c["days"] / 365.0) / 365.0
        t = 0.0
        while True:
            t += rng.expovariate(lam) if lam > 0 else c["days"] + 1
            if t >= c["days"]:
                break
            if g and rng.random() * (1 + max(g, 0.0) * c["days"] / 365.0) > max(0.0, 1 + g * t / 365.0):
                continue
            lo, hi = f["duration_days"]
            ev.append((int(t), f["id"], rng.uniform(lo, hi), results[f["id"]]))
    for f in c["scheduled"]:
        r = results.get(f["id"])
        if r and r.get("date"):
            day = (dt.date.fromisoformat(r["date"][:10]) - today).days
            if 0 <= day < c["days"]:
                ev.append((day, f["id"], 30.0, r))
    out = []
    for day, fid, dur, r in sorted(ev):
        if strict and r.get("gate"):
            r = {**r, "recover": False, "capacity": 0.0, "mode": "fatal"}
        out.append((day, fid, dur, r))
    return out


def one_year(c, results, seed, today, strict=False) -> dict:
    rng = random.Random(seed)
    evs = events(c, results, rng, today, strict)
    permanent, active, low_run, died, killer = 1.0, [], 0, None, None
    cap_sum = 0.0
    by = {}
    i = 0
    for day in range(c["days"]):
        while i < len(evs) and evs[i][0] == day:
            _, fid, dur, r = evs[i]
            by[fid] = by.get(fid, 0) + 1
            if r["recover"]:
                active.append((day + max(dur, 0.01), r["capacity"], fid))
            else:
                permanent *= r["capacity"]
                if r["capacity"] < 1:
                    killer = fid
            i += 1
        active = [a for a in active if a[0] > day]
        cap = permanent
        for _, k, fid in active:
            cap *= k
        if day < c["target_days"]:
            cap_sum += cap
        if cap < c["fatal_floor"]:
            low_run += 1
            if low_run >= c["fatal_after_days"] and died is None:
                died = day - low_run + 1
                killer = killer or (min(active, key=lambda a: a[1])[2] if active else None)
                break
        else:
            low_run = 0
    return {"horizon": died if died is not None else c["days"], "died": died is not None, "killer": killer if died is not None else None,
            "capacity_year": round(cap_sum / c["target_days"], 3), "events": by}


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, max(0, int(math.floor(p * (len(xs) - 1)))))] if xs else None


def horizon(c, results, runs, today, strict=False, seed=None):
    """Seeded Monte Carlo years: p10/p50/p90 of the day the system stops, the share that reach target_days, and what killed the rest."""
    seed = seed or c.get("seed", "yearsim")
    mode = "strict" if strict else "normal"
    years = [one_year(c, results, f"{seed}|{mode}|{k}", today, strict=strict) for k in range(runs)]
    hs = [y["horizon"] for y in years]
    kills = {}
    for y in years:
        if y["killer"]:
            kills[y["killer"]] = kills.get(y["killer"], 0) + 1
    return {"p10": pct(hs, 0.10), "p50": pct(hs, 0.50), "p90": pct(hs, 0.90), "survive_year": round(sum(h >= c["target_days"] for h in hs) / runs, 3),
            "capacity_year_p50": pct([y["capacity_year"] for y in years], 0.5), "killers": dict(sorted(kills.items(), key=lambda kv: -kv[1]))}


def sensitivity(c, results, today, runs=60, factors=(0.5, 2.0), seed=None):
    """What moves the horizon: each fault's yearly rate scaled by each factor with every other held, ranked by the largest change in the share of years
    that reach the target. A fault whose doubling costs the most is where proactive hardening pays first."""
    base = horizon(c, results, runs, today, seed=seed)
    out = []
    for f in c["faults"]:
        row = {"id": f["id"], "rate": f["rate_per_year"], "effect": {}}
        for k in factors:
            c2 = {**c, "faults": [{**g, "rate_per_year": g["rate_per_year"] * k} if g["id"] == f["id"] else g for g in c["faults"]]}
            h = horizon(c2, results, runs, today, seed=seed)
            row["effect"][str(k)] = {"survive_year": h["survive_year"], "p10": h["p10"], "d_survive": round(h["survive_year"] - base["survive_year"], 3)}
        row["swing"] = round(max(abs(e["d_survive"]) for e in row["effect"].values()), 3)
        out.append(row)
    return {"base": {"survive_year": base["survive_year"], "p10": base["p10"]}, "runs": runs, "ranked": sorted(out, key=lambda r: (-r["swing"], r["id"]))}


# ---------------------------------------------------------------- the standalone runner every system gets

def cfg(root=ROOT):
    return json.loads((Path(root) / CONF).read_text(encoding="utf-8"))


def drills(root, c):
    out = {}
    for f in c["faults"]:
        cmd = f.get("drill")
        if not cmd:
            out[f["id"]] = R("degrades", f.get("capacity", 0.5), True, False, "no drill: the recovery is declared, not exercised")
            continue
        try:
            p = subprocess.run(cmd, cwd=root, capture_output=True, text=True, timeout=f.get("drill_timeout", 120))
            ok, ev = p.returncode == 0, ((p.stdout + p.stderr).strip().splitlines() or ["(no output)"])[-1][:200]
        except (OSError, subprocess.TimeoutExpired) as e:
            ok, ev = False, f"{type(e).__name__}: {str(e)[:150]}"
        out[f["id"]] = R("recovers" if ok else "fatal", f.get("capacity_while", 0.6) if ok else 0.0, ok, True, ev)
    return out


def run(root=ROOT, apply=False, today=None, runs=None):
    root, today = Path(root), today or dt.date.today()
    c = cfg(root)
    tp = root / "ops/trajectory.json"
    c, observed_from = apply_observed(c, json.loads(tp.read_text(encoding="utf-8")).get("observed") if tp.is_file() else None)
    res = drills(root, c)
    n = runs or c.get("runs", 200)
    rec = {"at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "target_days": c["target_days"], "runs": n,
           "horizon": horizon(c, res, n, today), "strict": horizon(c, res, n, today, strict=True),
           "sensitivity": sensitivity(c, res, today), "drills": res, "rates_observed": observed_from}
    rec["meets_target"] = (rec["horizon"]["p10"] or 0) >= c["target_days"]
    if apply:
        p = root / LATEST
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(rec, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    return rec


def check(root=ROOT):
    c, errs = cfg(root), []
    if c.get("target_days", 0) < 365 or c.get("days", 0) < c.get("target_days", 365):
        errs.append("target_days is never below 365 and days must cover it")
    for k in ("runs", "fatal_floor", "fatal_after_days", "faults", "scheduled"):
        if k not in c:
            errs.append("missing " + k)
    for f in c.get("faults", []):
        if not str(f.get("basis", "")).startswith(("observed:", "assumed:")):
            errs.append(f"{f.get('id')}: basis must say observed: or assumed:")
    return errs


def apply_observed(c, observed, min_events=3):
    """Replace a fault's assumed rate with the observed one where the fault names `rate_from` (a key of ops/trajectory.json `observed`) and the history
    holds enough events: rate = the larger of the window mean and the recent third (the conservative reading), growth = the observed trend, damped to
    at most +1 a year. The basis is rewritten to say so. Faults without an observed series keep their stated rate."""
    out, used = [], []
    for f in c["faults"]:
        o = (observed or {}).get(f.get("rate_from") or "")
        if o and o.get("rate_year") is not None and o.get("events", 0) >= min_events:
            f = {**f, "rate_per_year": max(o["rate_year"], o["recent_year"]), "growth": max(-0.5, min(1.0, o.get("trend", 0.0))),
                 "basis": f"observed: {o['events']} events in {o['days']} days of this system's own history (ops/trajectory.json {f['rate_from']}), trend {o.get('trend', 0):+.2f}"}
            used.append(f["id"])
        out.append(f)
    return {**c, "faults": out}, used


if __name__ == "__main__":
    a = sys.argv[1:]
    if "--check" in a:
        e = check(Path(a[a.index("--root") + 1]) if "--root" in a else Path.cwd())
        print("yearsim ok" if not e else "\n".join(e))
        sys.exit(1 if e else 0)
    r = run(Path(a[a.index("--root") + 1]) if "--root" in a else Path.cwd(), apply="--apply" in a)
    print(json.dumps({k: r[k] for k in ("horizon", "strict", "meets_target")}, indent=1))
    print("most sensitive:", [(x["id"], x["swing"]) for x in r["sensitivity"]["ranked"][:3]])

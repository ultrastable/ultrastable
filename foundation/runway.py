# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""RUNWAY-1: how many days the system is projected to keep running with no person. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation runway --run [--apply] [--changed-file F]   measure each component; --apply writes ops/runway.json and files Q-RUNWAY items
  python3 -m foundation runway --probe COMPONENT                    closing probe of a Q-RUNWAY item: the recorded component meets the target
  python3 -m foundation runway --check                              doctrine/runway.json is well formed

Components (the runway is the smallest; None means no limit was found, "unmeasured" is never counted as ok):
  credentials  ops/credwatch.json + doctrine/credwatch.json: days until a token or a registration without auto-renew lapses; an invalid one is 0
  cost         ops/cost.jsonl against ops/cost-thresholds.json: days until a free-plan limit at the growth measured over the trend window
  failures     docs/issues: a failure item open longer than max_failure_open_days means nothing is repairing it, which is 0
Data: doctrine/runway.json. Consumers: .github/workflows/watchdog.yml, tests/foundation/test_runway.py."""
from __future__ import annotations
import datetime as dt, json, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def cfg(root=REPO) -> dict:
    return json.loads((Path(root) / "doctrine/runway.json").read_text(encoding="utf-8"))


def _load(p: Path, default):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def _day(s) -> dt.date | None:
    try:
        return dt.date.fromisoformat(str(s)[:10])
    except ValueError:
        return None


def credentials(root: Path, today: dt.date) -> dict:
    rec = _load(root / "ops/credwatch.json", None)
    if rec is None:
        return {"days": "unmeasured", "why": "ops/credwatch.json has not been written yet"}
    renews = {r["name"] for r in _load(root / "doctrine/credwatch.json", {}).get("registrations", []) if r.get("auto_renew")}
    days, why = None, "nothing that lapses"
    for r in rec["rows"]:
        if r["state"] == "unbound" or r["name"] in renews or r.get("optional"):
            continue  # not in use, or renews itself
        if r["state"] == "unmeasured":
            return {"days": "unmeasured", "why": f"{r['name']} could not be probed"}
        e = _day(r.get("expires"))
        d = 0 if r["state"] in ("invalid", "expired") else (e - today).days if e else None
        if d is not None and (days is None or d < days):
            days, why = max(d, 0), f"{r['name']} is {r['state']}" + (f", expires {r['expires']}" if e else "")
    return {"days": days, "why": why}


def _usage(rec: dict, th: dict) -> float | None:
    """The largest share of a free-plan limit one reading used; None for a reading that measured nothing."""
    if rec.get("unmeasured"):
        return None
    over = th.get("rows_read_override", {})
    shares = [d.get("rows_read", 0) / over.get(d.get("name"), th["rows_read_max"]) for d in rec.get("d1") or []]
    n = rec.get("neurons") if rec.get("neurons") is not None else (rec.get("ai") or {}).get("neurons")
    if n is not None:
        shares.append(n / th["neurons_max"])
    return max(shares) if shares else None


def cost(root: Path, today: dt.date, c: dict) -> dict:
    th = _load(root / "ops/cost-thresholds.json", None)
    p = root / "ops/cost.jsonl"
    if th is None or not p.exists():
        return {"days": "unmeasured", "why": "no cost ledger"}
    pts = []
    for line in p.read_text(encoding="utf-8").splitlines():
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        d, u = _day(rec.get("ts") or rec.get("at") or rec.get("date")), _usage(rec, th)
        if d and u is not None:
            pts.append((d, u))
    if not pts or (today - pts[-1][0]).days > c["cost_max_age_days"]:
        return {"days": "unmeasured", "why": f"last measured cost reading is {pts[-1][0].isoformat() if pts else 'absent'}"}
    last_d, last_u = pts[-1]
    if last_u >= 1:
        return {"days": 0, "why": f"a free-plan limit is at {last_u:.0%}", "share": round(last_u, 3)}
    old = next(((d, u) for d, u in pts if (last_d - d).days <= c["cost_trend_days"] and d < last_d), None)
    slope = (last_u - old[1]) / (last_d - old[0]).days if old else 0
    days = int((1 - last_u) / slope) if slope > 0 else None
    return {"days": days, "why": f"largest share of a free-plan limit {last_u:.0%}" + (f", growing {slope:.2%} a day" if slope > 0 else ", not growing"), "share": round(last_u, 3)}


def failures(root: Path, today: dt.date, c: dict, seen: dict) -> tuple[dict, dict]:
    """Open failure items, aged from the day this ledger first saw each (items carry no date of their own)."""
    now = {}
    for f in sorted((root / "docs/issues").glob("*.json")):
        try:
            it = json.loads(f.read_text(encoding="utf-8"))
        except ValueError:
            continue
        if not isinstance(it, dict):
            continue
        iid = str(it.get("id", f.stem))
        if "**Status:** open" not in str(it.get("body", "")):
            continue
        if any(iid.startswith(p) for p in c["failure_prefixes"]) or set(it.get("labels") or []) & set(c["failure_labels"]):
            now[iid] = seen.get(iid, today.isoformat())
    if not now:
        return {"days": None, "why": "no open failure item", "open": 0}, now
    oldest = min(now, key=now.get)
    age = (today - dt.date.fromisoformat(now[oldest])).days
    if age > c["max_failure_open_days"]:
        return {"days": 0, "why": f"{oldest} has been open {age} days", "open": len(now)}, now
    return {"days": None, "why": f"{len(now)} open, oldest {age} days", "open": len(now)}, now


def measure(root=REPO, today=None) -> dict:
    root = Path(root); c = cfg(root); today = today or dt.datetime.now(dt.timezone.utc).date()
    prev = _load(root / "ops/runway.json", {})
    fail, seen = failures(root, today, c, prev.get("failure_first_seen", {}))
    comp = {"credentials": credentials(root, today), "cost": cost(root, today, c), "failures": fail}
    nums = [v["days"] for v in comp.values() if isinstance(v["days"], int)]
    unmeasured = sorted(k for k, v in comp.items() if v["days"] == "unmeasured")
    below = sorted(k for k, v in comp.items() if v["days"] == "unmeasured" or (isinstance(v["days"], int) and v["days"] < c["target_days"]))
    return {"target_days": c["target_days"], "runway_days": min(nums) if nums else None, "meets_target": not below, "below": below,
            "unmeasured": unmeasured, "components": comp, "failure_first_seen": seen}


def item(name: str, comp: dict, target: int) -> dict:
    iid = f"Q-RUNWAY-{name}"
    return {"id": iid, "title": f"{iid}: unattended runway is {comp['days']} days on {name} (target {target})",
            "body": f"**Owner:** staff\n**Trigger:** every watchdog run\n**Done check:** cmd:python3 -m foundation runway --probe {name}\n**Status:** open\n\n"
                    f"RUNWAY-1: the system is to run {target} days with no person. Component `{name}`: {comp['why']}. "
                    "Remove the limit (a route that needs no expiring credential, a cheaper read path, a repair loop for the failure) or make the measurement work; do not change the target.\n",
            "labels": ["role:staff", "raises-self", "runway"], "milestone": "Now", "workstream": "Reliability"}


def run(root=REPO, apply=False, today=None) -> dict:
    root = Path(root); m = measure(root, today); changed = False
    if apply:
        out, new = root / "ops/runway.json", json.dumps(m, indent=1) + "\n"
        if not out.exists() or out.read_text(encoding="utf-8") != new:
            out.parent.mkdir(parents=True, exist_ok=True); out.write_text(new, encoding="utf-8"); changed = True
        for name in m["below"]:
            p = root / "docs/issues" / f"Q-RUNWAY-{name}.json"
            if not p.exists():
                p.write_text(json.dumps(item(name, m["components"][name], m["target_days"]), indent=2) + "\n", encoding="utf-8"); changed = True
    return {**m, "changed": changed}


def probe(name: str, root=REPO) -> int:
    m = _load(Path(root) / "ops/runway.json", {"below": [name]})
    ok = name not in m.get("below", [])
    print(f"{name}: {'meets' if ok else 'below'} target")
    return 0 if ok else 1


def check(root=REPO) -> list[str]:
    c, bad = cfg(root), []
    for k in ("target_days", "cost_max_age_days", "cost_trend_days", "max_failure_open_days"):
        if not isinstance(c.get(k), int) or c[k] <= 0:
            bad.append(f"{k} must be a positive whole number")
    if c.get("target_days", 0) < 365:
        bad.append("target_days is below the owner's minimum of 365")
    return bad


def main(argv=None) -> int:
    argv = sys.argv[1:] if argv is None else argv
    if "--check" in argv:
        bad = check()
        print("\n".join(bad) or "runway ok")
        return 1 if bad else 0
    if "--probe" in argv:
        return probe(argv[argv.index("--probe") + 1])
    r = run(REPO, "--apply" in argv)
    if "--changed-file" in argv and r["changed"]:
        Path(argv[argv.index("--changed-file") + 1]).write_text("1", encoding="utf-8")
    print(json.dumps({k: v for k, v in r.items() if k != "failure_first_seen"}, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())

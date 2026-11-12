"""CLOCKWORK-1: per-stage freshness, catch-up ticks, settlement by name and escalation. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation clockwork --check            the declaration is valid and every stage names evidence that exists
  python3 -m foundation clockwork --report [--now T]  one row per stage: age, missed ticks, drift, verdict, escalation step
  python3 -m foundation clockwork --run [--apply]     file the escalation items for stages that missed; --apply writes them
  python3 -m foundation clockwork --probe STAGE       exit 0 when that stage is on time (the closing probe of its Q-CLOCK item)
  python3 -m foundation clockwork --hard-fail         exit 1 when any stage missed more ticks than its threshold allows

A stage is `on-time` when its newest evidence row is younger than cadence + max_late. Missed ticks are whole cadences elapsed beyond that.
Drift is the mean deviation of the last gaps between rows from the declared cadence. A catch-up is settled by name: the row that closes it is the
next evidence row from the same stage (field `stage` or the file's stage id), never a person's say-so. Evidence logs are written by the loops themselves.
"""
from __future__ import annotations
import datetime as dt, json, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/clockwork.json"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def _t(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def times(root, stage) -> list[dt.datetime]:
    p = Path(root) / stage["evidence"]
    out = []
    if p.is_file():
        for line in p.read_text(encoding="utf-8").splitlines():
            try:
                out.append(_t(json.loads(line)["at"]))
            except (ValueError, KeyError, TypeError):
                continue
    return sorted(out)


def measure(stage: dict, ts: list[dt.datetime], now: dt.datetime) -> dict:
    cad = stage["cadence_minutes"]
    if not ts:
        return {"stage": stage["id"], "age_min": None, "missed": None, "drift_min": None, "verdict": "never", "step": "item"}
    age = (now - ts[-1]).total_seconds() / 60
    over = age - cad - stage["max_late_minutes"]
    missed = 0 if over <= 0 else int(over // cad) + 1
    w = ts[-6:]
    gaps = [(b - a).total_seconds() / 60 for a, b in zip(w, w[1:])]
    drift = round(sum(abs(g - cad) for g in gaps) / len(gaps), 1) if gaps else 0.0
    return {"stage": stage["id"], "age_min": round(age, 1), "missed": missed, "drift_min": drift, "verdict": "on-time" if not missed else "missed", "step": step(missed, load()["escalation"])}


def step(missed: int, ladder: list[dict]) -> str:
    cur = "none"
    for r in sorted(ladder, key=lambda r: r["after_missed"]):
        if missed >= r["after_missed"]:
            cur = r["action"]
    return cur


def report(root=REPO, now=None) -> list[dict]:
    now = now or dt.datetime.now(dt.timezone.utc)
    return [measure(s, times(root, s), now) for s in load(root)["stages"]]


def settle(root, stage_id: str, since: dt.datetime) -> bool:
    """A catch-up for a stage is settled by name when that stage left a row after `since`."""
    s = next(s for s in load(root)["stages"] if s["id"] == stage_id)
    return any(t > since for t in times(root, s))


def item(stage: dict, row: dict) -> dict:
    return {"id": "Q-CLOCK-" + stage["id"], "title": f"Q-CLOCK-{stage['id']}: stage {stage['id']} missed {row['missed']} tick(s)",
            "body": f"**Owner:** operations\n**Trigger:** every clockwork run\n**Done check:** cmd:python3 -m foundation clockwork --probe {stage['id']}\n**Status:** open\n\nStage `{stage['id']}` of loop `{stage['loop']}` is {row['verdict']}: age {row['age_min']} min against cadence {stage['cadence_minutes']}. Catch-up: `{stage['catch_up']}`. Settled by the stage's own next evidence row.",
            "labels": ["role:operations", "clock", "repair"], "milestone": "Now", "workstream": "Clockwork"}


def run(root=REPO, now=None, apply=False) -> list[dict]:
    d, filed = load(root), []
    for s, row in zip(d["stages"], report(root, now)):
        if row["step"] in ("item", "reroute"):
            it = item(s, row); filed.append(it)
            if apply:
                (Path(root) / "docs/issues" / (it["id"] + ".json")).write_text(json.dumps(it, indent=2) + "\n", encoding="utf-8")
    return filed


def check(root=REPO) -> list[str]:
    d, bad, ids = load(root), [], set()
    acts = [r["after_missed"] for r in d["escalation"]]
    if acts != sorted(acts) or not acts:
        bad.append("escalation ladder must be non-empty and ascending")
    for s in d["stages"]:
        if s["id"] in ids: bad.append("duplicate stage " + s["id"])
        ids.add(s["id"])
        for k in ("loop", "cadence_minutes", "evidence", "max_late_minutes", "catch_up"):
            if not s.get(k): bad.append(f"{s['id']}: missing {k}")
        if not (Path(root) / s["evidence"]).is_file(): bad.append(f"{s['id']}: evidence file {s['evidence']} does not exist")
    return bad


def main(argv: list[str]) -> int:
    now = _t(argv[argv.index("--now") + 1]) if "--now" in argv else None
    if "--probe" in argv:
        r = next(r for r in report(now=now) if r["stage"] == argv[argv.index("--probe") + 1])
        print(json.dumps(r)); return 0 if r["verdict"] == "on-time" else 1
    if "--report" in argv or "--hard-fail" in argv:
        rows = report(now=now); print(json.dumps(rows, indent=1))
        lim = next((r["after_missed"] for r in load()["escalation"] if r["action"] == "item"), 3)
        return 1 if "--hard-fail" in argv and any((r["missed"] or 0) >= lim or r["verdict"] == "never" for r in rows) else 0
    if "--run" in argv:
        print(json.dumps([i["id"] for i in run(now=now, apply="--apply" in argv)])); return 0
    bad = check(); print("\n".join(bad) or "clockwork ok"); return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

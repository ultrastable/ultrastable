"""COST-GUARD-1: the declaration of the cost findings and the reader of the latest cost reading.

  python3 -m foundation cost --check    doctrine/cost.json is well formed and ops/cost-thresholds.json exists
  python3 -m foundation cost --level    normalized cost of the latest reading (1.0 = at budget)

Measuring and filing breaches is deploy/cost-probe.mjs (Q-COST-PROOF-1); budgets are in ops/cost-thresholds.json. This module turns the latest line of ops/cost.jsonl
into one number that foundation/criticality.py uses as the cost term of k and as the control-rod trigger.
"""
from __future__ import annotations
import json, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/cost.json"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def check(root=REPO) -> list[str]:
    c, errs = load(root), []
    for k in ("standing_goal", "budgets", "findings", "account_id", "closing_probe"):
        if k not in c:
            errs.append("missing " + k)
    for f in c.get("findings", []):
        if not f.get("remedy") or not f.get("status"):
            errs.append(f"finding {f.get('id')} lacks remedy or status")
    if not (Path(root) / "ops/cost-thresholds.json").is_file():
        errs.append("ops/cost-thresholds.json is missing")
    return errs


def level(reading: dict, thr: dict) -> float:
    """Largest share of budget used: any database's rows read over its max, or the AI neurons over neurons_max."""
    over = [thr.get("rows_read_override", {}).get(d.get("name"), thr["rows_read_max"]) for d in reading.get("d1", [])]
    shares = [d["rows_read"] / m for d, m in zip(reading.get("d1", []), over)] + [reading.get("ai", {}).get("neurons", 0) / thr["neurons_max"]]
    return round(max(shares), 3)


def normalized(root=REPO) -> float:
    root = Path(root)
    p, t = root / "ops/cost.jsonl", root / "ops/cost-thresholds.json"
    if not (p.is_file() and t.is_file()):
        return 0.0
    rows = [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]
    return level(rows[-1], json.loads(t.read_text(encoding="utf-8"))) if rows else 0.0


def main(argv=None) -> int:
    a = argv if argv is not None else sys.argv[1:]
    if "--check" in a:
        e = check(); print("\n".join(e) or "cost declaration ok"); return 1 if e else 0
    if "--level" in a:
        print(normalized()); return 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main())

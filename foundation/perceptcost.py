# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""PERCEPT-COST-1: does the repo map save reading? Measured weekly on a fixed question set, no model calls, no spend.

  python3 -m foundation perceptcost [--run [--apply] [--due]]   score doctrine/replay-set.json; --apply appends ops/perception-cost.jsonl;
                                                                 --due skips unless the last row is older than interval_days
  python3 -m foundation perceptcost --check                     the replay set parses and every answer file exists

Each question names keywords and the file that holds the answer. Without the map an agent greps the keywords and reads every
matching file: cost = tokens of all files containing a keyword. With the map it looks the keywords up in the REPO-MAP-1 cards
and reads the cards plus the answer file; if the answer file is not among the cards the map missed and the cost is the without-map
cost plus the cards. Tokens are characters / 4. This is a PROXY for perception cost, not an agent run: it says nothing about
whether an agent solves a task, and the real A/B on agent sessions stays a TOKEN-LOG-1 comparison. A kill criterion is in the set:
a median saving under min_saving over the questions the map answered retires the map.
Ultrastable is the foundation for any autonomous system.
"""
from __future__ import annotations
import datetime as dt, json, statistics, subprocess, sys
from pathlib import Path

from . import repomap

REPO = Path(__file__).resolve().parents[1]
SET = "doctrine/replay-set.json"
LOG = "ops/perception-cost.jsonl"
MAX_BYTES = 1_000_000


def tok(n_chars: int) -> int:
    return n_chars // 4


def tracked(root) -> list[str]:
    return subprocess.run(["git", "-C", str(root), "ls-files"], capture_output=True, text=True).stdout.splitlines()


def grep_cost(root, kws, paths) -> int:
    total = 0
    for f in paths:
        p = root / f
        try:
            if not p.is_file() or p.stat().st_size > MAX_BYTES:
                continue
            t = p.read_text(errors="strict")
        except (UnicodeDecodeError, OSError):
            continue
        if any(k in t for k in kws):
            total += tok(len(t))
    return total


def map_hits(cards: dict, kws) -> dict:
    return {p: c for p, c in cards.items() if any(k.lower() in (p + " " + c["purpose"] + " " + " ".join(c["defs"])).lower() for k in kws)}


def score(root=REPO, paths=None) -> dict:
    spec = json.loads((root / SET).read_text())
    cards, _ = repomap.build(root)
    paths = paths if paths is not None else tracked(root)
    rows = []
    for q in spec["questions"]:
        base = grep_cost(root, q["keywords"], paths)
        hits = map_hits(cards, q["keywords"])
        card_tok = sum(tok(len(f"{p} {c['purpose']} {' '.join(c['defs'][:8])}")) for p, c in hits.items())
        ans = root / q["answer"]
        ans_tok = tok(len(ans.read_text(errors="replace"))) if ans.is_file() else 0
        hit = q["answer"] in hits
        with_map = card_tok + (ans_tok if hit else base)
        rows.append({"id": q["id"], "without_map": base, "with_map": with_map, "map_hit": hit})
    answered = [r for r in rows if r["map_hit"] and r["without_map"]]
    saving = statistics.median([1 - r["with_map"] / r["without_map"] for r in answered]) if answered else None
    return {"date": dt.date.today().isoformat(), "questions": len(rows), "map_hits": len(answered), "median_saving": None if saving is None else round(saving, 3),
            "overall_saving": round(1 - sum(r["with_map"] for r in rows) / max(1, sum(r["without_map"] for r in rows)), 3),
            "min_saving": spec["min_saving"], "kill": saving is not None and saving < spec["min_saving"], "rows": rows}


def due(root=REPO, now=None) -> bool:
    p = root / LOG
    if not p.exists() or not p.read_text().strip():
        return True
    last = json.loads(p.read_text().strip().splitlines()[-1])["date"]
    days = json.loads((root / SET).read_text())["interval_days"]
    return ((now or dt.date.today()) - dt.date.fromisoformat(last)).days >= days


def check(root=REPO) -> list[str]:
    try:
        spec = json.loads((root / SET).read_text())
    except (ValueError, OSError) as e:
        return [f"replay set unreadable: {e}"]
    errs = [f"{q.get('id')}: answer file missing: {q.get('answer')}" for q in spec.get("questions", []) if not (root / q.get("answer", "")).is_file()]
    return errs or ([] if spec.get("questions") else ["no questions"])


def main(argv) -> int:
    if "--check" in argv:
        errs = check(); print("\n".join(errs) or "perceptcost ok"); return 1 if errs else 0
    if "--run" in argv:
        if "--due" in argv and not due():
            print("perceptcost: not due"); return 0
        r = score()
        print(json.dumps({k: v for k, v in r.items() if k != "rows"}))
        if "--apply" in argv:
            (REPO / LOG).parent.mkdir(exist_ok=True)
            with open(REPO / LOG, "a") as f:
                f.write(json.dumps(r, sort_keys=True) + "\n")
        return 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

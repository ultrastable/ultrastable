"""PRIORITIZE-1: the ranker. Turns the open queue (docs/issues/*.json) into one ordered list the executor takes from, so nobody hand-sorts a backlog.

  python3 -m foundation prioritize          print the ranking (top 25) and the owner-held items; no writes
  python3 -m foundation prioritize --apply  write docs/PRIORITY-QUEUE.md and ops/priority-queue.json

Score = (weight of the best-matching goal in doctrine/priorities.json
         + unblocks_weight * number of other open items that name this item (dependency centrality)
         + label bonus (p0..p3) + capped age bonus) / size divisor (S, M, L from the body).
PRIORITIZE-2 (multi-objective): an item is a vector over every goal it serves, not only its best one.
  value = best goal weight * shadow price + secondary_share * sum(other matched weights * their shadow price)
A goal's shadow price rises while its constraint binds (conf "constraints": a static "active" flag or a live
"signal" such as cost over budget from foundation/criticality), so the queue tilts toward whatever is breached now.
Items on the Pareto front of (value, unblocks, 1/size) get pareto_bonus: nothing else is better on every axis.
Items held by the owner (identity-bound) are listed, not ranked for the executor. Items whose last executor rows failed are parked by
foundation/queue.py before ranking, so a bad item cannot starve the rest.
"""
from __future__ import annotations
import json, re, sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CONF = "doctrine/priorities.json"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / CONF).read_text(encoding="utf-8"))


def _size(body: str) -> str:
    m = re.search(r"^size:\s*([SML])\b", body, re.M | re.I)
    return m.group(1).upper() if m else "M"


def shadow_prices(conf: dict, signals: dict | None = None) -> dict:
    """Multiplier per goal id: product of every binding constraint's multiplier (1.0 when nothing binds)."""
    signals = signals or {}
    out = {}
    for c in conf.get("constraints", []):
        if c.get("active") or (c.get("signal") and signals.get(c["signal"])):
            out[c["goal"]] = out.get(c["goal"], 1.0) * float(c.get("multiplier", 1.0))
    return out


def live_signals(root=REPO) -> dict:
    """Binding-constraint signals read from the repo's own computed state. A failure to read is logged, not swallowed, and binds nothing."""
    sig = {}
    try:
        from . import criticality
        r = criticality.compute(root, feed_ok=True)
        sig["cost_over_budget"] = r.get("cost", 0) > 1.0
        sig["k_below_floor"] = r.get("k", 0) < criticality.cfg(root).get("k_floor", 0)
    except Exception as e:  # noqa: BLE001 - reported below, ranking proceeds unweighted
        print(f"prioritize: live signals unavailable ({type(e).__name__}: {e})", file=sys.stderr)
    return sig


def pareto_fronts(points: list[tuple]) -> list[int]:
    """Front index per point (0 = non-dominated), maximizing every coordinate."""
    n, front, left, k = len(points), [None] * len(points), set(range(len(points))), 0
    while left:
        cur = {i for i in left if not any(all(a >= b for a, b in zip(points[j], points[i])) and points[j] != points[i] for j in left)}
        for i in cur:
            front[i] = k
        left -= cur
        k += 1
    return front


def score_items(items: list[dict], conf: dict, now: float | None = None, signals: dict | None = None) -> list[dict]:
    """items: dicts with id, title, body, labels (names), mtime (epoch, optional). Highest score first; owner-held rows last."""
    now = now or datetime.now(timezone.utc).timestamp()
    held_re = re.compile(conf["owner_held_pattern"])
    price = shadow_prices(conf, signals)
    ids = [str(i["id"]) for i in items]
    mentions = {x: 0 for x in ids}
    for it in items:
        text = it["title"] + " " + it["body"]
        for other in ids:
            if other != str(it["id"]) and re.search(rf"(?<![\w-]){re.escape(other)}(?![\w-])", text):
                mentions[other] += 1
    rows = []
    for it in items:
        text = f'{it["id"]} {it["title"]}'.lower()  # id and title only: body text names every goal in passing
        hits = sorted(((g["weight"] * price.get(g["id"], 1.0), g["id"]) for g in conf["goals"]
                       if any(m.lower() in text for m in g["match"])), reverse=True)
        goal, gw = (hits[0][1], hits[0][0]) if hits else (None, 0)
        gw += conf.get("secondary_share", 0.25) * sum(w for w, _ in hits[1:])
        owner = re.search(r"^\*\*Owner:\*\*\s*(.+)$", it["body"], re.M)
        held = bool(held_re.search(owner.group(1) if owner else ""))
        bonus = max([conf["label_bonus"].get(l, 0) for l in it.get("labels", [])] or [0])
        age = min(conf["age_cap"], conf["age_weight_per_day"] * max(0, (now - it.get("mtime", now)) / 86400))
        unb = mentions[str(it["id"])]
        size = _size(it["body"])
        pin = conf["pins"]["bonus"] if str(it["id"]) in conf["pins"]["ids"] else 0
        raw = gw + conf["unblocks_weight"] * unb + bonus + age + pin
        div = conf["size_divisor"].get(size, 1.5)
        rows.append({"id": it["id"], "title": it["title"], "goal": goal, "goals": [g for _, g in hits], "unblocks": unb, "size": size,
                     "held": held, "score": raw / div, "_pt": (round(gw, 3), unb, round(1 / div, 3))})
    fronts = pareto_fronts([r["_pt"] for r in rows])
    for r, f in zip(rows, fronts):
        r["front"] = f
        r["score"] = round(r["score"] + (conf.get("pareto_bonus", 0) if f == 0 else 0), 2)
        del r["_pt"]
    return sorted(rows, key=lambda r: (r["held"], -r["score"], str(r["id"])))


def load_open(root=REPO) -> list[dict]:
    """Every open item in docs/issues: queue items (OL-*, Q-*) and roadmap items (FN-1, WEB-1, ...)."""
    out = []
    for p in sorted((Path(root) / "docs/issues").glob("*.json")):
        try:
            j = json.loads(p.read_text(encoding="utf-8"))
        except ValueError:
            continue
        if not isinstance(j, dict) or "id" not in j:
            continue
        body = j.get("body", "")
        if re.search(r"\*\*Status:\*\*\s*(closed|done)", body, re.I):
            continue
        out.append({"id": j["id"], "title": j.get("title", j["id"]), "body": body, "labels": j.get("labels", []), "mtime": p.stat().st_mtime})
    return out


# DECISION-METRIC: work-queue-priority (the ranking the executor takes from; the pick is logged and scored in foundation/executor.py)
def rank(root=REPO, now=None, signals=None) -> list[dict]:
    return score_items(load_open(root), load(root), now, live_signals(root) if signals is None else signals)


def score_map(root=REPO) -> dict:
    return {str(r["id"]): r["score"] for r in rank(root) if not r["held"]}


def render(rows: list[dict], top=40) -> str:
    live = [r for r in rows if not r["held"]]
    held = [r for r in rows if r["held"]]
    out = ["# Priority queue", "", "Generated by `python3 -m foundation prioritize --apply` from `doctrine/priorities.json`; the executor takes from the top. Do not edit.", "",
           f"{len(live)} items the system works, {len(held)} held for the owner.", "", "| # | item | goals | unblocks | size | front | score |", "|---|---|---|---|---|---|---|"]
    for n, r in enumerate(live[:top], 1):
        out.append(f'| {n} | {r["id"]}: {r["title"][:70]} | {"+".join(r["goals"]) or "-"} | {r["unblocks"]} | {r["size"]} | {r["front"]} | {r["score"]} |')
    if held:
        out += ["", "## Held for the owner (identity-bound)", ""] + [f'- {r["id"]}: {r["title"][:90]}' for r in held]
    return "\n".join(out) + "\n"


def main(argv=None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    rows = rank()
    if "--apply" in argv:
        (REPO / "docs/PRIORITY-QUEUE.md").write_text(render(rows), encoding="utf-8")
        (REPO / "ops/priority-queue.json").write_text(json.dumps([r for r in rows if not r["held"]][:100], indent=1) + "\n", encoding="utf-8")
        print(f"wrote docs/PRIORITY-QUEUE.md ({len(rows)} items)")
        return 0
    print(render(rows, 25))
    return 0

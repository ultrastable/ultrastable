"""Owner-step engine: detect, attempt every autonomous route, fall back, open at most ONE card (docs/ops/OWNER-STEPS.md).
Ultrastable is the foundation for any autonomous system; the owner sets direction and receives reports, and is the actor only for acts only they can do.
Statuses: done (already satisfied), automated (a completing route succeeded), prepared (all autonomous work done, one identity-bound card open),
degraded (not identity-bound and every route failed: a backlog item, never a card).
"""
from __future__ import annotations
import json
from dataclasses import dataclass, field
from pathlib import Path

from . import handlers, ladder

DATA = Path(__file__).parent / "data" / "owner-steps.json"


@dataclass
class StepCtx(ladder.Ctx):
    facts: dict = field(default_factory=dict)
    http: object = None          # callable(method, url, body) -> (status, json)
    state: dict = field(default_factory=dict)


def evaluate(step: dict, m: dict, ctx: StepCtx, out, apply=False, table=None) -> dict:
    res = {"id": step["id"], "title": step["title"], "attempts": [], "status": None, "card": None}
    sw = step.get("satisfied_when")
    if sw and ctx.facts.get(sw["fact"]):
        res["status"] = "done"
        res["attempts"].append({"route": "detect", "ok": True, "detail": f"fact {sw['fact']} already true"})
        return res
    ladder_card = None
    completed = False
    for r in step["routes"]:
        try:
            if r["kind"] == "credential":
                a = ladder.acquire(r["ref"], ctx, table)
                ok, detail = a["status"] == "acquired", f"ladder {r['ref']}: " + (f"via {a['via']}" if a["via"] else f"{len(a['attempts'])} route(s) failed")
                ladder_card = a["card"] or ladder_card
            else:
                ok, detail = handlers.REGISTRY[r["ref"]](m, ctx, out, apply)
        except Exception as e:  # recorded, never swallowed: the failure becomes a backlog item
            ok, detail = False, f"handler error {type(e).__name__}: {e}"
            res.setdefault("failures", []).append({"route": r["id"], "error": detail})
        res["attempts"].append({"route": r["id"], "ok": ok, "detail": detail})
        if ok and r.get("completes"):
            completed = True
            break
    if completed:
        res["status"] = "automated"
        return res
    if not step["identity_bound"]:
        res["status"] = "degraded"
        res["backlog"] = f"{step['id']}: every autonomous route failed; retry on the next tick with the recorded detail"
        return res
    card = step["card"]
    if card == "from-ladder":
        card = ladder_card
    elif card == "from-filing-plan":
        card = ctx.state.get("filing_card")
    if card is None:  # nothing to ask for: the filing plan said no filing is needed
        res["status"] = "done"
        return res
    if "line" not in card:
        card = {"id": card["id"], "line": "IDENTITY-BOUND: " + card["what"], "why": card["why"], "default_in_effect": card["default"], "closing_probe": card["probe"]}
    res["status"], res["card"] = "prepared", card
    return res


def evaluate_all(m: dict, ctx: StepCtx, out, apply=False, table=None) -> dict:
    steps = json.loads(DATA.read_text(encoding="utf-8"))["steps"]
    results = [evaluate(s, m, ctx, out, apply, table) for s in steps]
    cards = {}
    for r in results:  # one card per id, merged across steps
        if r["card"]:
            cards.setdefault(r["card"]["id"], r["card"])
    return {"results": results, "cards": list(cards.values()),
            "summary": {s: sum(1 for r in results if r["status"] == s) for s in ("done", "automated", "prepared", "degraded")}}

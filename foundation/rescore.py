# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""RESCORE-1: a held-out grader re-scores settled predictions (Q-GAP-cross-model-rescoring). Ultrastable is the foundation for any autonomous system.

  python3 -m foundation rescore --run [--apply]   re-score every settled decision that has no held-out verdict yet (at most MAX_PER_RUN a run)
  python3 -m foundation rescore --check           fails when a settled decision older than GRACE_H has no held-out verdict (the fix is --run --apply)
  python3 -m foundation rescore --probe ID        passes when the newest held-out verdict for that decision agrees with the system's own score
  python3 -m foundation rescore --status          agreement rate, per grader, as JSON

The system scores its own predictions (foundation/decisions.py). Two graders that share no code with that scorer read the raw evidence again:

  strict-rule    re-derives the outcome from the evidence with the strict reading: an item counts as closed only when its record says closed AND its
                 own done check passes now. A pull request that was merely opened is not a closed item.
  second-model   a model from the reviewer ensemble (foundation/agents.py, a different family for every reviewer) is given the decision, what the
                 metric means and the raw evidence, and answers hit, miss or cannot-tell. An unreachable model is recorded as unavailable and retried;
                 it is never counted as agreement.

Every verdict is a row in ops/decisions/rescore.jsonl. A disagreement files docs/issues/Q-RESCORE-<id>.json (owner reviewer) whose done check is
`rescore --probe <id>`, so it closes itself when the score or the evidence is corrected. This narrows self-scoring; it is not an outside audit
(Q-GAP-external-audit stays a separate, open obligation). Consumers: scripts/regen_generated.py (runs it after every merge), doctrine/rules.json
(rule held-out-rescoring), tests/foundation/test_rescore.py.
"""
from __future__ import annotations
import datetime as dt, json, re, sys
from pathlib import Path

from . import decisions, queue

REPO = Path(__file__).resolve().parents[1]
LEDGER = "ops/decisions/rescore.jsonl"
MAX_PER_RUN, MODEL_TRIES, GRACE_H = 20, 3, 72
PROMPT = ("You are an independent grader. You did not make this decision and you do not benefit from either answer. Decide from the EVIDENCE alone whether the "
          "prediction held. An opened but unmerged pull request, a plan or a promise is not a result. If the evidence does not settle it, answer null.\n"
          'Reply with ONLY JSON: {"hit": true|false|null, "reason": "one sentence citing the evidence"}\n\n')


def _rows(root: Path) -> list[dict]:
    return decisions._lines(root / LEDGER)


def latest(root) -> dict:
    """Newest held-out row per decision id."""
    out = {}
    for r in _rows(Path(root)):
        out[r["id"]] = r
    return out


def evidence(root, cfg: dict, row: dict) -> dict:
    """The raw records the outcome rests on, gathered without calling the scorer."""
    root, k, ev = Path(root), decisions.point(cfg, row["point"])["measure"]["kind"], {}
    if k == "item_closed":
        f = root / "docs/issues" / f"{row['ref']}.json"
        if f.is_file():
            ev["item"] = json.loads(f.read_text(encoding="utf-8")).get("body", "")[:1500]
        ev["executor_rows"] = [{x: r.get(x) for x in ("at", "result", "pr", "detail")} for r in queue.executor_rows(root) if str(r.get("issue")) == str(row["ref"])][-5:]
    elif k == "free_tier_not_shed":
        f = root / "ops/free-tier.json"
        ev["free_tier"] = json.loads(f.read_text(encoding="utf-8")) if f.is_file() else None
    elif k == "jsonl_latest":
        m = decisions.point(cfg, row["point"])["measure"]
        ev["rows"] = [r for r in decisions._lines(root / m["path"]) if r.get(m["match"]) == row["ref"]][-5:]
    elif k == "improvement_kept":
        ev["verdicts"] = [r for r in decisions._lines(root / "ops/improvements.jsonl") if r.get("ev") == "verdict" and r.get("loop") == row["ref"]][-5:]
    return ev


def strict(root, cfg: dict, row: dict):
    """The strict re-derivation: (measured, why) or (None, why) when the evidence cannot settle it. Shares no code path with decisions.measure."""
    root, p = Path(root), decisions.point(cfg, row["point"])
    k, ev = p["measure"]["kind"], evidence(root, cfg, row)
    if k == "item_closed":
        body = ev.get("item")
        if body is None:
            return None, "no item record"
        if not re.search(r"\*\*Status:\*\*\s*(closed|done)", body):
            return 0.0, "item record is not closed"
        m = re.search(r"\*\*Done check:\*\*\s*([^\n]+)", body)
        if not m:
            return None, "closed item has no done check to re-run"
        ok, detail = queue.probe(root, m.group(1).strip())
        return (1.0 if ok else 0.0), f"done check {'passes' if ok else 'fails'} now: {detail[:80]}"
    if k == "free_tier_not_shed":
        ft = ev.get("free_tier")
        return (None, "no free-tier reading") if not isinstance(ft, dict) or "level" not in ft else ((0.0 if ft["level"] == "shed" else 1.0), f"level {ft['level']}")
    if k == "jsonl_latest":
        f = p["measure"]["field"]
        vals = [float(r[f]) for r in ev.get("rows", []) if isinstance(r.get(f), (int, float))]
        return (vals[-1], "newest reading") if vals else (None, "no reading")
    if k == "improvement_kept":
        vs = [r for r in ev.get("verdicts", []) if r.get("at", "") >= row["at"]]
        return ((1.0 if vs[0].get("kept") else 0.0), "first verdict after the decision") if vs else (None, "no verdict after the decision")
    return None, f"unknown measure kind {k}"


def model_grade(root, cfg: dict, row: dict, env=None, transport=None):
    """(hit|None, adapter id|None, note). The grader is the first reachable reviewer; none reachable is a recorded fact, not a verdict."""
    from . import agents
    p = decisions.point(cfg, row["point"])
    prompt = (PROMPT + f"DECISION: {json.dumps({k: row[k] for k in ('point', 'chosen', 'ref', 'at', 'predicted', 'window_h')})}\n"
              f"METRIC: {p['metric']}: {p['metric_says']}\nTHE PREDICTION HOLDS WHEN: measured {row['op']} {row['target']}\n"
              f"EVIDENCE: {json.dumps(evidence(root, cfg, row), default=str)[:5000]}\n")
    errs = []
    for a in agents.ensemble("", env, root):
        try:
            text = agents.invoke(a, prompt, env, transport) if transport else agents.invoke(a, prompt, env)
            s, e = text.find("{"), text.rfind("}")
            j = json.loads(text[s:e + 1])
            if j.get("hit") not in (True, False, None):
                raise ValueError("hit is not true, false or null")
            return j["hit"], a["id"], str(j.get("reason", ""))[:200]
        except Exception as ex:  # recorded in the row; the next reviewer is tried
            errs.append(f"{a['id']}: {type(ex).__name__}: {str(ex)[:80]}")
    return None, None, " | ".join(errs) or "no reviewer model is reachable on this host"


def _item(root: Path, r: dict) -> str:
    iid = "Q-RESCORE-" + r["id"]
    f = root / "docs/issues" / f"{iid}.json"
    if not f.exists():
        body = (f"**Owner:** reviewer\n**Trigger:** every executor run\n**Done check:** cmd:python3 -m foundation rescore --probe {r['id']}\n**Status:** open\n\n"
                f"Held-out grading disagrees with the system's own score for decision {r['id']} (point `{r['point']}`): self {r['self_hit']}, strict rule {r['strict_hit']} "
                f"({r['strict_why']}), second model {r['model_hit']} ({r.get('model') or 'unavailable'}). Correct the scorer or the evidence; the done check re-grades it. Source: foundation/rescore.py (RESCORE-1).")
        f.write_text(json.dumps({"id": iid, "title": f"{iid}: held-out grader disagrees with the self-score", "body": body, "labels": ["role:reviewer", "rescore"],
                                 "milestone": "Now", "workstream": "Scoring"}, indent=2) + "\n", encoding="utf-8")
    return iid


def grade(root, cfg: dict, row: dict, out: dict, prev: dict | None, env=None, transport=None, now=None) -> dict:
    sv, why = strict(root, cfg, row)
    s_hit = None if sv is None else decisions.holds(row["op"], sv, row["target"])
    tries = (prev or {}).get("model_tries", 0)
    m_hit, model, note = (prev.get("model_hit"), prev.get("model"), prev.get("model_note", "")) if prev and prev.get("model") else model_grade(root, cfg, row, env, transport)
    verdicts = [v for v in (s_hit, m_hit) if v is not None]
    return {"id": row["id"], "point": row["point"], "at": decisions._iso(decisions._now(now)), "self_hit": out["hit"], "strict_hit": s_hit, "strict_why": why,
            "model_hit": m_hit, "model": model, "model_note": note, "model_tries": tries + (0 if prev and prev.get("model") else 1),
            "graded": bool(verdicts), "agree": all(v == out["hit"] for v in verdicts) if verdicts else None}


def pending(root, cfg: dict) -> list[tuple[dict, dict, dict | None]]:
    """Settled decisions still owed a held-out verdict: none yet, or a model verdict still missing with tries left."""
    root, seen = Path(root), latest(root)
    led = {r["id"]: r for r in decisions._lines(root / cfg["ledger"])}
    todo = []
    for o in decisions._lines(root / cfg["outcomes"]):
        prev = seen.get(o["id"])
        if o["id"] in led and (prev is None or (not prev.get("model") and prev.get("model_tries", 0) < MODEL_TRIES)):
            todo.append((led[o["id"]], o, prev))
    return todo


def run(root=REPO, apply=False, env=None, transport=None, now=None) -> dict:
    root, cfg = Path(root), decisions.load(root)
    rows, filed = [], []
    for row, out, prev in pending(root, cfg)[:MAX_PER_RUN]:
        r = grade(root, cfg, row, out, prev, env, transport, now)
        rows.append(r)
        if apply:
            decisions._append(root / LEDGER, r)
            if r["agree"] is False:
                filed.append(_item(root, r))
    return {"graded": len(rows), "disagree": [r["id"] for r in rows if r["agree"] is False], "model_unavailable": sum(1 for r in rows if not r["model"]), "filed": filed, "applied": apply}


def status(root=REPO) -> dict:
    root, cfg = Path(root), decisions.load(root)
    rows, settled = list(latest(root).values()), len(decisions._lines(root / cfg["outcomes"]))
    graded = [r for r in rows if r["graded"]]
    by = lambda k: {"verdicts": sum(1 for r in rows if r[k] is not None), "agree": sum(1 for r in rows if r[k] is not None and r[k] == r["self_hit"])}
    return {"settled": settled, "rescored": len(graded), "agreement": round(sum(1 for r in graded if r["agree"]) / len(graded), 3) if graded else None,
            "strict_rule": by("strict_hit"), "second_model": by("model_hit"), "disagreements": sorted(r["id"] for r in graded if r["agree"] is False)}


def check(root=REPO, now=None) -> list[str]:
    root, cfg, t, bad = Path(root), decisions.load(root), decisions._now(now), []
    seen = latest(root)
    for o in decisions._lines(root / cfg["outcomes"]):
        if o["id"] not in seen and t > decisions._parse(o["at"]) + dt.timedelta(hours=GRACE_H):
            bad.append(f"decision {o['id']} was settled {o['at']} and has no held-out verdict (run rescore --run --apply)")
    return bad


def probe(root, did: str) -> tuple[bool, str]:
    """Re-grade one decision against the current score and evidence (strict rule only: deterministic, no network)."""
    root, cfg = Path(root), decisions.load(root)
    row = next((r for r in decisions._lines(root / cfg["ledger"]) if r["id"] == did), None)
    out = [o for o in decisions._lines(root / cfg["outcomes"]) if o["id"] == did]
    if not row or not out:
        return False, "decision or outcome not found"
    sv, why = strict(root, cfg, row)
    if sv is None:
        return False, "strict rule cannot settle it: " + why
    hit = decisions.holds(row["op"], sv, row["target"])
    return hit == out[-1]["hit"], f"self {out[-1]['hit']}, strict {hit} ({why})"


def main(argv) -> int:
    a = argv[0] if argv else "--check"
    if a == "--run":
        print(json.dumps(run(apply="--apply" in argv), indent=1)); return 0
    if a == "--status":
        print(json.dumps(status(), indent=1)); return 0
    if a == "--probe":
        ok, detail = probe(REPO, argv[1])
        print(("ok: " if ok else "disagrees: ") + detail); return 0 if ok else 1
    bad = check()
    print("\n".join("rescore: " + b for b in bad) or "rescore ok"); return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

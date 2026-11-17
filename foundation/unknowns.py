"""UNKNOWNS-1: what the system does not know is a core feedback loop. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation unknowns --check                       doctrine and ledger are well formed (CI)
  python3 -m foundation unknowns --run [--apply] [--today D]   inventory loops and needs, invert, score; --apply files Q-UNK-* plus items and ledgers them
  python3 -m foundation unknowns --answer ID --verdict V --text T   close a question with evidence (V: none, gap, new-objective, cannot-know)
  python3 -m foundation unknowns --status [--json]             coverage, surprise rate and open questions (read by the dashboard and the site build)

Improving only what is known shrinks the solution space, so the system also audits its own ignorance: Rumsfeld regions, assumption audit,
pre-mortem inversion, red team and the Universal Ignorance Audit's scaffold / map-territory / protected categories, one question per
(loop, lens). Every step is a row in the append-only ledger (the provenance record: assumption, action, evidence, outcome, blast radius,
rollback, capability gain, surfaces tested). A gap or new objective becomes a probationary objective candidate and seeds the next pass.
"""
from __future__ import annotations
import argparse, datetime as dt, hashlib, json, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DOC = "doctrine/unknowns.json"
REG = "instances/ultrastable/loop-registry.json"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / DOC).read_text(encoding="utf-8"))


def ledger(root, d=None) -> list[dict]:
    p = Path(root) / (d or load(root))["ledger"]
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()] if p.is_file() else []


def inventory(root=REPO) -> list[dict]:
    """Every unit whose assumptions can be questioned: loops from the registry and blind-spot needs."""
    root, out = Path(root), []
    for l in json.loads((root / REG).read_text(encoding="utf-8"))["loops"]:
        out.append({"id": l["id"], "kind": l.get("kind", "default"), "done": l.get("done", ""), "probe": l.get("closing_probe", ""),
                    "trigger": l.get("trigger", ""), "paths": len(l.get("paths", []))})
    bp = root / "doctrine/blindspots.json"
    if bp.is_file():
        for n in json.loads(bp.read_text(encoding="utf-8"))["needs"]:
            out.append({"id": f"need:{n['id']}", "kind": "default", "done": n.get("action", ""), "probe": n["probe"], "trigger": "blindspots scan", "paths": 1})
    return out


def _tie(s: str, week: int) -> float:
    return int(hashlib.sha256(f"{s}|{week}".encode()).hexdigest()[:6], 16) / 0xFFFFFF


def candidates(root=REPO, today=None) -> list[dict]:
    d, today = load(root), today or dt.date.today()
    led = ledger(root, d)
    asked = [r for r in led if r["kind"] == "asked"]
    out = []
    for u in inventory(root):
        for lens in d["lenses"]:
            key = f"{u['id']}|{lens['id']}"
            mine = [r for r in asked if r["key"] == key]
            if mine and (today - dt.date.fromisoformat(mine[-1]["at"])).days < d["cadence_days"]:
                continue
            prior = sum(1 for r in led if r["kind"] == "answered" and r["key"].startswith(u["id"] + "|") and r["verdict"] != "none")
            impact = d["kind_impact"].get(u["kind"], d["kind_impact"]["default"])
            uncertainty = 1.0 if u["paths"] < 2 else 0.8
            novelty = 1 / (1 + len(mine) + sum(1 for r in asked if r["key"].startswith(u["id"] + "|")) * 0.5)
            # a loop that already produced a gap is likelier to hold another
            score = round(impact * uncertainty * novelty * (1 + 0.25 * prior), 4)
            out.append({"key": key, "unit": u["id"], "lens": lens["id"], "method": lens["method"], "region": lens["region"],
                        "question": lens["q"].format(**{k: (u[k] or "(none recorded)") for k in ("id", "done", "probe", "trigger")}),
                        "score": score, "_tie": _tie(key, today.isocalendar()[1])})
    return sorted(out, key=lambda c: (-c["score"], -c["_tie"]))


def _row(kind, **kw):
    return {"at": dt.date.today().isoformat(), "kind": kind, "blast_radius": "one backlog item and its ledger row",
            "rollback": "delete the Q-UNK item; ledger rows are append-only and superseded by a later row",
            "surfaces_tested": ["loop-registry", "doctrine/blindspots.json"], **kw}


def run(root=REPO, apply=False, today=None) -> list[dict]:
    d, root = load(root), Path(root)
    open_keys = {r["key"] for r in ledger(root, d) if r["kind"] == "asked"} - {r["key"] for r in ledger(root, d) if r["kind"] == "answered"}
    picks = [c for c in candidates(root, today) if c["key"] not in open_keys][: d["max_new_per_run"]]
    if apply:
        led = root / d["ledger"]
        with led.open("a", encoding="utf-8") as f:
            for c in picks:
                iid = "Q-UNK-" + c["key"].replace("|", "-").replace(":", "-")
                item = {"id": iid, "title": f"{iid}: question the unknown ({c['lens']}) in {c['unit']}",
                        "body": f"**Owner:** product-manager\n**Trigger:** unknowns run, score {c['score']}\n**Done check:** grep:ops/unknowns/ledger.jsonl::\"key\": \"{c['key']}\", \"kind\": \"answered\"\n**Prediction:** unknown_questions_answered_7d >= 1 within 168 h\n**Status:** open\n\nMethod: {c['method']} ({c['region']}). Funded from the plus budget (plus_share_for_unknowns).\n\n{c['question']}\n\nAnswer with evidence: `python3 -m foundation unknowns --answer {c['key']} --verdict none|gap|new-objective|cannot-know --text <findings and evidence>`. 'We do not know' is a valid answer (cannot-know).",
                        "labels": ["role:product-manager", "plus", "unknowns"], "milestone": "Next", "workstream": "Growth"}
                (root / "docs/issues" / f"{iid}.json").write_text(json.dumps(item, indent=2) + "\n", encoding="utf-8")
                f.write(json.dumps(_row("asked", key=c["key"], assumption=f"{c['unit']} is sound under lens {c['lens']}", action=f"filed {iid}",
                                        evidence=f"score {c['score']}", outcome="open", capability_gain=c["score"]), sort_keys=True) + "\n")
        status_file(root)
    return picks


def answer(root, key, verdict, text):
    d, root = load(root), Path(root)
    if verdict not in d["verdicts"]:
        raise SystemExit(f"verdict must be one of {d['verdicts']}")
    if len(text) < d["min_answer_chars"]:
        raise SystemExit(f"an answer states findings and evidence (at least {d['min_answer_chars']} characters)")
    led = ledger(root, d)
    if key not in {r["key"] for r in led if r["kind"] == "asked"}:
        raise SystemExit(f"{key} was never asked")
    with (root / d["ledger"]).open("a", encoding="utf-8") as f:
        f.write(json.dumps(_row("answered", key=key, verdict=verdict, assumption="answer recorded", action=f"verdict {verdict}",
                                evidence=text, outcome="closed", capability_gain=0 if verdict == "none" else 1), sort_keys=True) + "\n")
    if verdict in ("gap", "new-objective"):  # UIA rule 6: the answer seeds the next pass
        cp = root / d["candidates"]
        cur = json.loads(cp.read_text(encoding="utf-8"))
        cur["candidates"].append({"from": key, "kind": verdict, "text": text, "status": "probationary", "at": dt.date.today().isoformat()})
        cp.write_text(json.dumps(cur, indent=1) + "\n", encoding="utf-8")
    status_file(root)


def status(root=REPO) -> dict:
    d, root = load(root), Path(root)
    led = ledger(root, d)
    asked = {r["key"] for r in led if r["kind"] == "asked"}
    ans = [r for r in led if r["kind"] == "answered"]
    units = {u["id"] for u in inventory(root)}
    covered = {k.split("|")[0] for k in asked}
    surprise = [r for r in ans if r["verdict"] in ("gap", "new-objective")]
    cands = json.loads((root / d["candidates"]).read_text(encoding="utf-8"))["candidates"]
    return {"units": len(units), "units_questioned": len(covered & units), "coverage": round(len(covered & units) / max(1, len(units)), 3),
            "asked": len(asked), "answered": len(ans), "open": len(asked) - len({r["key"] for r in ans}),
            "surprise_rate": round(len(surprise) / max(1, len(ans)), 3), "objective_candidates": len(cands),
            "cannot_know": sum(1 for r in ans if r["verdict"] == "cannot-know")}


def status_file(root):
    d = load(root)
    (Path(root) / d["summary"]).write_text(json.dumps(status(root), indent=1, sort_keys=True) + "\n", encoding="utf-8")


def check(root=REPO) -> list[str]:
    d, errs = load(root), []
    ids = [l["id"] for l in d["lenses"]]
    if len(set(ids)) != len(ids):
        errs.append("duplicate lens ids")
    for l in d["lenses"]:
        if l["region"] not in d["regions"]:
            errs.append(f"lens {l['id']}: unknown region")
        try:
            l["q"].format(id="x", done="x", probe="x", trigger="x")
        except (KeyError, IndexError) as e:
            errs.append(f"lens {l['id']}: bad template {e}")
    if not candidates(root):
        errs.append("no questions can be generated: inventory empty or every lens fresh")
    seen = set()
    for r in ledger(root, d):
        if r["kind"] not in ("asked", "answered"):
            errs.append(f"ledger row with kind {r['kind']}")
        if r["kind"] == "answered" and r["key"] not in seen:
            errs.append(f"answered without asked: {r['key']}")
        seen.add(r["key"])
    return errs


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="unknowns")
    for f in ("--check", "--run", "--apply", "--status", "--json"):
        ap.add_argument(f, action="store_true")
    ap.add_argument("--answer"); ap.add_argument("--verdict"); ap.add_argument("--text", default="")
    ap.add_argument("--today"); ap.add_argument("--root", default=str(REPO))
    a = ap.parse_args(argv)
    if a.answer:
        answer(a.root, a.answer, a.verdict or "", a.text); return 0
    if a.run:
        for c in run(a.root, a.apply, dt.date.fromisoformat(a.today) if a.today else None):
            print(f"{c['score']:<7} {c['lens']:<11} {c['unit']}: {c['question'][:110]}")
        return 0
    if a.status:
        s = status(a.root); print(json.dumps(s, indent=1) if a.json else " ".join(f"{k}={v}" for k, v in s.items())); return 0
    errs = check(a.root)
    for e in errs:
        print("unknowns:", e, file=sys.stderr)
    print("unknowns ok" if not errs else f"unknowns: {len(errs)} problem(s)")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())

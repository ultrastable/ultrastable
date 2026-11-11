"""Guided flow: turn a person's wishes into comms/brief.json without asking them to read or write code."""
import json
from pathlib import Path

FLOW = json.loads((Path(__file__).parent / "flow.json").read_text())


def build_brief(answers):
    """answers: {question_id: choice | [choices] | text}. Unknown or missing answers are reported, never guessed."""
    qs = {q["id"]: q for q in FLOW["questions"]}
    gaps, brief = [], {}
    for qid, q in qs.items():
        a = answers.get(qid)
        if a in (None, "", []):
            if not q.get("free"): gaps.append(qid)
            continue
        vals = a if isinstance(a, list) else [a]
        if "choices" in q:
            bad = [v for v in vals if v not in q["choices"]]
            if bad: gaps.append(f"{qid}: not a choice: {bad}")
        brief[qid] = a
    chans = brief.get("channels", [])
    chans = chans if isinstance(chans, list) else [chans]
    plugins = sorted({p for c in chans for p in FLOW["channel_plugins"].get(c, [])})
    stmt = brief.pop("statement", None)
    return {"gaps": gaps, "brief": dict(brief, plugins_to_enable=plugins,
            posts_per_week=FLOW["cadence_per_week"].get(brief.get("cadence"), 1),
            statements=[{"text": stmt, "approved": True, "by": "owner, in the guided flow"}] if stmt else [],
            note="Plugins stay dry-run until a reviewed PR sets mode=live and the platform holds the credentials.")}


def ask(input_fn=input, print_fn=print):
    answers = {}
    for q in FLOW["questions"]:
        print_fn(q["ask"])
        if "choices" in q:
            for i, c in enumerate(q["choices"], 1): print_fn(f"  {i}. {c}")
            raw = input_fn("number(s), comma separated: ").strip()
            picked = [q["choices"][int(x) - 1] for x in raw.split(",") if x.strip().isdigit() and 0 < int(x) <= len(q["choices"])]
            answers[q["id"]] = picked if q.get("multi") else (picked[0] if picked else None)
        else:
            answers[q["id"]] = input_fn("> ").strip()
    return answers


def write(root, answers):
    r = build_brief(answers)
    if r["gaps"]: return r
    p = Path(root) / "comms"; p.mkdir(exist_ok=True)
    (p / "brief.json").write_text(json.dumps(r["brief"], indent=1) + "\n")
    return r

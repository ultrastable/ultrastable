#!/usr/bin/env python3
"""Guided interview: a person says what they want; this turns it into IDEA.md and
architectural specification drafts. No code knowledge needed.

Design (see SCOPE.md): the person only has to recognize an answer, never invent one.
Every question carries recall prompts and clickable choices. Gaps (things the person did
not know to say) are surfaced as follow-ups by lifecycle phase. Stdlib only, deterministic.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
QUESTIONS = json.loads((Path(__file__).resolve().parent / "questions.json").read_text())


def questions() -> list[dict]:
    return QUESTIONS["questions"]


def answered(answers: dict, q: dict) -> bool:
    v = answers.get(q["id"])
    return bool(v) if not isinstance(v, (int, float)) else True


def next_question(answers: dict):
    """First unanswered question in lifecycle order; None when the interview is complete."""
    for q in questions():
        if not answered(answers, q):
            return q
    return None


def validate_answer(q: dict, value):
    if q["kind"] == "text":
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"{q['id']}: text answer required")
        return value.strip()
    ids = {c["id"] for c in q["choices"]}
    vals = value if isinstance(value, list) else [value]
    if not vals or any(v not in ids for v in vals):
        raise ValueError(f"{q['id']}: choose from {sorted(ids)}")
    if q["kind"] == "choice":
        if len(vals) != 1:
            raise ValueError(f"{q['id']}: choose exactly one")
        return vals[0]
    return list(dict.fromkeys(vals))


def apply_answer(answers: dict, qid: str, value) -> dict:
    q = next((x for x in questions() if x["id"] == qid), None)
    if q is None:
        raise ValueError(f"unknown question {qid}")
    out = dict(answers)
    out[qid] = validate_answer(q, value)
    return out


def progress(answers: dict) -> dict:
    """Weighted completeness per lifecycle phase, 0..1."""
    res = {}
    for ph in QUESTIONS["phases"]:
        qs = [q for q in questions() if q["phase"] == ph]
        total = sum(q["weight"] for q in qs)
        have = sum(q["weight"] for q in qs if answered(answers, q))
        res[ph] = round(have / total, 2) if total else 1.0
    return res


def _choice(q: dict, cid: str) -> dict:
    return next(c for c in q["choices"] if c["id"] == cid)


def selected(answers: dict, qid: str) -> list[dict]:
    q = next(x for x in questions() if x["id"] == qid)
    v = answers.get(qid)
    if v is None:
        return []
    return [_choice(q, c) for c in (v if isinstance(v, list) else [v])]


def components(answers: dict) -> list[str]:
    out: list[str] = []
    for c in selected(answers, "kind"):
        out += c.get("adds", [])
    return list(dict.fromkeys(out))


def risks(answers: dict) -> list[str]:
    out = [c["risk"] for c in selected(answers, "data_held") if c.get("risk")]
    if answers.get("risks"):
        out.append(f"Owner concern: {answers['risks']}")
    return out


def gaps(answers: dict) -> list[str]:
    """Unknown unknowns: things people usually forget, surfaced from the answers."""
    g = []
    if "payments" in answers.get("data_held", []):
        g.append("Payments: which provider, refunds, tax. The managers will draft a payments spec and a gate card for the account only you can open.")
    if "people" in answers.get("data_held", []) or "logins" in answers.get("data_held", []):
        g.append("Privacy: what you promise people about their data, and how they ask for deletion.")
    if answers.get("audience") == "customers":
        g.append("Support: who answers when a customer writes in, and how fast.")
    if answers.get("audience") == "unsure":
        g.append("Audience: the first outcome will be to find one real first user and interview them.")
    if "regulators" in answers.get("stakeholders", []):
        g.append("Rules: which regulations apply. The managers list them and mark each item that needs a professional.")
    g.append("Backups and ownership: where the data lives and how you get it out.")
    return g


def render_idea(answers: dict, org_name: str = "My Project", owner: str = "Owner") -> str:
    from_slug = "".join(ch if ch.isalnum() else "-" for ch in org_name.lower()).strip("-") or "org"
    budget = next((c.get("value", 0) for c in selected(answers, "budget")), 0)
    must = ", ".join(c["label"].lower() for c in selected(answers, "must_not")) or "nothing extra"
    lines = [
        "---", f"org_name: {org_name}", f"slug: {from_slug}", f"owner: {owner}",
        "owner_contact: set-in-secret-store", "owner_contact_backup: set-in-secret-store", "---", "",
        "# Idea", "", answers.get("idea", ""), "",
        # The person answered plain questions, not a system test: the four answers every system starts with come from what the kernel does for it
        # (same defaults as bootstrap/intake.py); the measure is the person's own success test when they gave one. Without this section the
        # bootstrapper's `qualify` stage turned every interviewed idea away as "not a fit".
        "# System test", "",
        "- Loop: its own clock measures the system, files what is wrong or missing and ships the fix, with no person in the middle",
        f"- Measure: {answers.get('success') or 'open work items past their deadline, target 0'}",
        "- Upkeep: new evidence, sources and requests from its owner keep arriving",
        f"- Run cost: {budget} USD a month for the back end", "",
        "# Who it is for", "", f"- {_choice(next(x for x in questions() if x['id']=='audience'), answers['audience'])['label']}" if answers.get("audience") else "- unknown",
        "", "# First outcomes", "",
        f"- Working first version that meets: {answers.get('success', 'a success test the managers will propose')}",
        "- Architectural specification set reviewed by the owner",
        "", "# Constraints", "", f"- Budget per month: {budget} USD",
        f"- Needs the owner's say-so first: {must}", "- Nothing public until the owner says so", ""]
    return "\n".join(lines)


def render_specs(answers: dict) -> dict[str, str]:
    """Drafts of the management and architecture artifacts, one per lifecycle phase."""
    comps = components(answers)
    rk = risks(answers) or ["None stated yet; the risk manager will probe."]
    method = answers.get("method", "hybrid")
    return {
        "charter.md": "\n".join([
            "# Project charter (initiating)", "", "## Purpose", answers.get("idea", ""), "",
            "## Success measure", answers.get("success", ""), "",
            "## Stakeholders", *[f"- {c['label']}" for c in selected(answers, "stakeholders")], "",
            "## Authority limits (never without the owner)", *[f"- {c['label']}" for c in selected(answers, "must_not")], ""]),
        "architecture-spec.md": "\n".join([
            "# Architectural specification (planning)", "",
            "Status: DRAFT generated from the interview; the architect role refines it.", "",
            "## Components", *[f"- `{c}`" for c in comps], "",
            "## Runtime", "Cloudflare Worker with D1 and a 10-minute tick (first adapter). Portable core: see docs/architecture.", "",
            "## Data held", *[f"- {c['label']}" for c in selected(answers, "data_held")], ""]),
        "plan.md": "\n".join([
            "# Plan (planning)", "", f"Method: {method}", f"First working version: {answers.get('deadline', 'no date')}",
            f"Monthly budget: {next((c.get('value',0) for c in selected(answers,'budget')), 0)} USD", ""]),
        "risk-register.md": "\n".join(["# Risk register (executing)", "", *[f"- {r}" for r in rk], "",
            "## Gaps the owner did not know to mention", *[f"- {x}" for x in gaps(answers)], ""]),
        "review-and-closing.md": "\n".join([
            "# Review and closing", "", f"Report rhythm: {answers.get('review_rhythm', 'weekly')} (four lines).", "",
            "## Definition of finished and after-care", answers.get("done", ""), ""]),
    }


def write_outputs(answers: dict, out: Path, org_name: str, owner: str) -> list[str]:
    out.mkdir(parents=True, exist_ok=True)
    (out / "IDEA.md").write_text(render_idea(answers, org_name, owner))
    specs = out / "specs"
    specs.mkdir(exist_ok=True)
    written = ["IDEA.md"]
    for name, body in render_specs(answers).items():
        (specs / name).write_text(body)
        written.append(f"specs/{name}")
    return written


def run_interactive(answers: dict, inp=input, out=print) -> dict:
    while (q := next_question(answers)) is not None:
        out(f"\n[{q['phase']}] {q['ask']}")
        for r in q["recall"]:
            out(f"  hint: {r}")
        if q["kind"] == "text":
            val = inp("> ")
        else:
            for i, c in enumerate(q["choices"], 1):
                out(f"  {i}. {c['label']}")
            raw = inp("number(s), comma separated > ")
            try:
                idx = [int(x) for x in raw.split(",") if x.strip()]
                val = [q["choices"][i - 1]["id"] for i in idx]
                val = val[0] if q["kind"] == "choice" and val else val
            except (ValueError, IndexError):
                out("  not a valid choice, asking again")
                continue
        try:
            answers = apply_answer(answers, q["id"], val)
        except ValueError as e:
            out(f"  {e}")
    return answers


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--answers", help="JSON file of answers (resumed and saved)")
    ap.add_argument("--out", default=str(ROOT))
    ap.add_argument("--org-name", default="My Project")
    ap.add_argument("--owner", default="Owner")
    a = ap.parse_args(argv)
    path = Path(a.answers) if a.answers else None
    answers = json.loads(path.read_text()) if path and path.exists() else {}
    answers = run_interactive(answers)
    if path:
        path.write_text(json.dumps(answers, indent=2))
    for f in write_outputs(answers, Path(a.out), a.org_name, a.owner):
        print("wrote", f)
    return 0


if __name__ == "__main__":
    sys.exit(main())

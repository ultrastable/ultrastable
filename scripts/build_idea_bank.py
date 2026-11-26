#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""IDEA-BANK-1: prove every front-door idea boots through the seed, then generate site/idea-bank-data.js.

  python3 scripts/build_idea_bank.py           regenerate site/idea-bank-data.js
  python3 scripts/build_idea_bank.py --check   fail when an idea does not boot, the bank is not diverse, or the file is stale
  python3 scripts/build_idea_bank.py --live    WORLDWIDE-1: fetch every data probe; retire an idea whose sources all stopped answering
  python3 scripts/build_idea_bank.py --grow    GROW-1: ask the model route for one new idea, admit it only through every gate

Each idea in doctrine/idea-bank.json is written as an IDEA.md and run through the seed bootstrap's own stages
(read, qualify, instrument) with the seed's real ultrastable.json and autonomy policy. An idea that the seed would refuse
or could not instrument never reaches the front door.
"""
import json
import sys
import tempfile
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / "seed"
BANK = ROOT / "doctrine" / "idea-bank.json"
OUT = ROOT / "site" / "idea-bank-data.js"
sys.path.insert(0, str(SEED / "bootstrap"))
import bootstrap  # noqa: E402


sys.path.insert(0, str(ROOT))
from foundation import ideas as _ideas  # noqa: E402  DEPTH-1: one depth rule for the front door and for self-chosen apps
_CFG = _ideas.load()
DEPTH = lambda a: _ideas.depth(_CFG, a)


def as_app(i):
    """Map a front-door idea onto the fields foundation/ideas.py depth() reads."""
    d = i.get("depth") or {}
    return {"name": i.get("text"), "tagline": i.get("text"), "thesis": i.get("thesis"), "corpus": d.get("corpus"),
            "loop": i.get("loop") or d.get("method"), "returns": d.get("returns"), "hook": i.get("hook"),
            "public_good": i.get("empowers"), "horizon": i.get("horizon"), "change": i.get("change")}  # CHANGE-1


def idea_md(i):
    return (f"---\norg_name: {i['id']}\nslug: {i['id']}\nowner: Example\n---\n\n# Idea\n\n{i['text']}.\n\n# System test\n\n"
            f"- Loop: {i['loop']}\n- Measure: {i['measure']}\n- Upkeep: {i['upkeep']}\n- Run cost: {i['budget']} USD a month for the back end\n\n"
            f"# First outcomes\n\n- {i['measure'][0].upper() + i['measure'][1:]}\n\n# Constraints\n\n- Budget per month: {i['budget']} USD\n")


def boot(i):
    """Run read, qualify and instrument; return (ok, detail)."""
    with tempfile.TemporaryDirectory() as d:
        root, out = Path(d) / "repo", Path(d) / "out"
        root.mkdir(); out.mkdir()
        (root / "ultrastable.json").symlink_to(SEED / "ultrastable.json")
        (root / "autonomy").symlink_to(SEED / "autonomy")
        (root / "IDEA.md").write_text(idea_md(i))
        b = bootstrap.Boot(root, out, apply=False)
        for name in ("read", "qualify", "instrument"):
            if b.guard(name, getattr(b, name)) == "blocked":
                return False, f"{name}: {b.log[-1]['detail']}"
            if name == "qualify" and not b.fit:
                return False, "qualify: " + b.log[-1]["detail"]
        return True, "; ".join(f"{e['stage']} {e['status']}" for e in b.log)


def validate(bank):
    errs, ideas = [], bank["ideas"]
    for i in ideas:
        for k in ("id", "domain", "reach", "text", "keywords", "loop", "measure", "upkeep", "budget"):
            if not i.get(k):
                errs.append(f"{i.get('id')}: missing {k}")
        d = DEPTH(as_app(i))
        if not d["ok"]:
            errs.append(f"{i.get('id')}: fails DEPTH-1 (foundation/ideas.py depth): missing {d['missing']}, commerce {d['commerce']}")
        if len(str(i.get("empowers", ""))) < 20:
            errs.append(f"{i.get('id')}: empowers missing (PUBLIC-GOOD-1: name the change it empowers)")
        if i.get("domain") in bank.get("refused_domains", []):
            errs.append(f"{i.get('id')}: domain {i['domain']} is refused (PUBLIC-GOOD-1: not e-commerce)")
        data = i.get("data") or []
        if not data or not all(d.get("name") and (d.get("probe", "").startswith("https://") or (d["name"] == "own" and d.get("note"))) for d in data):
            errs.append(f"{i.get('id')}: data missing (WORLDWIDE-1: name the worldwide open source with an https probe, or own records)")
        if len(i.get("text", "")) > bank.get("max_text", 120):
            errs.append(f"{i['id']}: text over {bank.get('max_text', 120)} characters")
        narrow = [n for n in bank.get("narrow_phrases", []) if n in i.get("text", "").lower()]
        if narrow:  # BREADTH-1: the owner widens single-field ideas, so the bank refuses them
            errs.append(f"{i['id']}: too narrow ({narrow[0]!r}); BREADTH-1 wants many fields or places, not one")
    dom = Counter(i["domain"] for i in ideas)
    if len(dom) < bank["min_domains"]:
        errs.append(f"only {len(dom)} domains, need {bank['min_domains']}")
    errs += [f"domain {d} has {n} ideas, max {bank['max_per_domain']}" for d, n in dom.items() if n > bank["max_per_domain"]]
    if len({i["id"] for i in ideas}) != len(ideas):
        errs.append("duplicate ids")
    for i in ideas:
        ok, detail = boot(i)
        if not ok:
            errs.append(f"{i['id']} does not boot: {detail}")
    return errs


def probe(url, timeout=15):
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": "ultrastable-idea-bank/1"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return 200 <= r.status < 400
    except Exception as e:  # recorded by the caller as a dead source
        print(f"probe failed {url}: {type(e).__name__}: {e}")
        return False


def live(bank):
    """WORLDWIDE-1: an idea with probed sources keeps its place only while at least one still answers."""
    keep, changed = [], False
    for i in bank["ideas"]:
        urls = [d["probe"] for d in i.get("data", []) if d.get("probe")]
        if urls and not any(probe(u) for u in urls):
            bank["retired"].append({"id": i["id"], "why": "no data source answered", "idea": i}); changed = True
            print(f"retired {i['id']}: no data source answered")
        else:
            keep.append(i)
    bank["ideas"] = keep
    return changed


GROW_PROMPT = """You propose ONE new idea for the Ultrastable front door. Ultrastable runs ongoing autonomous systems for public good,
at the depth of an evidence encyclopedia (Unlearn) or a practical-solutions atlas: a corpus that keeps growing, a method that makes it
trustworthy, a reason to come back. Never commerce, shops, orders, sales or cost cutting. It must work worldwide on open data that
exists today (give real https URLs of public APIs or datasets that answer without a key) or on the user's own records ("own").
It must be surprising and interesting, different from every existing idea and domain listed below.
Reply with only a JSON object with keys: id (kebab-case), domain, reach ("global"), text (under 120 characters, plain words, spanning many fields or places and never a single one),
keywords, thesis, hook, horizon (list of 3 phases), loop, measure, upkeep, budget (USD per month, number), depth {corpus, method, returns}, change (list of 3 or 4 of: why-it-feels-true, guess-first, graded-uncertainty, outside-view, fact-myth-fallacy, easy-attractive-social-timely, implementation-intention, spaced-follow-up; at least one from each of the first two, middle three and next two), empowers (every text field at least 40 characters),
data [{name, probe}] (or {name: "own", note}).
Existing ideas:
"""


def grow(bank, complete=None):
    """GROW-1: one new idea per pass, admitted only through every gate (schema, depth, public good, data, seed boot, live probes)."""
    if complete is None:
        sys.path.insert(0, str(ROOT))
        from foundation import agents
        complete = lambda p: agents.complete(p)[0]
    have = "\n".join(f"- [{i['domain']}] {i['text']}" for i in bank["ideas"] + [r["idea"] for r in bank["retired"][-20:]])
    taste = "".join(f"\nThe owner changed \"{e['before']}\" to \"{e['after']}\". {e['lesson']}" for e in bank.get("owner_edits", [])[-8:])
    prompt = GROW_PROMPT.replace("Existing ideas:", "Taste to follow (BREADTH-1):" + taste + "\nExisting ideas:") if taste else GROW_PROMPT
    cand = complete(prompt + have)
    if not isinstance(cand, dict) or any(cand.get("id") == i["id"] for i in bank["ideas"]):
        return False, "no new idea returned"
    cand["added"] = __import__("datetime").date.today().isoformat()
    trial = dict(bank, ideas=bank["ideas"] + [cand])
    errs = [e for e in validate(trial) if cand.get("id", "?") in e or "domain" in e]
    if errs:
        return False, "; ".join(errs)
    urls = [d["probe"] for d in cand.get("data", []) if d.get("probe")]
    if urls and not all(probe(u) for u in urls):
        return False, "a data source did not answer"
    bank["ideas"].append(cand)
    while len(bank["ideas"]) > bank.get("max_active", 24):
        old = min(bank["ideas"], key=lambda i: i.get("added", ""))
        bank["ideas"].remove(old); bank["retired"].append({"id": old["id"], "why": "rotated out by a newer idea", "idea": old})
    return True, cand["id"]


def render(bank):
    rows = [[i["text"], i["keywords"], i["domain"], i["reach"]] for i in bank["ideas"]]
    # One per domain, public-benefit reach first, for the no-network fallback chips.
    seen, fall = set(), []
    for i in sorted(bank["ideas"], key=lambda i: i["reach"] != "global"):
        if i["domain"] not in seen:
            seen.add(i["domain"]); fall.append(i["text"])
    return ("// GENERATED by python3 scripts/build_idea_bank.py from doctrine/idea-bank.json; do not edit.\n"
            "// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0\n"
            f"export const BANK = {json.dumps(rows, ensure_ascii=False)};\n"
            f"export const FALLBACK = {json.dumps(fall, ensure_ascii=False)};\n"
            "export default { BANK, FALLBACK };\n")


def main():
    bank = json.loads(BANK.read_text())
    if "--live" in sys.argv or "--grow" in sys.argv:
        changed = live(bank) if "--live" in sys.argv else False
        if "--grow" in sys.argv:
            try:
                ok, detail = grow(bank)
            except Exception as e:  # recorded; the bank stays as it was
                ok, detail = False, f"{type(e).__name__}: {e}"
            print(("grew: " if ok else "no growth: ") + detail)
            changed = changed or ok
        if changed:
            BANK.write_text(json.dumps(bank, indent=1, ensure_ascii=False) + "\n")
    errs = validate(bank)
    if errs:
        print("idea bank refused:\n  " + "\n  ".join(errs)); return 1
    text = render(bank)
    if "--check" in sys.argv:
        if not OUT.exists() or OUT.read_text() != text:
            print("site/idea-bank-data.js is stale: run python3 scripts/build_idea_bank.py"); return 1
        print(f"idea bank ok: {len(bank['ideas'])} ideas boot through the seed"); return 0
    OUT.write_text(text)
    print(f"wrote {OUT.relative_to(ROOT)}: {len(bank['ideas'])} ideas, all boot through the seed")
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""MARKET-1: the component gap analysis as data that code consumes (owner, 2026-11-12). Ultrastable is the foundation for any autonomous system.

  python3 -m foundation market --check    structure, sources, proofs and tests of every claimed feature, every gap has a queue item, nothing leaks to the public site
  python3 -m foundation market --sync     write the missing docs/issues/Q-GAP-<id>.json queue items for every gap (the executor works them)
  python3 -m foundation market --report   components x competitor coverage, stories delivered or partial, open gaps

Data: doctrine/market.json (internal). A claimed feature (live or testing) must have a proof probe that passes and a test file that exists. A gap's closing
probe must not pass yet; when it does, the queue closes the item and the gap counts as closed with no manual edit. Competitor claims name a source read on the
checked date; 'none-found' means the source was silent. The file is never published: the public site may not carry a competitor name from it.
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path
from . import queue

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/market.json"
STATUSES = {"live", "testing", "pinned", "gap"}
COVERS = {"full", "partial", "none-found"}
NAMES = ["Lovable", "Bolt.new", "Replit", "Base44", "Zapier", "n8n", "VibeSDK", "Factory Droid"]
GAP_ID = lambda g: "Q-GAP-" + g["id"]


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def _ok(root, spec: str) -> bool:
    return queue.probe(root, spec)[0]


def gap_state(root, d) -> dict:
    return {g["id"]: ("closed" if _ok(root, g["closing_probe"]) else "open") for g in d["gaps"]}


def check(root=REPO) -> list[str]:
    root, d, bad = Path(root), load(root), []
    if d.get("visibility") != "internal":
        bad.append("market.json must be internal")
    fs, cs, gs = {x["id"]: x for x in d["features"]}, {x["id"]: x for x in d["components"]}, {x["id"]: x for x in d["gaps"]}
    for name, s in d["sources"].items():
        if not s["url"].startswith("https://") or not s.get("what"):
            bad.append(f"source {name}: needs an https url and what")
    for f in d["features"]:
        if f["status"] not in STATUSES:
            bad.append(f"feature {f['id']}: status {f['status']!r}")
        elif f["status"] in ("live", "testing"):
            if not _ok(root, f["proof"]):
                bad.append(f"feature {f['id']}: claimed {f['status']} but proof {f['proof']} does not pass (claim without code)")
            if not f["test"] or not (root / f["test"]).is_file():
                bad.append(f"feature {f['id']}: claimed {f['status']} but test {f['test']!r} does not exist")
        elif f["status"] == "gap" and _ok(root, f["proof"]):
            bad.append(f"feature {f['id']}: marked gap but its proof now passes; mark it testing or live")
    for c in d["components"]:
        if not c["alternatives"] or not c["integration_gap"].strip():
            bad.append(f"component {c['id']}: needs researched alternatives and an integration gap")
        for a in c["alternatives"]:
            if a["source"] not in d["sources"]:
                bad.append(f"component {c['id']}: alternative {a['name']} cites an unknown source")
            if a["covers"] not in COVERS:
                bad.append(f"component {c['id']}: alternative {a['name']} covers {a['covers']!r}")
        for x in c["features"]:
            if x not in fs:
                bad.append(f"component {c['id']}: unknown feature {x}")
    used_g, used_f = set(), set()
    for u in d["users"]:
        for s in u["stories"]:
            for x in s["features"]:
                used_f.add(x)
                if x not in fs:
                    bad.append(f"story {s['id']}: unknown feature {x}")
            for x in s["gaps"]:
                used_g.add(x)
                if x not in gs:
                    bad.append(f"story {s['id']}: unknown gap {x}")
            if not s["features"] and not s["gaps"]:
                bad.append(f"story {s['id']}: maps to nothing")
    for g in d["gaps"]:
        if g["id"] not in used_g:
            bad.append(f"gap {g['id']}: no user story needs it (an orphan gap)")
        if g["component"] not in cs:
            bad.append(f"gap {g['id']}: unknown component {g['component']}")
    for f in d["features"]:
        if f["status"] != "gap" and f["id"] not in used_f and not any(f["id"] in c["features"] for c in d["components"]):
            bad.append(f"feature {f['id']}: serves no component or story")
    for o in d["objections"]:
        if not o["concede"].strip() or not o["answer"].strip():
            bad.append(f"objection {o['id']}: needs an answer and what it concedes")
        for x in o["components"]:
            if x not in cs:
                bad.append(f"objection {o['id']}: unknown component {x}")
        for x in o["evidence"]:
            if x not in fs:
                bad.append(f"objection {o['id']}: unknown evidence feature {x}")
        weak = [x for x in o["evidence"] if x in fs and fs[x]["status"] in ("pinned", "gap")]
        if weak and not re.search(r"pinned|not|no |untested|self-run", o["concede"], re.I):
            bad.append(f"objection {o['id']}: cites {weak} (not built) without conceding it")
    have = {i["id"]: i for i in queue.items(root)}
    state = gap_state(root, d)
    for g in d["gaps"]:
        it = have.get(GAP_ID(g))
        # SHELVED-NOT-DONE-1: an item DISPOSE-1 shelved still tracks its gap (its probe runs every fleet pass), so it is not a missing item.
        shelved = bool(it) and re.search(r"^\*\*Disposition:\*\*\s*shelved", it["json"].get("body", ""), re.M)
        if state[g["id"]] == "open" and (not it or (it["status"] != "open" and not shelved)):
            bad.append(f"gap {g['id']}: open with no open queue item {GAP_ID(g)} (run market --sync)")
        if it and not same_probe(it["probe"], g["closing_probe"]):
            bad.append(f"gap {g['id']}: queue probe differs from the gap's closing probe")
    for p in sorted((root / "site").glob("*.js")) + [root / "site/site.test.mjs"]:
        t = p.read_text(encoding="utf-8") if p.is_file() else ""
        for n in NAMES:
            if n.lower() in t.lower() and p.name != "site.test.mjs":
                bad.append(f"{p.relative_to(root).as_posix()}: names competitor {n}; market data stays internal")
    return bad


def wrapped(probe: str) -> str:
    """A gap's file: or grep: proof as the runnable command SPEC-GATE-1 asks of a new item's done check."""
    return f"cmd:python3 -m foundation rnd --holds '{probe}'"


def same_probe(item_probe: str, gap_probe: str) -> bool:
    return item_probe in (gap_probe, wrapped(gap_probe))


def open_gaps(root=REPO, d=None) -> int:
    """`market_open_gaps`: gaps in the register whose closing probe does not hold yet. The number the gap items predict."""
    from . import selfhost
    d = d or load(root)
    return sum(1 for g in d["gaps"] if not selfhost.probe(Path(root), g["closing_probe"]))


def sync(root=REPO) -> list[str]:
    root, d, out = Path(root), load(root), []
    have = {i["id"] for i in queue.items(root)}
    for g in d["gaps"]:
        if GAP_ID(g) in have:
            continue
        # SPEC-GATE-1: the gap item is filed complete (runnable done check, a prediction on a number this module measures, an out-of-scope line, a closing
        # probe), so the gate that reads new items passes what this loop files.
        probe = wrapped(g["closing_probe"])
        body = (f"**Owner:** {g['owner']}\n**Trigger:** every executor run\n**Done check:** {probe}\n**Prediction:** market_open_gaps <= {open_gaps(root, d) - 1} within 720 h\n**Status:** open\n\n"
                f"Gap in component `{g['component']}`: {g['title']}. {g['why']} Source: doctrine/market.json (MARKET-1). The proof is `{g['closing_probe']}`, shipped with a test.\n\n"
                f"**Out of scope:** any other gap in the register, and a proof file with no behaviour and no test behind it.\n\n**Closing probe:** {probe}")
        j = {"id": GAP_ID(g), "title": f"{GAP_ID(g)}: {g['title']}", "body": body, "labels": [f"role:{g['owner']}", "gap"], "milestone": "Next", "workstream": "Gaps"}
        (root / "docs/issues" / f"{GAP_ID(g)}.json").write_text(json.dumps(j, indent=2) + "\n", encoding="utf-8")
        out.append(GAP_ID(g))
    return out


def report(root=REPO) -> str:
    d, root = load(root), Path(root)
    state, lines = gap_state(root, d), []
    lines.append("component | us | alternatives (covers)")
    for c in d["components"]:
        st = [next(f["status"] for f in d["features"] if f["id"] == x) for x in c["features"]]
        lines.append(f"{c['id']} | {'/'.join(sorted(set(st)))} | " + "; ".join(f"{a['name']} ({a['covers']})" for a in c["alternatives"]))
    for u in d["users"]:
        for s in u["stories"]:
            open_g = [g for g in s["gaps"] if state[g] == "open"]
            lines.append(f"story {s['id']}: {'partial, needs ' + ', '.join(open_g) if open_g else 'delivered'}")
    return "\n".join(lines)


def main(argv) -> int:
    a = argv[0] if argv else "--check"
    if a == "--sync":
        print("\n".join(sync()) or "queue already has every gap"); return 0
    if a == "--report":
        print(report()); return 0
    if a == "--metrics":
        print(json.dumps({"market_open_gaps": open_gaps(), "market_gaps": len(load()["gaps"])})); return 0
    bad = check()
    print("\n".join("market: " + b for b in bad) or "market ok"); return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

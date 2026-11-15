"""IGNORANCE-1: the system knows what the user does not know.

  python3 -m foundation ignorance --compute [--json]   facts the system holds that it has not yet told the user
  python3 -m foundation ignorance --told ID [ID...]     record that the user was told these facts (ops/told.jsonl)
  python3 -m foundation ignorance --check               the register and its sources are intact (CI)

Ignorance is a computed set, not a mood: unknown = known - told. The system's known facts come from measured sources (the criticality
regime, open loops, open gap-register entries, red items); told is an append-only log keyed by a fingerprint of the statement, so a fact whose
text changes is unknown again. The user is never asked what they know: the system infers it from what it has told them, and the briefing leads
the report (four-line report, line "what is open"). Rowan, 2026-11-14: "the system needs to know what the user can't know or doesn't know."
"""
from __future__ import annotations
import hashlib, json, sys
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
TOLD = "ops/told.jsonl"
SOURCES = ("criticality", "open_loops", "gaps")


def _fp(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()[:12]


def known(root=REPO) -> list[dict]:
    """Every fact the system holds that a user could not see without being told: {id, source, statement}."""
    root, out = Path(root), []
    if (root / "doctrine/criticality.json").is_file():
        from . import criticality
        r = criticality.compute(root, feed_ok=True)
        out.append({"id": "criticality-regime", "source": "criticality",
                    "statement": f"the system is {r['regime']}: k {r['k']}, k_self {r['k_self']}, {r['self_deploys']} of {r['verified_deploys']} verified deploys originated on itself"})
    for p in sorted((root / "docs/issues").glob("OL-*.json")):
        d = json.loads(p.read_text(encoding="utf-8"))
        if "**Status:** open" in d.get("body", ""):
            out.append({"id": d["id"], "source": "open_loops", "statement": d["title"]})
    gp = root / "instances/ultrastable/gaps.json"
    if gp.is_file():
        for g in json.loads(gp.read_text(encoding="utf-8"))["gaps"]:
            if g.get("status") == "open":
                out.append({"id": g["id"], "source": "gaps", "statement": f"{g['id']}: still depends on {g['tool']}: {g['what']}"})
    return out


def told(root=REPO) -> set[str]:
    p = Path(root) / TOLD
    if not p.is_file():
        return set()
    return {json.loads(l)["fp"] for l in p.read_text(encoding="utf-8").splitlines() if l.strip()}


def unknown(root=REPO) -> list[dict]:
    t = told(root)
    return [dict(f, fp=_fp(f["id"] + "|" + f["statement"])) for f in known(root) if _fp(f["id"] + "|" + f["statement"]) not in t]


def record_told(root, ids: list[str]) -> list[str]:
    root, done = Path(root), []
    by = {f["id"]: f for f in unknown(root)}
    with (root / TOLD).open("a", encoding="utf-8") as f:
        for i in ids:
            if i not in by:
                raise KeyError(f"{i} is not an unknown fact (already told, or not known)")
            f.write(json.dumps({"id": i, "fp": by[i]["fp"], "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}) + "\n")
            done.append(i)
    return done


def check(root=REPO) -> list[str]:
    errs = []
    try:
        ks = known(root)
    except (OSError, KeyError, ValueError) as e:
        return [f"known facts cannot be computed: {e}"]
    if len({k["id"] for k in ks}) != len(ks):
        errs.append("duplicate fact ids")
    bad = [k["id"] for k in ks if k["source"] not in SOURCES]
    if bad:
        errs.append(f"facts with an unregistered source: {bad}")
    return errs


def main(argv=None) -> int:
    a = argv if argv is not None else sys.argv[1:]
    if "--check" in a:
        e = check(); print("\n".join(e) or f"ignorance ok: {len(known())} known, {len(unknown())} not yet told"); return 1 if e else 0
    if "--told" in a:
        ids = [x for x in a[a.index("--told") + 1:] if not x.startswith("--")]
        print("told:", ", ".join(record_told(REPO, ids))); return 0
    if "--compute" in a:
        u = unknown()
        print(json.dumps(u, indent=1) if "--json" in a else "\n".join(f"{f['id']}: {f['statement']}" for f in u) or "nothing untold"); return 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main())

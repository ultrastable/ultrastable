# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""CODE-ONLY-ORDER as code (Rowan, 2026-11-16). Ultrastable is the foundation for any autonomous system.

Chat threads are temporary. Every decision, instruction and standing rule lives in the system as code it consumes,
and agents decide, deploy and verify without presenting decisions to the owner.

  python3 -m foundation standingorder --check            order in every instruction file, the directive, the seed policy and tenant inheritance; ledger decisions have code consumers; reports hand no decision to the owner
  python3 -m foundation standingorder --lint FILE...     flag an agent report that hands a decision to the owner
  python3 -m foundation standingorder --file-items       write a docs/issues item for each ledger decision whose only consumer is a document or a missing file
  python3 -m foundation standingorder --baseline         record (shrink-only) the legacy ledger rows that lack a code consumer

Data: doctrine/standing-order.json. Consumers: checks.yml step, the fleet pass (foundation/pm.py via --file-items).
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PATH = "doctrine/standing-order.json"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def lint(text: str, d: dict | None = None) -> list[dict]:
    d = d or load()
    excused, out = re.compile(d["excused_by"], re.I), []
    for n, ln in enumerate(text.splitlines(), 1):
        if excused.search(ln):
            continue
        for r in d["decision_handoff"]:
            if any(re.search(p, ln, re.I) for p in r["patterns"]):
                out.append({"line": n, "rule": r["id"], "text": ln.strip()[:100]})
    return out


def _exempt(root: Path, p: Path, d: dict) -> bool:
    rel = p.relative_to(root)
    return any(rel.match(g) or p.match(g) for g in d["lint_exempt"])


def report_failures(root, d) -> list[str]:
    bad = []
    for g in d["report_globs"]:
        for p in sorted(root.glob(g)):
            if p.is_file() and not _exempt(root, p, d):
                for f in lint(p.read_text(encoding="utf-8", errors="replace"), d):
                    bad.append(f"{p.relative_to(root).as_posix()}:{f['line']}: {f['rule']}: {f['text']} (decide, deploy, verify; never hand the decision to the owner)")
    return bad


def instruction_failures(root, d) -> list[str]:
    bad = []
    for rel in d["instruction_files"]:
        p = root / rel
        if not p.exists():
            if rel not in d["optional_instruction_files"]:
                bad.append(f"{rel}: missing")
            continue
        if d["marker"] not in p.read_text(encoding="utf-8"):
            bad.append(f"{rel}: lacks {d['marker']}")
    for rel in d["prompt_sources"]:
        if "standing-order.json" not in (root / rel).read_text(encoding="utf-8"):
            bad.append(f"{rel}: the agent prompt does not load the standing order")
    for rel in d["directive_files"]:
        p = root / rel
        if not p.exists() or d["directive_section"] not in p.read_text(encoding="utf-8") or d["marker"] not in p.read_text(encoding="utf-8"):
            bad.append(f"{rel}: lacks section {d['directive_section']!r} carrying {d['marker']}")
    for rel in d["policy_files"]:
        p = root / rel
        pol = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
        so = pol.get(d["policy_key"])
        if not so or so.get("id") != d["id"]:
            bad.append(f"{rel}: lacks {d['policy_key']} ({d['id']})")
            continue
        for k in ("thread_is_storage", "present_decisions_to_owner"):
            if so.get(k) is not False:
                bad.append(f"{rel}: {d['policy_key']}.{k} must be false")
        for k in ("decide_implement_deploy_verify", "decision_needs_code_consumer"):
            if so.get(k) is not True:
                bad.append(f"{rel}: {d['policy_key']}.{k} must be true")
    for rel in d["inherited_by_tenants"]:
        if not (root / rel).exists():
            bad.append(f"{rel}: tenants bootstrapped from the seed would not inherit the order")
    seed_copy = root / "seed/doctrine/standing-order.json"
    if seed_copy.exists() and seed_copy.read_text(encoding="utf-8") != (root / PATH).read_text(encoding="utf-8"):
        bad.append("seed/doctrine/standing-order.json drifts from doctrine/standing-order.json (copy it)")
    return bad


def consumerless(root, d) -> list[str]:
    """Ledger rows whose probe is not code or data the system reads (a document, or no probe at all)."""
    root = Path(root)
    from . import writeback
    suffixes, out = tuple(d["ledger_consumer_suffixes"]), []
    for r in writeback.ledger_rows(root):
        spec = r.get("probe") or ""
        m = re.match(r"(?:file|grep):([^:\s]+?)(?:::.*)?$", spec)
        target = m.group(1) if m else ""
        if not target or not target.endswith(suffixes) or not (root / target).is_file():
            out.append(r["id"])
    return sorted(out)


def baseline(root, d) -> list[str]:
    p = Path(root) / d["ledger_baseline"]
    return json.loads(p.read_text(encoding="utf-8"))["rows"] if p.exists() else []


def ledger_failures(root, d) -> list[str]:
    now, base = set(consumerless(root, d)), set(baseline(root, d))
    bad = [f"ledger {i}: decision recorded without a code consumer (probe must name an existing code or data file); make code consume it" for i in sorted(now - base)]
    bad += [f"baseline {i}: now has a code consumer or is gone; remove it from {d['ledger_baseline']} (shrink-only)" for i in sorted(base - now)]
    return bad


def ledger_handoffs(root, d) -> list[str]:
    """DEPLOY-PREAPPROVED-1: decision rows whose title or body hands a reversible step (a deploy, a merge) back to the owner."""
    from . import writeback
    return sorted({r["id"] for r in writeback.ledger_rows(Path(root)) if lint((r.get("title") or "") + "\n" + (r.get("body") or ""), d)})


def ledger_handoff_failures(root, d) -> list[str]:
    now, base = set(ledger_handoffs(root, d)), set(d.get("ledger_handoff_baseline", []))
    bad = [f"ledger {i}: the decision defers a reversible step to the owner; decide, deploy and verify instead (DEPLOY-PREAPPROVED-1)" for i in sorted(now - base)]
    bad += [f"ledger_handoff_baseline {i}: no longer defers to the owner or is gone; remove it (shrink-only)" for i in sorted(base - now)]
    return bad


def check(root=REPO) -> list[str]:
    root = Path(root); d = load(root)
    return instruction_failures(root, d) + ledger_failures(root, d) + ledger_handoff_failures(root, d) + report_failures(root, d)


def write_baseline(root=REPO) -> int:
    root = Path(root); d = load(root); p = root / d["ledger_baseline"]
    now = consumerless(root, d)
    keep = sorted(set(now) & set(baseline(root, d))) if p.exists() else now
    p.write_text(json.dumps({"_doc": "Shrink-only list of ledger decisions that had no code consumer when CODE-ONLY-ORDER landed (2026-11-16). `standingorder --file-items` files one work item per entry; a new entry fails CI.", "rows": keep}, indent=1) + "\n", encoding="utf-8")
    return len(keep)


def file_items(root=REPO) -> list[str]:
    root = Path(root); d = load(root); made = []
    for i in consumerless(root, d):
        item = root / "docs/issues" / f"Q-ORDER-{i[-60:].strip('-')}.json"
        if item.exists():
            continue
        item.write_text(json.dumps({
            "id": f"Q-ORDER-{i[-60:].strip('-')}",
            "title": f"CODE-ONLY-ORDER: give decision {i[:50]} a code consumer",
            "body": f"**Owner:** product-manager\n**Trigger:** ledger row has no code consumer\n**Done check:** grep:doctrine/decision-ledger.json::{i} ; its probe names an existing code or data file that enforces the decision, and the id leaves {d['ledger_baseline']}\n**Status:** open\n\nTurn the decision into a check, policy value or loop, repoint the probe, then run `python3 -m foundation standingorder --baseline`.",
            "labels": ["role:product-manager", "code-only-order"], "milestone": "Next", "workstream": "Growth"}, indent=2) + "\n", encoding="utf-8")
        made.append(item.name)
    return made


def main(argv: list[str]) -> int:
    root = REPO
    if argv[:1] == ["--lint-stdin"]:
        found = [f"stdin:{x['line']}: {x['rule']}: {x['text']}" for x in lint(sys.stdin.read())]
        print("\n".join(found) or "standing-order lint ok"); return 1 if found else 0
    if argv[:1] == ["--lint"]:
        found = [f"{fn}:{x['line']}: {x['rule']}: {x['text']}" for fn in argv[1:] for x in lint(Path(fn).read_text(encoding="utf-8"))]
        print("\n".join(found) or "standing-order lint ok"); return 1 if found else 0
    if argv[:1] == ["--baseline"]:
        print(f"baseline rows: {write_baseline(root)}"); return 0
    if argv[:1] == ["--file-items"]:
        made = file_items(root); print("\n".join(made) or "no items to file"); return 0
    bad = check(root)
    print("\n".join(bad) or "standingorder ok"); return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

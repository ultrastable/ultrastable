"""The doctrine kernel as code. (verify-live and honest-measure rules live here, read from doctrine/kernel.json.) Ultrastable's doctrine is bootstrapped by the system itself: its own principles, self-reference,
autonomy and self-improvement loops. `doctrine/kernel-8.2.1.md` holds the text verbatim; `doctrine/kernel.json` holds its machine form.

  python3 -m foundation kernel --check           the JSON matches the text (commitments, signatures, tick steps, trust weights, metrics, directives)
  python3 -m foundation kernel --lint FILE...    recognition lint over reports (exit 1 on a finding)
  python3 -m foundation kernel --metrics FILE... report-shape rates from the same lint

The lint reads shapes in a report: a conditional offer, a report that ends in a question, a menu, a blocker with no stated reason,
you as the subject of a next action, narration, and the evidence rules of VERIFY-LIVE-1 and HONEST-MEASURE-1. Fenced code, blockquotes
and inline code are quotations, not reports, and are skipped; a limit stated with its reason is excluded (readings n and p).
"""
from __future__ import annotations
import json, re
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PATH = "doctrine/kernel.json"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def _sig_strings(md: str) -> dict[str, str]:
    """Recognition blocks from the kernel text: heading sentence -> its Signature line."""
    out, cur = {}, None
    for ln in md.splitlines():
        if ln.startswith("I notice when"):
            cur = ln
        elif ln.strip().startswith("Signature:") and cur:
            out[cur] = ln.strip()
            cur = None
    return out


def check(root=REPO) -> list[str]:
    root, bad = Path(root), []
    k = load(root)
    md = (root / k["text"]).read_text(encoding="utf-8")
    for c in k["commitments"]:
        if not re.search(rf"^{re.escape(c['id'])}: ", md, re.M):
            bad.append(f"commitment {c['id']} is not in {k['text']}")
        if not (root / c["code"]).exists():
            bad.append(f"commitment {c['id']}: code path {c['code']} missing")
    if len(_sig_strings(md)) != len(k["recognitions"]):
        bad.append(f"kernel text has {len(_sig_strings(md))} recognitions, kernel.json has {len(k['recognitions'])}")
    for r in k["recognitions"]:
        for p in r["lint"]:
            re.compile(p)
    steps = re.search(r"TICK\.steps:\n((?:  - \w+\n)+)", md)
    text_steps = re.findall(r"- (\w+)", steps.group(1)) if steps else []
    if text_steps != [s["id"] for s in k["tick_steps"]]:
        bad.append("tick steps in kernel.json differ from the kernel text")
    from . import selfhost
    for s in k["tick_steps"]:
        if not (root / s["implemented_by"]).exists():
            bad.append(f"tick step {s['id']}: {s['implemented_by']} missing")
        if s.get("closing_probe") and not selfhost.probe(root, s["closing_probe"]):
            bad.append(f"tick step {s['id']}: closing probe fails ({s['closing_probe']})")
        if not s.get("sla") or not s.get("done") or len(s.get("paths", [])) < 2:
            bad.append(f"tick step {s['id']}: needs an SLA, a Definition of Done and two independent paths")
    for kind in ("rises", "falls"):
        for name, v in k["trust"][kind].items():
            word = name.replace("_", " ")
            if not re.search(re.escape(word).replace(r"\ ", r"[\s-]+"), md, re.I):
                bad.append(f"trust {kind} '{name}' not found in the kernel text")
            if (v > 0) != (kind == "rises"):
                bad.append(f"trust {name}: sign does not match {kind}")
    for m in k["metrics"]:
        if m["id"] not in md:
            bad.append(f"metric {m['id']} not in the kernel text")
    dtxt = (root / k["directives_text"]).read_text(encoding="utf-8")
    for d in k["directives"]:
        if d["id"] not in dtxt:
            bad.append(f"directive {d['id']} is not in {k['directives_text']}")
        if not (root / d["enforced_by"]).exists() or not selfhost.probe(root, d["probe"]):
            bad.append(f"directive {d['id']}: enforcement probe fails ({d['probe']})")
    if "PROACTIVE-PROGRAMS-1" not in dtxt:
        bad.append("proactive programs missing")
    from . import kernel9  # KERNEL-9-1: the successor text is pinned and mapped; runs wherever `kernel --check` runs
    if (root / kernel9.PATH).exists():
        bad += kernel9.check(root)
    if root == REPO:  # DISPOSITION-1 reads the executor ledger of this repository (and its evidence branch), not a test copy
        from . import disposition
        bad += disposition.check(root)
        rate = disposition.recall_rate(disposition.rows(root))  # M1 failure_recall probe
        if rate is not None and rate < 0.9:
            bad.append(f"failure_recall {rate} < 0.9: failed items whose failures the next prompt would not carry (kernel 9.0.0 M1)")
    return bad


def _prose(text: str):
    """Yield (line_number, line) for report lines: not fenced code, not a blockquote, inline code removed."""
    fenced = False
    for n, ln in enumerate(text.splitlines(), 1):
        if ln.strip().startswith("```"):
            fenced = not fenced
            continue
        if fenced or ln.lstrip().startswith((">", "|")):
            continue
        yield n, re.sub(r"`[^`]*`", "", ln)


def lint(text: str, kernel: dict | None = None) -> list[dict]:
    k = kernel or load()
    excused = re.compile(k["excused_by"], re.I)
    found = []
    for n, ln in _prose(text):
        for r in k["recognitions"]:
            for p in r["lint"]:
                if re.search(p, ln, re.I) and not (r["id"] == "blocker-without-coverage" and excused.search(ln)):
                    found.append({"line": n, "recognition": r["id"], "text": ln.strip()[:100]})
                    break
    paras, cur, start = [], [], 1
    for n, ln in _prose(text):
        if ln.strip():
            if not cur:
                start = n
            cur.append(ln)
        elif cur:
            paras.append((start, " ".join(cur))); cur = []
    if cur:
        paras.append((start, " ".join(cur)))
    for n, para in paras:
        for rid, rule in k["evidence_rules"].items():
            if re.search(rule["claim"], para, re.I) and not re.search(rule["evidence"], para, re.I):
                found.append({"line": n, "recognition": rid, "text": para.strip()[:100]})
    return found


def metrics(findings: list[dict], reports: int, kernel: dict | None = None) -> dict:
    k = kernel or load()
    reports = max(reports, 1)
    out = {}
    for m in k["metrics"]:
        if m.get("computed_from"):
            out[m["id"]] = round(sum(1 for f in findings if f["recognition"] == m["computed_from"]) / reports, 4)
    return out


def inferred_direction(root=REPO, minimum=2) -> list[str]:
    """Issue workstreams with at least `minimum` items: the record's revealed preference, read by the driver."""
    import collections
    c = collections.Counter()
    for f in sorted((Path(root) / "docs/issues").glob("*.json")):
        if not f.name.startswith("_"):
            c[json.loads(f.read_text(encoding="utf-8")).get("workstream", "")] += 1
    return [w for w, n in c.most_common() if w and n >= minimum]

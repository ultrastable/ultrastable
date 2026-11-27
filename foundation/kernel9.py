# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""KERNEL-9-1. Kernel 9.0.0 as code: every clause in doctrine/kernel-9.0.0.md has an enforcer that exists and a metric; budgets hold;
the step repertoire vetoes irreversible classes; partitions meet the minimum-organization shape; no scalar fleet score field exists.

  python3 -m foundation kernel9 --check [--json]
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PATH = "doctrine/kernel9.json"
REQUIRED_VETO = {"delete_data", "read_or_rotate_secrets", "force_push", "edit_essential_variables", "edit_ci_gates", "billing_change", "external_publish"}


def _load(root, rel):
    return json.loads((Path(root) / rel).read_text(encoding="utf-8"))


def _keys(o):
    if isinstance(o, dict):
        for k, v in o.items():
            yield k
            yield from _keys(v)
    elif isinstance(o, list):
        for v in o:
            yield from _keys(v)


def check(root=REPO) -> list[str]:
    root = Path(root)
    problems = []
    k = _load(root, PATH)
    text = (root / k["text"]).read_text(encoding="utf-8")
    for c in k["clauses"]:
        if not re.search(rf"^{c['id']} ", text, re.M):
            problems.append(f"clause {c['id']} is in {PATH} but not in {k['text']}")
        if not (root / c["enforcer"]).exists():
            problems.append(f"clause {c['id']}: enforcer {c['enforcer']} does not exist")
        if not c.get("metric") or not c.get("source"):
            problems.append(f"clause {c['id']}: names no metric or source")
    # UNITARY-1: the kernel is one self-contained file. No URL, no repository path, and its embedded registries equal the repo's JSON.
    for pat in (r"https?://", r"\b(doctrine|seed|foundation|agents|scripts)/[\w.-]+"):
        m = re.search(pat, text)
        if m:
            problems.append(f"kernel text is not self-contained: references {m.group(0)!r}")
    blocks = [json.loads(b) for b in re.findall(r"```json\n(.*?)\n```", text, re.S)]
    for rel, key in (("doctrine/step-repertoire.json", "steps"), ("doctrine/partitions.json", "joins")):
        ref = {a: b for a, b in _load(root, rel).items() if a != "_doc"}
        if ref not in blocks:
            problems.append(f"the {key} registry embedded in the kernel differs from {rel}: regenerate the kernel")
    for d in k["dispositions"]:
        if d not in text:
            problems.append(f"disposition {d} missing from the kernel text")
    b = k["budgets"]
    for rel in ("doctrine/kernel-9.0.0.md", "AGENTS.md", "CLAUDE.md"):
        n = len((root / rel).read_bytes())
        if n > b[rel]:
            problems.append(f"{rel} is {n} bytes, over its {b[rel]} budget: move detail to a skill or docs")
    for p in (root / "agents/skills").glob("*/SKILL.md"):
        s = p.read_text(encoding="utf-8")
        if s.count("\n") > b["skill_max_lines"]:
            problems.append(f"{p.relative_to(root)} is over {b['skill_max_lines']} lines")
        m = re.match(r"---\nname: ([a-z0-9-]{1,64})\ndescription: (.{1,1024})\n", s)
        if not m or m.group(1) != p.parent.name:
            problems.append(f"{p.relative_to(root)}: frontmatter name must equal its directory and carry a description")
    rep = _load(root, "doctrine/step-repertoire.json")
    missing = REQUIRED_VETO - set(rep["veto_classes"])
    if missing:
        problems.append(f"step-repertoire veto_classes lacks {sorted(missing)}")
    for s in rep["steps"]:
        if s["undo"] in ("", None):
            problems.append(f"step {s['id']} is not reversible (no undo)")
    parts = _load(root, "doctrine/partitions.json")
    n = len(parts["partitions"])
    for j in parts["joins"]:
        if j["from"] not in parts["partitions"] or j["to"] not in parts["partitions"]:
            problems.append(f"join {j['from']}->{j['to']} names an unknown partition")
    if n >= parts["min_partitions_for_connectance"] and len(parts["joins"]) / (n * (n - 1)) > parts["connectance_max"]:
        problems.append("connectance over the ceiling")
    writers = [p for p in parts["partitions"].values() if p.get("writer") != "none"]
    if len(writers) < 1 or n < 2:
        problems.append("minimum organization: at least two coupled partitions")
    bad = set(k["forbidden_keys"]) & set(_keys(_load(root, "seed/autonomy/essential-variables.json")))
    if bad:
        problems.append(f"scalar fleet score field in essential variables: {sorted(bad)}")
    return problems


def main(argv=None) -> int:
    a = sys.argv[1:] if argv is None else argv
    if "--check" not in a:
        print(__doc__)
        return 0 if "--help" in a else 2
    probs = check()
    if "--json" in a:
        print(json.dumps({"ok": not probs, "problems": probs}))
    else:
        print("kernel9 ok" if not probs else "\n".join(probs))
    return 1 if probs else 0


if __name__ == "__main__":
    raise SystemExit(main())

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""CONSTITUTION-1 (Rowan, 2026-11-25): the seed says what an ultrastable system is, and CI fails when it stops being true.

"something's missing in the core ultra-stable template that's not saying, hey, this is what an ultra-stable system is. This is how ultra-stable
runs. This is how ultra-stable bootstraps. This is how ultra-stable becomes autonomous and achieves criticality." Ultrastable is the foundation
for any autonomous system.

The statement is seed/doctrine/constitution.json and its engine is seed/scripts/constitution.py, so every seeded system carries both. This
module is the platform's side: it checks the seed against the code (and the platform-only bindings against this tree), fails a standing rule that
this repository's agent instructions carry with no constitution entry, and boots a scratch copy of the seed to prove the boot reads it.

  python3 -m foundation constitution --check    constitution agrees with code; every rule has a detector and a remediation; no unmapped new rule
  python3 -m foundation constitution --fresh    copy the seed to a scratch directory and run its boot: stage `constitute` must be ok
  python3 -m foundation constitution --render   regenerate seed/doctrine/CONSTITUTION.md
"""
from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / "seed"
INSTRUCTIONS = ["agents/AGENTS.md"]


def engine():
    spec = importlib.util.spec_from_file_location("seed_constitution", SEED / "scripts" / "constitution.py")
    m = importlib.util.module_from_spec(spec)
    sys.modules["seed_constitution"] = m
    spec.loader.exec_module(m)
    return m


def audit(root: Path = ROOT) -> list[str]:
    root = Path(root)
    c = engine()
    errs = c.check(root / "seed", platform=root, instruction_files=["AGENTS.md", "agents/AGENTS.md"])
    # this repository's own instructions: a new standing rule with no entry fails here, before it reaches the seed copy
    j = c.load(root / "seed")
    mapped = {r["id"] for r in j["rules"]} | {i for r in j["rules"] for i in r.get("covers", [])}
    base = json.loads((root / "seed" / c.BASELINE).read_text(encoding="utf-8"))["unmapped"]
    for rid in sorted(c.instruction_ids(root, INSTRUCTIONS) - mapped - set(base)):
        errs.append(f"standing rule {rid} is in agents/AGENTS.md but has no entry in seed/{c.PATH}: a rule with no detector and remediation in code is not adopted")
    return errs


def fresh(root: Path = ROOT) -> list[str]:
    """Boot a scratch copy of the seed (dry run, no credential) and require the constitute stage to be ok."""
    with tempfile.TemporaryDirectory() as d:
        dst = Path(d) / "seed"
        shutil.copytree(root / "seed", dst, ignore=shutil.ignore_patterns(".git", "org", "node_modules", "__pycache__", "config.js", "wrangler.jsonc"))
        p = subprocess.run([sys.executable, str(dst / "bootstrap" / "bootstrap.py"), "--root", str(dst), "--out", str(Path(d) / "out")],
                           capture_output=True, text=True, timeout=600, cwd=d)
        log = Path(d) / "out" / "boot-log.json"
        if not log.is_file():
            return [f"fresh seed produced no boot log (exit {p.returncode}): {(p.stderr or p.stdout)[-300:]}"]
        st = {s["stage"]: s for s in json.loads(log.read_text())["stages"]}
        errs = []
        if st.get("constitute", {}).get("status") != "ok":
            errs.append(f"fresh seed: stage constitute is {st.get('constitute')}")
        if not (Path(d) / "out" / "constitution.json").is_file():
            errs.append("fresh seed did not assemble org/constitution.json")
        return errs


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    if "--render" in a:
        c = engine()
        (SEED / c.PROSE).write_text(c.render(c.load(SEED)), encoding="utf-8")
        print("rendered")
        return 0
    e = fresh() if "--fresh" in a else audit()
    print("constitution ok" if not e else "\n".join(e))
    return 1 if e else 0


if __name__ == "__main__":
    sys.exit(main())

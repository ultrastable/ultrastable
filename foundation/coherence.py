# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""COHERENCE-1: no instruction surface, and no agent file generated for another repository, contradicts the closed-loop axiom; every rule names code and reaches the seed. Ultrastable is the foundation for any autonomous system.

Rowan, 2026-11-25: "all surfaces, all files, all code, all instructions, everything has to work together automatically and seamlessly from the
beginning." On 2026-11-25 the satellite repositories' agent files said a human must review protected changes while the axiom says no person
reviews anything. This module is the check for that, driven by doctrine/coherence.json:

  imports        every @import in CLAUDE.md files resolves
  contradictions no instruction surface (or a generated copy) carries a phrase that contradicts the closed-loop axiom
  duplicates     no rule bullet appears twice in one AGENTS.md
  rules-reach    every rule id in agents/AGENTS.md is also in seed/agents/AGENTS.md (and back), unless listed platform-only
  enforced       every rule names code that exists (a path or a `python3 -m foundation <module>`)
  remote         (--remote) the agent files in the satellite repositories equal what workers/tools/sync_agent_files.py generates

Owned elsewhere and not repeated here: the seed template against seed/ (FLEET-MAP-1, `fleetmap --drift`), repository settings
(REPO-STANDARD-1 `repostd`, ADMIT-1 `admit`), the definition of a system (SYSTEM-SPEC-1, COLDSTART-1).

  python3 -m foundation coherence --check           in `checks`; offline
  python3 -m foundation coherence --check --remote  also reads the satellite repositories over HTTPS (an unreadable copy is unmeasured, never passed)
  python3 -m foundation coherence --report          JSON of every finding
"""
from __future__ import annotations

import glob
import importlib.util
import json
import re
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
RULE_HEAD = re.compile(r"^- \*\*(.+?)\*\*", re.M)
NEGATED = re.compile(r"(?i)(\bnever\b|\bdo not\b|\bdon't\b|\bnot\b|\bno\b|avoid|fails when|instead of)[^.\n]*$")
RULE_ID = re.compile(r"\b([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d+[A-Z]?)\b")


def load(root: Path = REPO) -> dict:
    return json.loads((Path(root) / "doctrine" / "coherence.json").read_text(encoding="utf-8"))


def rules(text: str) -> dict[str, str]:
    """rule id -> the whole bullet (title and body up to the next bullet)."""
    out: dict[str, str] = {}
    heads = list(RULE_HEAD.finditer(text))
    for i, m in enumerate(heads):
        end = heads[i + 1].start() if i + 1 < len(heads) else len(text)
        body = text[m.start():end]
        for rid in RULE_ID.findall(m.group(1)):
            out.setdefault(rid, body)
    return out


def _imports(root: Path, spec: dict) -> list[str]:
    bad = []
    for f in spec["imports"]:
        p = root / f
        for line in p.read_text(encoding="utf-8").splitlines():
            if line.startswith("@") and not (p.parent / line[1:].strip()).exists():
                bad.append(f"{f}: @{line[1:].strip()} does not resolve")
    return bad


def _surfaces(root: Path, spec: dict) -> list[Path]:
    out = []
    for g in spec["instruction_surfaces"]:
        out += [Path(x) for x in sorted(glob.glob(str(root / g)))]
    return out


def _sync_module(root: Path):
    p = root / "workers" / "tools" / "sync_agent_files.py"
    s = importlib.util.spec_from_file_location("sync_agent_files", p)
    m = importlib.util.module_from_spec(s)
    s.loader.exec_module(m)
    return m


def _contradictions(root: Path, spec: dict) -> list[str]:
    bad = []
    texts = [(str(p.relative_to(root)), p.read_text(encoding="utf-8")) for p in _surfaces(root, spec)]
    sync = _sync_module(root)
    for repo in sync.REPOS:  # the generated copies count: what they would say is what every agent in that repository reads
        texts.append((f"generated:{repo}/AGENTS.md", sync.agents_md(repo)))
    for name, t in texts:
        for c in spec["contradictions"]:
            for m in re.finditer(c["pattern"], t):
                before = t[max(0, m.start() - 120):m.start()]
                if NEGATED.search(before) or t[m.start() - 1:m.start()] == '"':
                    continue  # a rule that names the phrase to forbid it, or quotes it, is not the phrase
                line = t[:m.start()].count("\n") + 1
                bad.append(f"{name}:{line}: '{m.group(0)}' contradicts the axiom ({c['why']})")
    return bad


def _duplicates(root: Path) -> list[str]:
    bad = []
    for f in ("agents/AGENTS.md", "seed/agents/AGENTS.md"):
        seen = {}
        for m in RULE_HEAD.finditer((root / f).read_text(encoding="utf-8")):
            k = m.group(1).strip()
            if k in seen:
                bad.append(f"{f}: rule '{k[:60]}' appears twice")
            seen[k] = 1
    return bad


def _reach(root: Path, spec: dict) -> list[str]:
    a = rules((root / "agents/AGENTS.md").read_text(encoding="utf-8"))
    s = rules((root / "seed/agents/AGENTS.md").read_text(encoding="utf-8"))
    po = set(spec["platform_only_rules"])
    bad = [f"rule {r} is in agents/AGENTS.md but not in seed/agents/AGENTS.md (Rules live everywhere; or list it platform_only_rules)" for r in sorted(set(a) - set(s) - po)]
    bad += [f"rule {r} is in seed/agents/AGENTS.md but not in agents/AGENTS.md (one source)" for r in sorted(set(s) - set(a))]
    bad += [f"platform_only_rules lists {r}, which is not a rule in agents/AGENTS.md" for r in sorted(po - set(a))]
    return bad


def _enforced(root: Path, spec: dict) -> list[str]:
    bad = []
    ok_without = set(spec["enforcement_ok_without_path"])
    for rid, body in rules((root / "agents/AGENTS.md").read_text(encoding="utf-8")).items():
        if rid in ok_without:
            continue
        paths = [t for t in re.findall(r"`([^`\s]+)`", body) if "/" in t or re.search(r"\.(py|js|mjs|json|yml|sh)$", t)]
        mods = re.findall(r"python3 -m foundation[ .]([a-z_]+)", body)
        hit = any(glob.glob(str(root / p.split(":")[0].split("#")[0].rstrip(".,;"))) for p in paths) or any((root / "foundation" / f"{m}.py").exists() for m in mods)
        if not hit:
            bad.append(f"rule {rid} names no code that exists (a path or `python3 -m foundation <module>`): a rule without enforcement")
    return bad


def _fetch(url: str) -> str | None:
    m = re.match(r"https://raw.githubusercontent.com/([^/]+/[^/]+)/main/(.+)$", url)
    if m and shutil.which("gh"):  # a private copy (ultrastable/seed) is read through the API with the run's token
        r = subprocess.run(["gh", "api", f"repos/{m.group(1)}/contents/{m.group(2)}", "-H", "Accept: application/vnd.github.raw"], capture_output=True, text=True, timeout=30)
        if r.returncode == 0:
            return r.stdout
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers={"user-agent": "ultrastable-coherence"}), timeout=20) as r:
            return r.read().decode("utf-8")
    except Exception as e:  # recorded by the caller as unmeasured
        sys.stderr.write(f"coherence: {url}: {type(e).__name__}: {e}\n")
        return None


def _remote(root: Path, spec: dict) -> tuple[list[str], list[str]]:
    bad, unmeasured = [], []
    sync = _sync_module(root)
    for repo in sync.REPOS:
        if repo in spec.get("retired_copies", []):
            continue
        full = f"ultrastable/{repo}"
        for rel, text in sync.files(repo).items():
            if rel not in ("AGENTS.md", ".github/copilot-instructions.md"):
                continue
            have = _fetch(f"https://raw.githubusercontent.com/{full}/main/{rel}")
            if have is None:
                unmeasured.append(f"{full}/{rel}")
            elif have.replace("\r\n", "\n") != text:
                bad.append(f"{full}/{rel} differs from workers/tools/sync_agent_files.py output")
    return bad, unmeasured


def findings(root: Path = REPO, remote: bool = False) -> dict:
    root = Path(root)
    spec = load(root)
    f = {"imports": _imports(root, spec), "contradictions": _contradictions(root, spec), "duplicates": _duplicates(root),
         "rules-reach": _reach(root, spec), "enforced": _enforced(root, spec)}
    if remote:
        f["remote"], f["unmeasured"] = _remote(root, spec)
    return f


def main(argv: list[str]) -> int:
    if "--check" in argv or "--report" in argv:
        f = findings(remote="--remote" in argv)
        if "--report" in argv:
            print(json.dumps(f, indent=1))
            return 0
        n = 0
        for k, v in f.items():
            for x in v:
                print(("UNMEASURED " if k == "unmeasured" else "FAIL ") + f"[{k}] {x}")
                n += k != "unmeasured"
        print(f"coherence: {'ok' if not n else str(n) + ' finding(s)'}")
        return 1 if n else 0
    print(__doc__)
    return 2

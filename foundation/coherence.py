"""COHERENCE-1: one source for every instruction and config surface; a copy that drifts, contradicts or enforces nothing fails. Ultrastable is the foundation for any autonomous system.

Rowan, 2026-11-25: "all surfaces, all files, all code, all instructions, everything has to work together automatically and seamlessly from the
beginning." On 2026-11-25 the parts had drifted apart: the seed kit fell 134 files behind its source, the satellite repositories' agent files
said a human must review protected changes while the axiom says no person reviews anything, five tenant repositories had settings nobody set,
and rules were written in one AGENTS.md but not the other. This module is the single check, driven by doctrine/coherence.json:

  imports        every @import in CLAUDE.md files resolves
  contradictions no instruction surface (or a generated copy) carries a phrase that contradicts the closed-loop axiom
  duplicates     no rule bullet appears twice in one AGENTS.md
  rules-reach    every rule id in agents/AGENTS.md is also in seed/agents/AGENTS.md (and back), unless listed platform-only
  enforced       every rule names code that exists (a path or a `python3 -m foundation <module>`)
  generated      agent files for the satellite repositories and github/org-settings.json equal what their generators produce
  remote         (--remote) the copies in other repositories equal their source: ultrastable/seed against seed/, satellites against the generator

  python3 -m foundation coherence --check           in `checks`; offline
  python3 -m foundation coherence --check --remote  also reads the copy repositories over HTTPS (an unreadable copy is unmeasured, never passed)
  python3 -m foundation coherence --gen [--apply]   regenerate github/org-settings.json tenant entries from doctrine/tenant-repos.json
  python3 -m foundation coherence --report          JSON of every finding
"""
from __future__ import annotations

import copy
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


def org_settings(root: Path = REPO) -> dict:
    """github/org-settings.json with one entry per tenant whose repository exists, cloned from the template entry; description and
    visibility come from doctrine/tenant-repos.json, so the two never disagree."""
    root = Path(root)
    spec = load(root)
    cur = json.loads((root / "github" / "org-settings.json").read_text(encoding="utf-8"))
    tenants = json.loads((root / "doctrine" / "tenant-repos.json").read_text(encoding="utf-8"))["tenants"]
    tmpl = cur["repos"][spec["settings_template"]]
    new = copy.deepcopy(cur)
    for slug, t in tenants.items():
        repo = t.get("repo")
        if not repo or t.get("state") not in spec["tenant_repo_states"]:
            continue
        e = copy.deepcopy(new["repos"].get(repo) or tmpl)
        if t.get("description"):
            e["description"] = t["description"]
        if t.get("frontend") and not e.get("homepage"):
            e["homepage"] = t["frontend"]
        e.setdefault("settings", {})
        e["settings"]["private"] = t.get("visibility") == "private"
        e["settings"]["delete_branch_on_merge"] = True  # BRANCH-CLEANUP-1
        e.setdefault("branch_protection", copy.deepcopy(tmpl["branch_protection"]))
        e["branch_protection"]["allow_force_pushes"] = False
        new["repos"][repo] = e
    for repo, e in new["repos"].items():  # every repository, core ones included, holds the two settings the doctrine names
        e.setdefault("settings", {})["delete_branch_on_merge"] = True
        e.setdefault("branch_protection", copy.deepcopy(tmpl["branch_protection"]))["allow_force_pushes"] = False
    return new


def _generated(root: Path) -> list[str]:
    want = org_settings(root)
    have = json.loads((root / "github" / "org-settings.json").read_text(encoding="utf-8"))
    if want != have:
        diff = [r for r in want["repos"] if want["repos"][r] != have["repos"].get(r)]
        return [f"github/org-settings.json is out of step with doctrine/tenant-repos.json for {', '.join(diff)}: run coherence --gen --apply"]
    return []


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
    wf = sorted(p.relative_to(root / "seed").as_posix() for p in (root / "seed/.github/workflows").glob("*.yml"))
    for f in ["agents/AGENTS.md", "bootstrap/bootstrap.py", "worker/src/tick.js", "ultrastable.json"] + wf:  # workflows too: kit-sync cannot write them
        have = _fetch(f"https://raw.githubusercontent.com/ultrastable/seed/main/{f}")
        if have is None:
            unmeasured.append(f"ultrastable/seed/{f}")
        elif have != (root / "seed" / f).read_text(encoding="utf-8"):
            bad.append(f"ultrastable/seed/{f} differs from seed/{f} (kit-sync behind)")
    return bad, unmeasured


def findings(root: Path = REPO, remote: bool = False) -> dict:
    root = Path(root)
    spec = load(root)
    f = {"imports": _imports(root, spec), "contradictions": _contradictions(root, spec), "duplicates": _duplicates(root),
         "rules-reach": _reach(root, spec), "enforced": _enforced(root, spec), "generated": _generated(root)}
    if remote:
        f["remote"], f["unmeasured"] = _remote(root, spec)
    return f


def main(argv: list[str]) -> int:
    if "--gen" in argv:
        new = org_settings()
        p = REPO / "github" / "org-settings.json"
        if "--apply" in argv:
            p.write_text(json.dumps(new, indent=2) + "\n", encoding="utf-8")
            print("wrote github/org-settings.json")
        else:
            print(json.dumps(sorted(new["repos"]), indent=1))
        return 0
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

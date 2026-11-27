"""Core / instance link. Ultrastable is the foundation for any autonomous system.

One core (this repository's `seed/` kernel plus `foundation/`), many instances (QNFO, a third party's repo, a new idea).
An instance owns only config, plugins and domain content; the kernel is pinned by version and by file digest.

  python3 -m foundation upstream contract --apply|--check          core: write / verify core-contract.json (version, kernel paths, digests)
  python3 -m foundation upstream adopt --out DIR --name N --slug S  bring your own repo: add the kernel, lock and workflows (additive, idempotent)
  python3 -m foundation upstream sync --instance DIR [--apply]     flow DOWN: pull the pinned-to-latest kernel; local edits are never overwritten
  python3 -m foundation upstream check --instance DIR              contract test: does the instance honour the core's contract
  python3 -m foundation upstream drift --instance DIR [--json]     both ways: behind core (down) and locally edited kernel files (candidates to send UP)
  python3 -m foundation upstream leaks                              core hygiene: no instance-specific values inside the kernel
"""
from __future__ import annotations
import argparse, datetime as dt, hashlib, json, re, shutil, sys
from pathlib import Path

from . import manifest as mf, scaffold

REPO = Path(__file__).resolve().parents[1]
CONTRACT = "core-contract.json"
LOCK = "ultrastable.lock.json"
TEMPLATE = REPO / "seed" / "instance-template"
SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")
SKIP_PARTS = {"node_modules", "__pycache__", ".git"}
# What an instance owns. Everything else listed in kernel_paths belongs to the core.
# IDENTITY-AT-BIRTH-1: the identity files a system adopts at boot (seed/scripts/surfaces.py adopt) are its own from then on.
OWNED = ["instance.json", "domain/", "plugins/", "docs/PROJECT-MEMORY.md", "IDEA.md", "README.md", "ultrastable.json", "CITATION.cff", "publiccode.yml", "catalog-info.yaml", "llms.txt", "REUSE.toml", "codemeta.json", "CHANGELOG.md", ".ultrastable/"]


def _sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def kernel_files(root: Path, kernel_root: str = "seed", paths=None) -> dict:
    """{relative path: sha256} for every kernel file under root/kernel_root, in the instance layout (kernel_root stripped)."""
    base = root / kernel_root if kernel_root else root
    out = {}
    for rel in paths or scaffold.KERNEL_PATHS:
        p = base / rel
        files = [p] if p.is_file() else [f for f in sorted(p.rglob("*")) if f.is_file()] if p.is_dir() else []
        for f in files:
            if SKIP_PARTS & set(f.parts):
                continue
            out[f.relative_to(base).as_posix()] = _sha(f)
    return out


def build_contract(core: Path = REPO, version: str | None = None) -> dict:
    cur = {}
    cp = core / CONTRACT
    if cp.exists():
        cur = json.loads(cp.read_text())
    return {
        "contract": 1,
        "version": version or cur.get("version", "0.1.0"),
        "repo": cur.get("repo", "ultrastable/ultrastable"),
        "kernel_root": "seed",
        "kernel_paths": scaffold.KERNEL_PATHS,
        "owned_by_instance": OWNED,
        "required_instance_files": ["instance.json", LOCK, "docs/PROJECT-MEMORY.md", "AGENTS.md"],
        "compat": "same major version; a major bump ships a migration note in docs/architecture/core-and-instances.md",
        "runtime_core": cur.get("runtime_core", {
            "repo": "ultrastable/workers",
            "what": "runtime code (core/, adapters/) that replaces the QNFO workers; pinned per instance by git tag in ultrastable.lock.json under runtime.ref",
            "instance_file": "instance.runtime.json",
            "instance_file_validator": "tools/instance_config.mjs (--strict rejects placeholders)",
            "cutover_plan": "docs/cutover/PLAN.md",
            "parity_contract": "docs/cutover/parity-contract.json",
        }),
        "forbidden_in_kernel": cur.get("forbidden_in_kernel", ["qnfo", "q08.org", "qnfo-workers"]),
        "leak_allowlist": cur.get("leak_allowlist", {}),
    }


def contract_check(core: Path = REPO) -> list[str]:
    cp = core / CONTRACT
    if not cp.exists():
        return [f"{CONTRACT} missing (run: python3 -m foundation upstream contract --apply)"]
    have = json.loads(cp.read_text())
    bad = []
    if not SEMVER.match(have.get("version", "")):
        bad.append("version is not semver")
    if "digests" in have:
        bad.append("digests must not be committed: they go stale whenever another change touches the kernel; they are computed on demand")
    if have.get("kernel_paths") != scaffold.KERNEL_PATHS:
        bad.append("kernel_paths differ from foundation/scaffold.py KERNEL_PATHS; run: python3 -m foundation upstream contract --apply")
    return bad


def leaks(core: Path = REPO) -> list[str]:
    """Instance-specific values inside the kernel are a defect: the kernel is the same for every system."""
    c = json.loads((core / CONTRACT).read_text())
    allow = c.get("leak_allowlist", {})
    bad = []
    for rel in kernel_files(core):
        p = core / c["kernel_root"] / rel
        try:
            t = p.read_text(encoding="utf-8").lower()
        except UnicodeDecodeError:
            continue
        for term in c["forbidden_in_kernel"]:
            if term in t and rel not in allow:
                bad.append(f"{c['kernel_root']}/{rel}: contains instance-specific term '{term}'")
    return bad


RUNTIME_REQUIRED = ["slug", "account_id", "worker_name", "d1_database", "routes", "owner_contact", "repository", "secrets"]
BINDING = re.compile(r"^[A-Z][A-Z0-9_]{2,63}$")
PLACEHOLDER = re.compile(r"REPLACE|\.invalid\b|^owner/repo$")


def runtime_check(cfg: dict, strict: bool = False) -> list[str]:
    """Python port of ultrastable/workers tools/instance_config.mjs validateInstance, so one contract covers both code homes."""
    if not isinstance(cfg, dict):
        return ["instance.runtime.json is not an object"]
    bad = [f"missing {k}" for k in RUNTIME_REQUIRED if cfg.get(k) in (None, "")]
    if isinstance(cfg.get("routes"), list) and len(cfg["routes"]) < 2:
        bad.append("no single route: routes needs a second entry")
    for name, b in (cfg.get("secrets") or {}).items():
        if not BINDING.match(str(b)):
            bad.append(f"secret {name} must be a binding name (UPPER_SNAKE), never a value")
    if strict:
        bad += [f"placeholder value in {k}" for k, v in cfg.items() if PLACEHOLDER.search(v if isinstance(v, str) else json.dumps(v))]
    return bad


def _load_lock(inst: Path) -> dict | None:
    p = inst / LOCK
    return json.loads(p.read_text()) if p.exists() else None


def _major(v: str) -> int:
    return int(v.split(".")[0])


def drift(core: Path, inst: Path) -> dict:
    """down: the instance is behind the core. up: kernel files edited in the instance (candidates for a PR to the core)."""
    c, lock = json.loads((core / CONTRACT).read_text()), _load_lock(inst)
    if lock is None:
        return {"status": "no-lock", "behind": None, "local_edits": [], "missing": [], "note": f"{LOCK} missing; run adopt"}
    local_edits, missing = [], []
    for rel, sha in lock["digests"].items():
        f = inst / rel
        if not f.exists():
            missing.append(rel)
        elif _sha(f) != sha:
            local_edits.append(rel)
    behind = lock["core"]["version"] != c["version"] or lock["digests"] != kernel_files(core)
    return {"status": "drifted" if (behind or local_edits or missing) else "in-sync", "behind": behind,
            "pinned": lock["core"]["version"], "core": c["version"], "local_edits": sorted(local_edits), "missing": sorted(missing)}


def _older_core_version(core: Path, kernel_root: str, rel: str, dst: Path) -> bool:
    """FLEET-MAP-1: a system filled by a plain copy of seed/ has no lock, so every kernel file the core later changed read as a local edit and
    the weekly sync updated nothing. A file that equals an older version of the same core file was never edited here and is safe to replace."""
    from . import fleetmap
    return fleetmap.blob_sha(dst.read_bytes()) in fleetmap.history_blobs(core, f"{kernel_root}/{rel}" if kernel_root else rel)


def sync(core: Path, inst: Path, apply: bool = False, force_adopt: bool = False) -> dict:
    """Flow down. Files the instance edited since the last sync are conflicts: kept as they are and reported as upstream candidates."""
    c = json.loads((core / CONTRACT).read_text())
    lock = _load_lock(inst) or {"core": {"repo": c["repo"], "version": "0.0.0"}, "digests": {}}
    cur = kernel_files(core)
    updated, added, removed, conflicts = [], [], [], []
    new_digests = {}
    for rel, sha in cur.items():
        dst = inst / rel
        locked = lock["digests"].get(rel)
        if not dst.exists():
            added.append(rel)
        elif _sha(dst) == sha:
            new_digests[rel] = sha
            continue
        elif locked is not None and _sha(dst) != locked:
            conflicts.append(rel)
            new_digests[rel] = locked  # stays a recorded local edit
            continue
        elif locked is None and not force_adopt and not _older_core_version(core, c["kernel_root"], rel, dst):
            conflicts.append(rel)  # adoption never overwrites an existing file
            continue
        else:
            updated.append(rel)
        new_digests[rel] = sha
        if apply:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(core / c["kernel_root"] / rel, dst)
    for rel in set(lock["digests"]) - set(cur):
        f = inst / rel
        if f.exists() and _sha(f) == lock["digests"][rel]:
            removed.append(rel)
            if apply:
                f.unlink()
    rep = {"from": lock["core"]["version"], "to": c["version"], "added": sorted(added), "updated": sorted(updated),
           "removed": sorted(removed), "conflicts": sorted(conflicts), "applied": apply}
    if apply:
        (inst / LOCK).write_text(json.dumps({"lock": 1, "core": {"repo": c["repo"], "version": c["version"]},
                                             "runtime": lock.get("runtime") or {"repo": c.get("runtime_core", {}).get("repo", ""), "ref": None},
                                             "synced_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                                             "digests": dict(sorted(new_digests.items()))}, indent=1) + "\n")
        (inst / ".ultrastable").mkdir(exist_ok=True)
        (inst / ".ultrastable" / "upgrade-report.json").write_text(json.dumps(rep, indent=1) + "\n")
    return rep


def check(core: Path, inst: Path) -> list[str]:
    """Contract tests, run against any instance (and against a freshly adopted one in the core's CI)."""
    c = json.loads((core / CONTRACT).read_text())
    bad = []
    for rel in c["required_instance_files"]:
        if not (inst / rel).exists():
            bad.append(f"required file missing: {rel}")
    lock = _load_lock(inst)
    if lock is None:
        return bad + [f"{LOCK} missing"]
    if not SEMVER.match(lock["core"]["version"]):
        bad.append("lock version is not semver")
    elif lock["core"]["version"] != "0.0.0" and _major(lock["core"]["version"]) != _major(c["version"]):
        bad.append(f"major version mismatch: pinned {lock['core']['version']}, core {c['version']}; follow the migration note")
    if (inst / "instance.json").exists():
        try:
            bad += [f"instance.json: {p}" for p in mf.validate(json.loads((inst / "instance.json").read_text()))]
        except json.JSONDecodeError as e:
            bad.append(f"instance.json: {e}")
    rp = inst / c.get("runtime_core", {}).get("instance_file", "instance.runtime.json")
    if rp.exists():
        try:
            bad += [f"{rp.name}: {p}" for p in runtime_check(json.loads(rp.read_text()))]
        except json.JSONDecodeError as e:
            bad.append(f"{rp.name}: {e}")
    d = drift(core, inst)
    bad += [f"kernel file missing: {m}" for m in d["missing"]]
    for rel in c["kernel_paths"]:
        for o in OWNED:
            if rel.rstrip("/") == o.rstrip("/"):
                bad.append(f"kernel path {rel} overlaps instance-owned path {o}")
    return bad


def adopt(core: Path, out: Path, name: str, slug: str, kind: str = "other", goal: str = "Run this system on Ultrastable") -> dict:
    """Bring your own repo (or a new idea): additive and idempotent. Existing files are never overwritten."""
    out.mkdir(parents=True, exist_ok=True)
    made = []
    if not (out / "instance.json").exists():
        raw = {"name": name, "slug": slug, "kind": kind, "goals": [goal], "positioning": f"{name} runs on Ultrastable, the foundation for any autonomous system."}
        probs = mf.validate(raw)
        if probs:
            raise ValueError("; ".join(probs))
        (out / "instance.json").write_text(json.dumps(raw, indent=2) + "\n"); made.append("instance.json")
    for rel in ("docs/PROJECT-MEMORY.md", "domain/README.md", "plugins/README.md"):
        p = out / rel
        if not p.exists():
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(f"# {name}: {rel.split('/')[-1][:-3].lower()}\n\nOwned by this instance. The kernel never touches it.\n"); made.append(rel)
    for f in sorted((core / "seed" / "instance-template").rglob("*")):
        if f.is_file():
            rel = f.relative_to(core / "seed" / "instance-template")
            dst = out / rel
            if not dst.exists():
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_text(f.read_text().replace("{slug}", slug).replace("{core_repo}", json.loads((core / CONTRACT).read_text())["repo"])); made.append(rel.as_posix())
    rep = sync(core, out, apply=True)
    rep["created"] = made
    return rep


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="foundation upstream", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("contract"); g = c.add_mutually_exclusive_group(required=True); g.add_argument("--apply", action="store_true"); g.add_argument("--check", action="store_true"); c.add_argument("--version")
    a_ = sub.add_parser("adopt"); a_.add_argument("--out", required=True); a_.add_argument("--name", required=True); a_.add_argument("--slug", required=True); a_.add_argument("--kind", default="other")
    for n in ("sync", "check", "drift"):
        s = sub.add_parser(n); s.add_argument("--instance", required=True); s.add_argument("--core", default=str(REPO))
        if n == "sync":
            s.add_argument("--apply", action="store_true")
        if n == "drift":
            s.add_argument("--json", action="store_true"); s.add_argument("--fail", action="store_true")
    sub.add_parser("leaks")
    a = ap.parse_args(argv)
    if a.cmd == "contract":
        if a.apply:
            (REPO / CONTRACT).write_text(json.dumps(build_contract(REPO, a.version), indent=1) + "\n"); print("wrote", CONTRACT); return 0
        bad = contract_check(); print("\n".join(bad) or "contract ok"); return 1 if bad else 0
    if a.cmd == "leaks":
        bad = leaks(); print("\n".join(bad) or "kernel is free of instance-specific values"); return 1 if bad else 0
    if a.cmd == "adopt":
        print(json.dumps(adopt(REPO, Path(a.out), a.name, a.slug, a.kind), indent=1)); return 0
    core, inst = Path(a.core), Path(a.instance)
    if a.cmd == "sync":
        print(json.dumps(sync(core, inst, a.apply), indent=1)); return 0
    if a.cmd == "check":
        bad = check(core, inst); print("\n".join(bad) or "instance honours the core contract"); return 1 if bad else 0
    d = drift(core, inst); print(json.dumps(d, indent=1) if a.json else f"{d['status']}: behind={d.get('behind')} local_edits={d['local_edits']}")
    return 1 if (a.fail and d["status"] != "in-sync") else 0


if __name__ == "__main__":
    sys.exit(main())

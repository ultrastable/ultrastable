#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""INSTALL-1: the seed as one package, installed with one command (Q-GAP-packaged-installer). Ultrastable is the foundation for any autonomous system.

  python3 seed/install.py pack --out ultrastable-seed.pyz      build the package: every seed file plus a manifest of SHA-256 digests, no repository history
  python3 ultrastable-seed.pyz --into DIR [--idea-file F]      install into a repository: verify every digest, copy what is missing, plan the organization
  python3 ultrastable-seed.pyz verify --into DIR               the installed files still match the package they came from

The package is a Python zip application: one file, standard library only, the same on any host with Python 3.11 or newer. Installing is additive:
a file that already exists in the target is never overwritten (it is listed under `kept`). After the copy the bootstrapper plans the organization
from IDEA.md (dry run, nothing leaves the host); the loops start on the first push, when the seed's own workflow (.github/workflows/bootstrap.yml)
runs the same bootstrapper with --apply on the server. A digest that does not match stops the install with exit code 3 before anything is written.
Consumers: seed/tests/test_install.py, .github/workflows/install-proof.yml (packs, installs into an empty folder and ticks it off Cloudflare).
"""
from __future__ import annotations
import argparse, hashlib, json, subprocess, sys, zipfile
from pathlib import Path

HERE = Path(__file__).resolve()
VERSION = "0.1.0"
MANIFEST, RECORD, PAYLOAD = "MANIFEST.json", "ultrastable.install.json", "seed/"
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".wrangler", "org", ".selfhost"}
SKIP_FILES = {"worker/wrangler.jsonc", "worker/src/config.js", "install.py"}
EXIT_DIGEST = 3


def sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def seed_files(seed: Path) -> dict[str, bytes]:
    out = {}
    for p in sorted(seed.rglob("*")):
        rel = p.relative_to(seed).as_posix()
        if p.is_file() and not (set(p.relative_to(seed).parts[:-1]) & SKIP_DIRS) and rel not in SKIP_FILES and not rel.endswith(".pyc"):
            out[rel] = p.read_bytes()
    return out


def pack(seed: Path, out: Path) -> dict:
    """Deterministic: the same seed tree gives the same bytes (sorted names, fixed timestamps), so the package digest identifies a release."""
    files = seed_files(seed)
    man = {"schema": "ultrastable-seed/1", "version": VERSION, "files": {r: sha(b) for r, b in files.items()}}
    out.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        def put(name, data):
            zi = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0)); zi.compress_type = zipfile.ZIP_DEFLATED; zi.external_attr = 0o644 << 16
            z.writestr(zi, data)
        put("__main__.py", HERE.read_bytes())
        put(MANIFEST, (json.dumps(man, indent=1, sort_keys=True) + "\n").encode())
        for r, b in files.items():
            put(PAYLOAD + r, b)
    return {"package": str(out), "files": len(files), "sha256": sha(out.read_bytes()), "version": VERSION}


def source(src: Path | None):
    """(manifest, read(rel) -> bytes). From a package (the running zip application or --from FILE) or straight from a seed folder."""
    src = src or (HERE.parent if zipfile.is_zipfile(HERE.parent) else None)
    if src is not None and zipfile.is_zipfile(src):
        z = zipfile.ZipFile(src)
        return json.loads(z.read(MANIFEST)), lambda rel: z.read(PAYLOAD + rel)
    seed = src or HERE.parent
    files = seed_files(seed)
    return {"schema": "ultrastable-seed/1", "version": VERSION, "files": {r: sha(b) for r, b in files.items()}}, lambda rel: files[rel]


def install(into: Path, src: Path | None = None, idea_file: Path | None = None, plan: bool = True) -> dict:
    man, read = source(src)
    blobs = {}
    for rel, want in man["files"].items():  # every digest is checked before the first byte is written
        b = read(rel)
        if sha(b) != want:
            return {"ok": False, "exit": EXIT_DIGEST, "error": f"digest mismatch: {rel}"}
        blobs[rel] = b
    into.mkdir(parents=True, exist_ok=True)
    added, kept = [], []
    if idea_file and not (into / "IDEA.md").exists():
        (into / "IDEA.md").write_bytes(Path(idea_file).read_bytes()); kept.append("IDEA.md")  # the person's own idea wins over the template
    for rel, b in blobs.items():
        dst = into / rel
        if dst.exists():
            if rel not in kept:
                kept.append(rel)
            continue
        dst.parent.mkdir(parents=True, exist_ok=True); dst.write_bytes(b); added.append(rel)
    rec = {"schema": "ultrastable-install/1", "version": man["version"], "files": {r: man["files"][r] for r in added}, "kept": sorted(kept)}
    (into / RECORD).write_text(json.dumps(rec, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    out = {"ok": True, "exit": 0, "version": man["version"], "added": len(added), "kept": sorted(kept), "planned": None,
           "next": "push the repository: .github/workflows/bootstrap.yml runs the bootstrapper with --apply on the server and the tick starts"}
    if plan and (into / "bootstrap/bootstrap.py").is_file():
        r = subprocess.run([sys.executable, "bootstrap/bootstrap.py", "--dry-run", "--root", "."], cwd=into, capture_output=True, text=True, timeout=300)
        log = into / "org/boot-log.json"
        stages = json.loads(log.read_text(encoding="utf-8"))["stages"] if log.is_file() else []
        out["planned"] = {"exit": r.returncode, "stages": {s["stage"]: s["status"] for s in stages}, "tail": (r.stdout or r.stderr).strip()[-300:]}
    return out


def verify(into: Path) -> list[str]:
    p = into / RECORD
    if not p.is_file():
        return [f"{RECORD} missing: nothing was installed here"]
    rec, bad = json.loads(p.read_text(encoding="utf-8")), []
    for rel, want in rec["files"].items():
        f = into / rel
        if not f.is_file():
            bad.append(f"missing: {rel}")
        elif sha(f.read_bytes()) != want:
            bad.append(f"changed since install: {rel}")
    return bad


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    cmd = argv.pop(0) if argv and argv[0] in ("pack", "install", "verify") else "install"
    ap = argparse.ArgumentParser(prog="ultrastable-seed " + cmd)
    if cmd == "pack":
        ap.add_argument("--out", type=Path, required=True); ap.add_argument("--seed", type=Path, default=HERE.parent)
        a = ap.parse_args(argv)
        print(json.dumps(pack(a.seed, a.out), indent=1)); return 0
    ap.add_argument("--into", type=Path, required=True)
    if cmd == "verify":
        bad = verify(ap.parse_args(argv).into)
        print("\n".join("install: " + b for b in bad) or "install ok"); return 1 if bad else 0
    ap.add_argument("--from", dest="src", type=Path); ap.add_argument("--idea-file", type=Path); ap.add_argument("--no-plan", action="store_true")
    a = ap.parse_args(argv)
    r = install(a.into, a.src, a.idea_file, plan=not a.no_plan)
    print(json.dumps(r, indent=1)); return r["exit"]


if __name__ == "__main__":
    sys.exit(main())

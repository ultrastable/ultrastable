#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""TENANT-SYNC-1: the core is the only source of generic code; a tenant pins it by hash and never diverges. Generic: knows no tenant name.

A tenant is a test bed. Whatever it builds that is not about its own domain belongs in the core, so the tenant keeps only
(a) a hash-pinned copy of the core under its `vendor_dir`, (b) its own domain code, (c) one-line shims for code that moved up.
All three are checked by this file, which the vendored copy carries, so a tenant checks itself with no network:

  tenant_sync.py check   --tenant DIR [--core DIR]      fails on a hand-edited vendored file, a missing or extra one, a mirror that
                                                        drifted, and any tenant file that looks generic but is not registered
  tenant_sync.py inventory --tenant DIR [--core DIR]    classify every file under the scan roots (JSON)
  tenant_sync.py send-up --tenant DIR --core DIR [--apply]   flow UP: copy hand-edited vendored files and every `lifting` entry into the core
  tenant_sync.py revendor --tenant DIR --core DIR [--apply]  flow DOWN: re-vendor the core, write the new manifest, settle lifted code to shims

The tenant's `upstream.json` (schema tenant-upstream/1) holds the rules and the registry:
  vendor_dir, scan_roots, tokens (regexes naming the tenant's own domain), token_max, min_lines,
  keep    {path: reason}                        tenant-specific code the detector cannot see as such
  lifting {path: {core, item, hold?, mode?}}    generic code on its way up; `hold` is a reason and expires nothing silently
  lifted  {path: core path}                     moved up; the tenant file is a shim (mode shim) or a byte copy of the core file (mirror)
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

CONFIG = "upstream.json"
MANIFEST = "VENDORED_FROM"
SCHEMA = "tenant-upstream/1"
HERE = Path(__file__).resolve().parent
CODE_EXT = {".js", ".mjs", ".py", ".yml", ".yaml", ".sh"}
SHIM_RE = re.compile(r"^\s*export\s+\*\s+from\s+['\"][^'\"]*vendor/[^'\"]+['\"]", re.M)
GENERATED_RE = re.compile(r"\.gen\.(m?js)$|\.generated\.")


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def load(tenant: Path) -> dict:
    cfg = json.loads((tenant / CONFIG).read_text(encoding="utf-8"))
    cfg.setdefault("keep", {}), cfg.setdefault("lifting", {}), cfg.setdefault("lifted", {})
    cfg.setdefault("token_max", 2), cfg.setdefault("min_lines", 8)
    cfg.setdefault("vendor_dir", "vendor/ultrastable")
    return cfg


def save(tenant: Path, cfg: dict) -> None:
    (tenant / CONFIG).write_text(json.dumps(cfg, indent=1, sort_keys=True) + "\n", encoding="utf-8")


def _vendor_tool():
    """The core's own vendoring selection (tools/vendor.py), loaded by path so one rule picks what ships."""
    spec = importlib.util.spec_from_file_location("us_vendor", HERE / "vendor.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


_READER = None


def _reader():
    """tools/vendor.py as the one VENDORED_FROM reader and writer (US-31-R63), loaded by path once. Kept apart from _vendor_tool, which a
    test may replace to choose what ships, so the manifest is always read by the real reader."""
    global _READER
    if _READER is None:
        spec = importlib.util.spec_from_file_location("us_vendor_reader", HERE / "vendor.py")
        _READER = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(_READER)
    return _READER


def read_manifest(tenant: Path, cfg: dict) -> dict:
    """The tenant's VENDORED_FROM in either form (US-31-R63, tools/vendor.py parse_vendored), keyed by the path inside vendor_dir."""
    p = tenant / cfg["vendor_dir"] / MANIFEST
    if not p.is_file():
        return {"files": {}, "commit": None, "form": "json", "source": None, "paths": {}}
    return _reader().parse_vendored(p.read_text(encoding="utf-8"), vendor_rel=cfg["vendor_dir"])


def drift(tenant: Path, cfg: dict | None = None) -> dict:
    """Vendored files against their own manifest. tampered = a hand edit to core code; it must go up or be reverted."""
    cfg = cfg or load(tenant)
    vd, man = tenant / cfg["vendor_dir"], read_manifest(tenant, cfg)
    tampered, missing = [], []
    for f, h in man["files"].items():
        p = vd / f
        if not p.is_file():
            missing.append(f)
        elif sha(p) != h:
            tampered.append(f)
    extra = []
    if vd.is_dir():
        for p in sorted(vd.rglob("*")):
            rel = p.relative_to(vd).as_posix()
            if p.is_file() and rel != MANIFEST and rel not in man["files"] and "node_modules" not in p.parts and "__pycache__" not in p.parts:
                extra.append(rel)
    return {"tampered": tampered, "missing": missing, "extra": extra, "commit": man.get("commit"), "unreadable": man.get("unreadable", [])}


def is_shim(text: str) -> bool:
    return bool(SHIM_RE.search(text))


def tracked(tenant: Path) -> list[str]:
    r = subprocess.run(["git", "ls-files"], cwd=tenant, capture_output=True, text=True)
    if r.returncode == 0 and r.stdout.strip():
        return [f for f in r.stdout.split("\n") if f]
    return [p.relative_to(tenant).as_posix() for p in tenant.rglob("*") if p.is_file() and ".git" not in p.parts]


def inventory(tenant: Path, cfg: dict | None = None, core_hashes: dict | None = None) -> dict:
    """Every code file under the scan roots, outside the vendor dir, in one class. Order: registered, shim, generated, duplicate, specific, candidate."""
    cfg = cfg or load(tenant)
    toks = [re.compile(t, re.I) for t in cfg.get("tokens", [])]
    vd = cfg["vendor_dir"].rstrip("/") + "/"
    roots = [r.rstrip("/") + "/" for r in cfg.get("scan_roots", [])]
    by_hash = {h: f for f, h in (core_hashes or {}).items()}
    out = {"candidate": [], "specific": [], "duplicate": [], "keep": [], "lifting": [], "lifted": [], "generated": []}
    for f in sorted(tracked(tenant)):
        if f.startswith(vd) or Path(f).suffix not in CODE_EXT or not any(f.startswith(r) or f.rsplit("/", 1)[0] + "/" == r for r in roots):
            continue
        p = tenant / f
        if not p.is_file():
            continue
        text = p.read_text(encoding="utf-8", errors="replace")
        if f in cfg["lifted"]:
            out["lifted"].append(f)
        elif f in cfg["lifting"]:
            out["lifting"].append(f)
        elif f in cfg["keep"]:
            out["keep"].append(f)
        elif is_shim(text) and len(text.strip().split("\n")) <= 6:
            out["lifted"].append(f)
        elif GENERATED_RE.search(f):
            out["generated"].append(f)
        elif by_hash.get(sha(p)):
            out["duplicate"].append(f)
        elif len(text.split("\n")) < cfg["min_lines"]:
            out["specific"].append(f)
        elif sum(len(t.findall(text)) for t in toks) > cfg["token_max"]:
            out["specific"].append(f)
        else:
            out["candidate"].append(f)
    return out


def core_hash_map(core: Path | None) -> dict:
    if not core:
        return {}
    v = _vendor_tool()
    return {f: sha(core / f) for f in v.select(core)}


def check(tenant: Path, core: Path | None = None) -> list[str]:
    cfg = load(tenant)
    bad = []
    d = drift(tenant, cfg)
    bad += [f"vendored file edited by hand: {f} (send it up with `send-up`, then re-vendor; never keep a fork)" for f in d["tampered"]]
    bad += [f"vendored file missing: {f}" for f in d["missing"]]
    bad += [f"{MANIFEST} line {n} is unreadable: it records no file, so nothing proves that file unedited" for n in d["unreadable"]]
    bad += [f"unvendored file inside {cfg['vendor_dir']}: {f} (it is core code that is not in the core; send it up)" for f in d["extra"]]
    vd = tenant / cfg["vendor_dir"]
    for mine, theirs in cfg["lifted"].items():
        p, q = tenant / mine, vd / theirs
        if not q.is_file():
            bad.append(f"lifted {mine}: core file {theirs} is not in the vendored copy")
        elif not p.is_file():
            bad.append(f"lifted {mine}: tenant file missing")
        elif cfg["lifted"].get(mine) and not is_shim(p.read_text(encoding="utf-8")) and sha(p) != sha(q):
            bad.append(f"lifted {mine} diverged from core {theirs}: it is neither a shim nor a copy")
    inv = inventory(tenant, cfg, core_hash_map(core))
    bad += [f"duplicate of core code: {f} (delete it and import the core file)" for f in inv["duplicate"]]
    bad += [f"generic-looking code not registered: {f} (lift it into the core: add it to `lifting` with a core path and item, "
            f"or to `keep` with the reason it is tenant-specific)" for f in inv["candidate"]]
    for f in inv["lifting"]:
        e = cfg["lifting"][f]
        if not e.get("core") or not e.get("item"):
            bad.append(f"lifting {f}: needs `core` (target path) and `item` (the loop item that closes it)")
    for f, why in cfg["keep"].items():
        if not str(why).strip():
            bad.append(f"keep {f}: a reason is required")
    return bad


SPDX = ("// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0\n"
        "// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.\n")


def _with_header(text: str, ext: str) -> str:
    if "SPDX-License-Identifier" in text[:400]:
        return text
    if ext in (".js", ".mjs"):
        return SPDX + text
    if ext in (".py", ".sh", ".yml", ".yaml"):
        return SPDX.replace("//", "#") + text
    return text


def send_up(tenant: Path, core: Path, apply: bool = False) -> list[str]:
    """Flow UP into a core checkout. Hand-edited vendored files overwrite their core path; every unheld `lifting` entry is copied to its core path."""
    cfg = load(tenant)
    acts = []
    sources = core_sources(core, read_manifest(tenant, cfg))
    for f in drift(tenant, cfg)["tampered"]:
        dst = sources.get(f)
        if dst is None:
            acts.append(f"unresolved {f}: the record names no core path for it")
            continue
        acts.append(f"edit {f}")
        if apply:
            dst.write_bytes((tenant / cfg["vendor_dir"] / f).read_bytes())
    for f, e in sorted(cfg["lifting"].items()):
        if e.get("hold") or not e.get("core"):
            continue
        dst = core / e["core"]
        text = (tenant / f).read_text(encoding="utf-8")
        text = _with_header(rewrite_imports(text, f, e["core"], cfg), Path(f).suffix)
        if dst.is_file() and dst.read_text(encoding="utf-8") == text:
            continue
        acts.append(f"{'update' if dst.is_file() else 'add'} {e['core']} <- {f}")
        if apply:
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_text(text, encoding="utf-8")
    return acts


def rewrite_imports(text: str, tenant_path: str, core_path: str, cfg: dict) -> str:
    """Relative imports of the vendored core become relative imports inside the core; other relative imports are left as they are."""
    import os
    vd = cfg["vendor_dir"].strip("/")

    def fix(m):
        norm = os.path.normpath(os.path.join(os.path.dirname(tenant_path), m.group(2))).replace(os.sep, "/")
        if not norm.startswith(vd + "/"):
            return m.group(0)
        r = os.path.relpath(norm[len(vd) + 1:], os.path.dirname(core_path) or ".").replace(os.sep, "/")
        return m.group(1) + (r if r.startswith(".") else "./" + r) + m.group(3)

    return re.sub(r"""((?:from|import)\s*\(?\s*['"])(\.{1,2}/[^'"]+)(['"])""", fix, text)


def shim_for(tenant: Path, tenant_file: str, core_file: str, cfg: dict) -> str:
    import os
    rel = os.path.relpath(Path(cfg["vendor_dir"]) / core_file, Path(tenant_file).parent).replace(os.sep, "/")
    rel = rel if rel.startswith(".") else "./" + rel
    src = (tenant / tenant_file).read_text(encoding="utf-8")
    lines = [f'export * from "{rel}";']
    if re.search(r"^export\s+default\b", src, re.M) or re.search(r"export\s*\{[^}]*\bdefault\b", src):
        lines.append(f'export {{ default }} from "{rel}";')
    return SPDX + "// This module lives in the core (TENANT-SYNC-1). This file is a shim; edit the core, never this.\n" + "\n".join(lines) + "\n"


def _repo_root(core: Path) -> Path:
    """The root of the core repository: the text form records core paths from there (seed/worker/src/contract.js), not from workers/."""
    r = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=core, capture_output=True, text=True)
    return Path(r.stdout.strip()) if r.returncode == 0 and r.stdout.strip() else core


def core_sources(core: Path, recorded: dict) -> dict:
    """US-31-R63: each vendored file, named relative to vendor_dir, mapped to the core file it comes from. The JSON form
    keys files by their path in the vendoring selection (relative to core); the text form names each file's core path, relative to the
    repository root. The two key spaces are never compared with each other."""
    if recorded.get("form") == "text":
        root = _repo_root(core)
        return {k: root / cp for k, cp in (recorded.get("paths") or {}).items()}
    return {f: core / f for f in recorded.get("files") or {}}


def _record_keys(core: Path, recorded: dict):
    """Text form (US-31-R63): a function from a core path relative to workers/ (a lifting entry's `core`) to the vendor-directory key the
    record lists for it, or None when the record does not list that core file."""
    import os
    root = _repo_root(core)
    inverse = {os.path.normpath(cp).replace(os.sep, "/"): k for k, cp in (recorded.get("paths") or {}).items()}

    def key(core_rel):
        if not core_rel:
            return None
        rel = os.path.relpath(core / core_rel, root).replace(os.sep, "/")
        return inverse.get(os.path.normpath(rel).replace(os.sep, "/"))
    return key


def revendor(tenant: Path, core: Path, apply: bool = False, commit: str | None = None) -> dict:
    """Flow DOWN: copy the core into vendor_dir, write the manifest, settle lifted code to shims. A JSON-form tenant takes the whole
    vendoring selection; a text-form tenant (US-31-R63) takes exactly the files its record lists, each from its recorded core path, and
    nothing it vendors is removed: a core path that no longer exists is reported in `missing_in_core` and its file and line are kept."""
    cfg = load(tenant)
    vd = tenant / cfg["vendor_dir"]
    recorded = read_manifest(tenant, cfg)
    old = recorded["files"]
    text_form = recorded.get("form") == "text"
    if text_form:
        sources = core_sources(core, recorded)
        missing_in_core = sorted(k for k, p in sources.items() if not p.is_file())
        sources = {k: p for k, p in sources.items() if p.is_file()}
        removed = []
    else:
        files = _vendor_tool().select(core)
        sources = {f: core / f for f in files}
        missing_in_core = []
    new = {f: sha(p) for f, p in sources.items()}
    changed = sorted(f for f in new if old.get(f) != new[f])
    if not text_form:
        removed = sorted(set(old) - set(new))
    # A lifting entry names its core path relative to workers/ (send_up writes core / e["core"]). The JSON form keys `new` the same way;
    # the text form keys it by the path inside the vendor directory, so each entry is resolved through the record first (US-31-R63).
    to_key = _record_keys(core, recorded) if text_form else (lambda c: c)
    settled_keys = {mine: to_key(e.get("core")) for mine, e in cfg["lifting"].items() if e.get("core")}
    settled = sorted(mine for mine, k in settled_keys.items() if k is not None and k in new)
    # Text form: code that reached the core but that the record does not list cannot settle to a shim; it is reported, never dropped.
    unsettled = sorted(mine for mine, e in cfg["lifting"].items() if text_form and e.get("core") and not e.get("hold")
                       and settled_keys.get(mine) is None and (core / e["core"]).is_file())
    result = {"changed": len(changed), "removed": removed, "settled": settled, "files": len(new) + len(missing_in_core)}
    if missing_in_core:
        result["missing_in_core"] = missing_in_core
    if unsettled:
        result["unsettled"] = unsettled
    if not apply:
        return result
    for f in removed:
        (vd / f).unlink(missing_ok=True)
    for f in changed:
        t = vd / f
        t.parent.mkdir(parents=True, exist_ok=True)
        t.write_bytes(sources[f].read_bytes())
    commit = commit or subprocess.run(["git", "rev-parse", "HEAD"], cwd=core, capture_output=True, text=True).stdout.strip()
    # US-31-R63: the manifest is written back in the form the tenant already uses (JSON, or the text form of vendor_sync.mjs).
    if text_form:
        kept = {f: (sha(vd / f) if (vd / f).is_file() else old.get(f)) for f in recorded.get("paths") or {}}
        body = _reader().render_vendored("text", recorded.get("source") or "ultrastable/ultrastable", commit, kept, cfg["vendor_dir"],
                                         recorded.get("paths"))
    else:
        body = _reader().render_vendored("json", "ultrastable/ultrastable:workers", commit, {f: sha(vd / f) for f in new}, cfg["vendor_dir"])
    (vd / MANIFEST).write_text(body)
    for mine in settled:
        e = cfg["lifting"].pop(mine)
        text = shim_for(tenant, mine, settled_keys[mine], cfg)
        (tenant / mine).write_text(text, encoding="utf-8")
        cfg["lifted"][mine] = e["core"]
    for mine, theirs in sorted(cfg["lifted"].items()):
        t = tenant / mine
        key = to_key(theirs)
        if t.is_file() and not is_shim(t.read_text(encoding="utf-8")) and key in new:
            t.write_bytes(sources[key].read_bytes())
    if settled:
        save(tenant, cfg)
    return result


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("cmd", choices=["check", "inventory", "send-up", "revendor"])
    ap.add_argument("--tenant", required=True)
    ap.add_argument("--core")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args(argv)
    tenant, core = Path(a.tenant), Path(a.core) if a.core else None
    if a.cmd == "check":
        bad = check(tenant, core)
        print("\n".join(bad) if bad else "tenant matches its pinned core; no unregistered generic code")
        return 1 if bad else 0
    if a.cmd == "inventory":
        print(json.dumps(inventory(tenant, None, core_hash_map(core)), indent=1))
        return 0
    if not core:
        ap.error("--core required")
    if a.cmd == "send-up":
        acts = send_up(tenant, core, a.apply)
        print("\n".join(acts) if acts else "nothing to send up")
        return 0
    print(json.dumps(revendor(tenant, core, a.apply), indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())

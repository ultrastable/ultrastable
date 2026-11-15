"""Doctrine as code. Ultrastable is the foundation for any autonomous system, and that sentence exists here first.

`doctrine/positioning.json` is the source of truth. `apply` injects the tagline into listed markdown files; `check` fails on
any listed file that lacks it or states a contradiction, and on a missing memory rule. The same file feeds gaplint GL008/GL009
and the new-system generator, so prose never drifts from code.
"""
from __future__ import annotations
import fnmatch, json, re, subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PATH = "doctrine/positioning.json"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def files(root, globs):
    root = Path(root)
    seen = []
    for g in globs:
        seen += [p.relative_to(root).as_posix() for p in sorted(root.glob(g)) if p.is_file()]
    return sorted(set(seen))


def apply(root=REPO) -> list[str]:
    d, root, changed = load(root), Path(root), []
    pat = re.compile(d["pattern"], re.I | re.S)
    for rel in files(root, d["inject"]["md_files"]):
        s = (root / rel).read_text(encoding="utf-8")
        if pat.search(s):
            continue
        lines = s.split("\n")
        quote = rel.startswith(("agents/", "seed/agents/")) or rel.endswith("PROJECT-MEMORY.md")
        line = ("> " if quote else "**") + d["tagline"] + ("" if quote else "**")
        i = next((n for n, l in enumerate(lines) if l.startswith("# ")), None)
        lines[(i + 1 if i is not None else 0):(i + 1 if i is not None else 0)] = ["", line] if i is not None else [line, ""]
        (root / rel).write_text("\n".join(lines), encoding="utf-8")
        changed.append(rel)
    for blk in ("autonomy", "runs_on_itself"):
        r = d.get(blk)
        if not r:
            continue
        rp, line = re.compile(r["pattern"], re.I | re.S), r["line"]
        for rel in files(root, r["md_files"]):
            s = (root / rel).read_text(encoding="utf-8")
            if rp.search(s):
                continue
            lines = s.split("\n")
            at = next((n for n, l in enumerate(lines) if pat.search(l)), None)
            quote = rel.startswith(("agents/", "seed/agents/")) or rel.endswith("PROJECT-MEMORY.md")
            ins = ("> " if quote else "") + line
            if at is None:
                h = next((n for n, l in enumerate(lines) if l.startswith("# ")), -1)
                lines[h + 1:h + 1] = ["", ins]
            else:
                lines[at + 1:at + 1] = ["", ins]
            (root / rel).write_text("\n".join(lines), encoding="utf-8")
            changed.append(f"{rel} ({blk})")
    return changed


def check(root=REPO) -> list[str]:
    d, root, bad = load(root), Path(root), []
    pat = re.compile(d["pattern"], re.I | re.S)
    contra = [re.compile(c, re.I) for c in d["contradictions"]]
    for rel in files(root, d["inject"]["md_files"]) + [r for r in d["inject"]["check_only"] if (root / r).exists()]:
        s = (root / rel).read_text(encoding="utf-8", errors="replace")
        if not pat.search(s):
            bad.append(f"{rel}: lacks the positioning line")
        for c in contra:
            if c.search(s):
                bad.append(f"{rel}: contradicts the positioning ({c.pattern})")
    for rel in d["memory"]["required_in"]:
        p = root / rel
        if p.exists() and not re.search(d["memory"]["required_pattern"], p.read_text(encoding="utf-8"), re.I):
            bad.append(f"{rel}: lacks the memory rule ('{d['memory']['required_pattern']}')")
    banned = [re.compile(b, re.I) for b in d["memory"]["banned_patterns"]]
    for rel in files(root, d["memory"]["scan"]):
        for n, ln in enumerate((root / rel).read_text(encoding="utf-8", errors="replace").splitlines(), 1):
            if any(b.search(ln) for b in banned):
                bad.append(f"{rel}:{n}: relies on external memory")
    lic = d.get("licensing")
    if lic:
        lp = root / lic["license_file"]
        text = lp.read_text(encoding="utf-8") if lp.exists() else ""
        for req in lic["required_patterns"]:
            if req.lower() not in text.lower():
                bad.append(f"{lic['license_file']}: lacks '{req}'")
        banned_lic = [re.compile(b, re.I) for b in lic["banned_patterns"]]
        for rel in files(root, lic["scan"]):
            for n, ln in enumerate((root / rel).read_text(encoding="utf-8", errors="replace").splitlines(), 1):
                if any(b.search(ln) for b in banned_lic):
                    bad.append(f"{rel}:{n}: states or implies a patent filing (patent track dropped 2026-11-11)")
    au = d.get("autonomy")
    if au:
        ap = re.compile(au["pattern"], re.I | re.S)
        ac = [re.compile(c, re.I) for c in au["contradictions"]]
        for rel in files(root, au["md_files"]) + [x for x in au["check_only"] if (root / x).exists()]:
            s = (root / rel).read_text(encoding="utf-8", errors="replace")
            if not ap.search(s):
                bad.append(f"{rel}: lacks the autonomy line ('{au['tagline']}')")
            for c in ac:
                if c.search(s):
                    bad.append(f"{rel}: contradicts the autonomy line ({c.pattern})")
    r = d.get("runs_on_itself")
    if r:
        rp = re.compile(r["pattern"], re.I | re.S)
        rc = [re.compile(c, re.I) for c in r["contradictions"]]
        for rel in files(root, r["md_files"]) + [x for x in r["check_only"] if (root / x).exists()]:
            s = (root / rel).read_text(encoding="utf-8", errors="replace")
            if not rp.search(s):
                bad.append(f"{rel}: lacks the self-hosting line ('{r['tagline']}')")
            for c in rc:
                if c.search(s):
                    bad.append(f"{rel}: contradicts the self-hosting line ({c.pattern})")
        if (root / "instances/ultrastable/selfhost.json").exists():
            from . import selfhost
            bad += [f"selfhost: {x}" for x in selfhost.verify(root)]
    bad += framing_scan(root, d)
    from . import liveness; bad += [f"liveness: {x}" for x in liveness.check(root)] if (root / "instances/ultrastable/liveness.json").exists() else []
    from . import serverside; bad += [f"serverside: {x}" for x in serverside.check(root)] if (root / serverside.PATH).exists() else []
    from . import publication; bad += [f"publication: {x}" for x in publication.check(root)] if (root / publication.PATH).exists() else []
    from . import kernel, loops, glossary, directive
    if (root / kernel.PATH).exists():
        bad += [f"kernel: {x}" for x in kernel.check(root)]
    if (root / loops.PATH).exists():
        bad += [f"loops: {x}" for x in loops.verify(root)]
    if (root / directive.PATH).exists():
        bad += [f"directive: {x}" for x in directive.check(root)]
    if (root / glossary.PATH).exists():
        bad += [f"glossary: {x}" for x in glossary.check(root)]
    for rel in sorted((root / "docs/lessons").glob("*.md")) if (root / "docs/lessons").is_dir() else []:
        if rel.name != "README.md":
            bad += [f"{rel.relative_to(root).as_posix()}:{f['line']}: {f['recognition']} ({f['text'][:50]})" for f in kernel.lint(rel.read_text(encoding="utf-8"))]
    from . import brandcheck
    bad += brandcheck.check(root)
    z = d.get("zero_fuss")
    if z:
        for rel in z["required_in"]:
            p = root / rel
            if p.exists() and not re.search(z["required_pattern"], p.read_text(encoding="utf-8"), re.I):
                bad.append(f"{rel}: lacks the zero-fuss rule ('{z['required_pattern']}')")
        zb = [re.compile(b, re.I) for b in z["banned_patterns"]]
        for rel in files(root, z["scan_user_facing"]):
            for n, ln in enumerate((root / rel).read_text(encoding="utf-8", errors="replace").splitlines(), 1):
                if any(b.search(ln) for b in zb):
                    bad.append(f"{rel}:{n}: makes the user do setup work (zero-fuss rule)")
    if not (root / d["memory"]["canonical"]).exists():
        bad.append(f"{d['memory']['canonical']}: canonical memory file missing")
    return bad


def banned_framing(text: str) -> bool:
    """True when text compares the doctrine with an external rule-set approach. Assembled from fragments so the repository never states it."""
    a, b, c = "constitu", "tion", "al"
    rx = re.compile(a + b + r"(" + c + r")?[\s-]{0,3}(ai|a\.i\.|model|models|claude|anthropic|principles|training|approach|based)\b|external\s+" + a + b, re.I)
    return bool(rx.search(text))


def framing_scan(root, d=None) -> list[str]:
    d = d or load(root)
    root, bad = Path(root), []
    cfg = d.get("banned_framing", {})
    try:
        names = subprocess.run(["git", "-C", str(root), "ls-files"], capture_output=True, text=True, check=True).stdout.splitlines()
    except (OSError, subprocess.CalledProcessError):
        names = [p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file() and ".git" not in p.parts]
    for rel in names:
        if rel in cfg.get("exclude", []):
            continue
        p = root / rel
        try:
            if not p.is_file() or p.stat().st_size > cfg.get("max_bytes", 2000000):
                continue
            raw = p.read_bytes()
        except OSError:
            continue
        if b"\0" in raw[:4096]:
            continue
        for n, ln in enumerate(raw.decode("utf-8", "replace").splitlines(), 1):
            if banned_framing(ln):
                bad.append(f"{rel}:{n}: compares the doctrine with an external approach (say only that it is self-bootstrapped)")
    return bad

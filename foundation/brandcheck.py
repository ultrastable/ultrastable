"""Brand lint. Positioning must be visible on every repo's front page, not only in the monorepo.

`brand/brand.json` names the repos; `brand/tools/sync_repos.py` renders each repo's README block, CONTRIBUTING and SECURITY into
`brand/repos/<name>/` and (with --apply) into the checkout. This check fails when a rendered block is stale, lacks the tagline or the
self-hosting line, misses a link to any repo, names a contact that is not in docs/ops/contact.json, or when an image the block uses is missing.
Run by `python3 -m foundation doctrine --check`.
"""
from __future__ import annotations
import json, re, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def check(root=REPO) -> list[str]:
    root, bad = Path(root), []
    bj = root / "brand/brand.json"
    if not bj.exists():
        return []
    cfg = json.loads(bj.read_text(encoding="utf-8"))
    pos = json.loads((root / "doctrine/positioning.json").read_text(encoding="utf-8"))
    pat = re.compile(pos["pattern"], re.I | re.S)
    rpat = re.compile(pos["runs_on_itself"]["pattern"], re.I | re.S)
    contra = [re.compile(c, re.I) for c in pos["contradictions"] + pos["runs_on_itself"]["contradictions"]]
    banned = [re.compile(b, re.I) for b in pos.get("licensing", {}).get("banned_patterns", [])]
    contacts = set()
    cj = root / "docs/ops/contact.json"
    if cj.exists():
        contacts = {a["address"] for a in json.loads(cj.read_text(encoding="utf-8"))["addresses"]}
    else:
        bad.append("docs/ops/contact.json: missing (where each address is routed and read)")
    for key in ("contact", "security_contact"):
        if cfg[key] not in contacts:
            bad.append(f"brand.json {key} {cfg[key]} is not registered in docs/ops/contact.json")
    # generated images must match the generator
    with __import__("tempfile").TemporaryDirectory() as td:
        r = subprocess.run([sys.executable, str(root / "brand/tools/generate.py")], capture_output=True, text=True, env={**__import__("os").environ, "ULTRASTABLE_BRAND_OUT": td})
        if r.returncode:
            bad.append("brand/tools/generate.py failed: " + r.stderr.strip()[-200:])
        else:
            for f in sorted(Path(td).rglob("*.svg")):
                cur = root / "brand/generated" / f.relative_to(td)
                if not cur.exists() or cur.read_text(encoding="utf-8") != f.read_text(encoding="utf-8"):
                    bad.append(f"brand/generated/{f.relative_to(td)}: stale, run brand/tools/generate.py and render-generated.js")
    if (root / "github/org-settings.json").exists() and subprocess.run([sys.executable, str(root / "brand/tools/sync_settings.py"), "--check"], cwd=root).returncode:
        bad.append("github/org-settings.json: descriptions or topics differ from brand.json, run brand/tools/sync_settings.py")
    seen = {}
    ls = subprocess.run(["git", "-C", str(root), "ls-files"], capture_output=True, text=True)
    for f in ls.stdout.splitlines() if ls.returncode == 0 else []:
        if f.startswith(("ip/", "research/", "kit/", "qnfo-platform-thread/", "outreach/", "instances/ultrastable/funding/applications/")) or not f.endswith((".md", ".json", ".js", ".py", ".yml", ".toml", ".html")):
            continue
        for a in re.findall(r"[A-Za-z0-9._-]+@ultrastable\.(?:io|app|net|org)", (root / f).read_text(encoding="utf-8", errors="replace")):
            seen.setdefault(a.lower(), f)
    for a, f in sorted(seen.items()):
        if contacts and a not in contacts:
            bad.append(f"{f}: address {a} is not registered in docs/ops/contact.json")
    names = [r["name"] for r in cfg["repos"]]
    for r in cfg["repos"]:
        d = root / "brand/repos" / r["name"]
        blk = d / "README.block.md"
        if not blk.exists():
            bad.append(f"{blk.relative_to(root)}: missing, run brand/tools/sync_repos.py")
            continue
        text = blk.read_text(encoding="utf-8")
        for label, ok in (("tagline", pat.search(text)), ("self-hosting line", rpat.search(text)), ("autonomy line", re.search(pos["autonomy"]["pattern"], text, re.I | re.S)), ("license summary", cfg["license"]["summary"] in text)):
            if not ok:
                bad.append(f"{blk.relative_to(root)}: lacks the {label}")
        for n in names:
            if f"github.com/{cfg['org']}/{n}" not in text:
                bad.append(f"{blk.relative_to(root)}: no link to {cfg['org']}/{n}")
        for c in contra + banned:
            if c.search(text):
                bad.append(f"{blk.relative_to(root)}: contradicts positioning ({c.pattern})")
        for img in re.findall(r'src="(assets/brand/[^"]+)"', text):
            if not (root / "brand/generated" / ("cards/" + r["name"] + ".png" if img.endswith("social-card.png") else Path(img).name)).exists():
                bad.append(f"{blk.relative_to(root)}: image {img} has no rendered source")
        for extra in ("CONTRIBUTING.md", "SECURITY.md"):
            if not (d / extra).exists():
                bad.append(f"{(d / extra).relative_to(root)}: missing")
    # the monorepo's own README must carry the current block
    rd = root / "README.md"
    cur = (root / "brand/repos/ultrastable/README.block.md")
    if rd.exists() and cur.exists() and cur.read_text(encoding="utf-8").strip() not in rd.read_text(encoding="utf-8"):
        bad.append("README.md: brand block stale or missing, run brand/tools/sync_repos.py --apply <parent of checkouts>")
    return bad

#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""DOCS-SYNC-1: public docs must be complete and must match the code (front end = back end).

Reads doctrine/readmes.json. For every listed document it checks:
  1. every required section heading is present (a README cannot shrink back to a stub);
  2. every relative link resolves to a file or folder in the repository;
  3. every link to the system's own site (site_host) names a path the site code actually routes (site_globs);
  4. every <!-- claim:ID --> block names a claim registered in doctrine/claims.json (so the number is regenerated, not typed).
--live also fetches each own-site link and fails on a non-2xx answer (second route, run daily server-side).
Exit 1 on any finding. Shared: the seed carries the same file, so every system and tenant inherits it.
"""
import argparse, glob, json, pathlib, re, sys, urllib.request

LINK = re.compile(r"\]\(([^)\s]+)\)")
CLAIM = re.compile(r"<!-- claim:([\w-]+) -->")


def routed(root, globs, path):
    pat = re.compile(r"[\"'`]" + re.escape(path.rstrip("/")) + r"(\.json)?/?[\"'`]")
    return any(pat.search(pathlib.Path(f).read_text(errors="ignore")) for g in globs for f in glob.glob(str(root / g)))


def nearest_claims(root, p):
    """Claims registered for the system the document belongs to: the closest doctrine/claims.json above it."""
    for d in [p.parent, *p.parent.parents]:
        c = d / "doctrine/claims.json"
        if c.exists():
            return set(re.findall(r'"id":\s*"([\w-]+)"', c.read_text()))
        if d == root:
            return None
    return None


def check(root, live=False):
    cfg = json.loads((root / "doctrine/readmes.json").read_text())
    host, globs = cfg.get("site_host"), cfg.get("site_globs", [])
    bad = []
    for doc in cfg["documents"]:
        p = root / doc["path"]
        if not p.exists():
            bad.append(f"{doc['path']}: missing"); continue
        text = p.read_text()
        heads = {h.strip().lower() for h in re.findall(r"^#{1,3} (.+)$", text, re.M)}
        for s in doc.get("sections", []):
            if s.lower() not in heads:
                bad.append(f"{doc['path']}: required section '{s}' missing")
        for target in LINK.findall(text):
            t = target.split("#")[0]
            if not t or t.startswith(("mailto:", "#")):
                continue
            if host and t.startswith(f"https://{host}"):
                path = t[len(f"https://{host}"):] or "/"
                if path != "/" and globs and not routed(root, globs, path):
                    bad.append(f"{doc['path']}: {t} is not routed by the site code")
                elif live:
                    try:
                        urllib.request.urlopen(urllib.request.Request(t, method="GET", headers={"User-Agent": "ultrastable-docs-check"}), timeout=20)
                    except Exception as e:  # recorded as a finding, never swallowed
                        bad.append(f"{doc['path']}: {t} live fetch failed: {e}")
            elif not re.match(r"^[a-z]+:", t):
                if not (p.parent / t).exists():
                    bad.append(f"{doc['path']}: broken link {t}")
        claim_ids = nearest_claims(root, p)
        if claim_ids is not None:
            for cid in CLAIM.findall(text):
                if cid not in claim_ids:
                    bad.append(f"{doc['path']}: claim block '{cid}' is not registered in doctrine/claims.json")
    # 6. outdated wording: phrases that describe a past state of the system (retired repos as live, dropped plans) may not appear on public surfaces
    for term in cfg.get("stale_terms", []):
        for g in cfg.get("stale_globs", []):
            for f in glob.glob(str(root / g), recursive=True):
                if ".test." in f:
                    continue
                for n, line in enumerate(pathlib.Path(f).read_text(errors="ignore").splitlines(), 1):
                    if re.search(term["pattern"], line):
                        bad.append(f"{pathlib.Path(f).relative_to(root)}:{n}: outdated wording ({term['why']})")
    # 5. the site's own pages: every internal href the site code renders must be a path the site code routes (no dead links in the front end)
    srcs = [pathlib.Path(f) for g in globs for f in glob.glob(str(root / g)) if ".test." not in f]
    allsrc = "\n".join(s.read_text(errors="ignore") for s in srcs)
    for h in sorted(set(re.findall(r'href=\\?"(/[a-z0-9][a-z0-9/._-]*)', allsrc))):
        path = h.split("#")[0].rstrip("/")
        if any(path.startswith(x) for x in cfg.get("dynamic_prefixes", [])):
            continue
        if not re.search(r"[\"'`]" + re.escape(path) + r"/?[\"'`]", allsrc):
            bad.append(f"site: {h} is linked but not routed")
    return bad


def archived(root):
    """Retired repositories must point straight at the repository that holds their contents (one hop, no chain)."""
    cfg = json.loads((root / "doctrine/readmes.json").read_text())
    bad = []
    for a in cfg.get("archived_pointers", []):
        url = f"https://raw.githubusercontent.com/{a['repo']}/HEAD/README.md"
        try:
            text = urllib.request.urlopen(url, timeout=20).read().decode()
        except Exception as e:  # unmeasured is a finding, never a pass
            bad.append(f"{a['repo']}: README unreadable: {e}"); continue
        if a["must_point_to"] not in text or any(x in text for x in a.get("must_not_point_to", [])):
            bad.append(f"{a['repo']}: README does not point straight at {a['must_point_to']}")
    return bad


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--archived", action="store_true", help="check retired repositories' pointer READMEs (network)")
    a = ap.parse_args()
    root = pathlib.Path(a.root).resolve()
    bad = archived(root) if a.archived else check(root, a.live)
    for b in bad:
        print("DOCS-SYNC:", b)
    print(f"docs-sync: {len(bad)} finding(s)")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()

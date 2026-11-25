# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""OVERLAP-1 (2026-11-25): two sessions never build the same thing twice.

On 2026-11-25 four sessions built a knowledge-graph engine in parallel within 17 minutes (#2151, #2157, #2158, #2166): three of them added a
migration numbered 0031, two added doctrine/knowledge-graph.json, and two carried the same item id (KGRAPH-1) in their titles. Two were
closed unmerged and the rest hit merge conflicts. Nothing checked open work before a session started or before a PR merged.

  python3 -m foundation overlap --intent "knowledge graph engine"   before starting: open PRs and PRs merged in the last 48 h that share
                                                                     words with the intent, so the session builds on them instead
  python3 -m foundation overlap --check --pr N                       fails when PR N collides with an earlier open PR (same new file,
                                                                     same migration number, or the same item id in the title)
  python3 -m foundation overlap --report                             every collision among open PRs

The earlier PR (by creation time) keeps the work; the later one carries its change onto the earlier one, or is closed as superseded by the
lane. Append-only ledgers and generated files are exempt (every PR touches them). Reads GitHub with GH_TOKEN or GITHUB_TOKEN, else `gh api`;
an unreadable GitHub is reported as unmeasured and never as clean.
"""
from __future__ import annotations
import json, os, re, subprocess, sys, urllib.request
from datetime import datetime, timedelta, timezone

REPO = os.environ.get("GITHUB_REPOSITORY", "ultrastable/ultrastable")
# Paths every PR may add or touch: issue items, ledgers and generated records. A collision there is the lane's merge job, not duplicate work.
EXEMPT = re.compile(r"^(docs/issues/|ops/|doctrine/writeback/|docs/handoff/|research/papers/)|^doctrine/decision-ledger\.json$|-data\.js$|\.jsonl$")
MIGRATION = re.compile(r"^(.*migrations/)(\d{3,5})_[^/]+\.sql$")
ITEM_ID = re.compile(r"\b([A-Z][A-Z0-9]{2,}(?:-[A-Z][A-Z0-9]*)*-\d+)\b")
STOP = set("a an and the of to for in on with is are be by from that this it its as at or into every each all any its own new add adds make".split())


def _api(path: str):
    tok = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if tok:
        req = urllib.request.Request("https://api.github.com/" + path, headers={"authorization": "Bearer " + tok, "accept": "application/vnd.github+json",
                                                                                "user-agent": "ultrastable-overlap"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    out = subprocess.run(["gh", "api", path], capture_output=True, text=True, timeout=60)
    if out.returncode != 0:
        raise RuntimeError("gh api " + path + ": " + out.stderr.strip()[:200])
    return json.loads(out.stdout)


def fetch(repo: str = REPO, state: str = "open", merged_since: str | None = None, with_files: bool = True) -> list[dict]:
    """PRs with their files: [{number, title, created_at, merged_at, added: [...], files: [...]}]. With merged_since, only PRs merged since then."""
    prs = []
    for page in range(1, 4):
        rows = _api(f"repos/{repo}/pulls?state={state}&per_page=100&page={page}&sort=updated&direction=desc")
        prs += rows
        if len(rows) < 100 or (merged_since and rows and (rows[-1].get("updated_at") or "") < merged_since):
            break
    if merged_since:
        prs = [p for p in prs if (p.get("merged_at") or "") >= merged_since]
    out = []
    for p in prs:
        files = _api(f"repos/{repo}/pulls/{p['number']}/files?per_page=100") if with_files else []
        out.append({"number": p["number"], "title": p.get("title") or "", "created_at": p.get("created_at") or "", "merged_at": p.get("merged_at"),
                    "added": [f["filename"] for f in files if f.get("status") == "added"], "files": [f["filename"] for f in files]})
    return out


def collisions(prs: list[dict]) -> list[dict]:
    """Pairs of PRs doing the same work. `later` is the one that yields. Hard kinds: same-new-file, same-migration; soft: same-item."""
    out = []
    prs = sorted(prs, key=lambda p: (p["created_at"], p["number"]))
    for i, a in enumerate(prs):
        for b in prs[i + 1:]:
            same = sorted({f for f in a["added"] if not EXEMPT.search(f)} & {f for f in b["added"] if not EXEMPT.search(f)})
            if same:
                out.append({"earlier": a["number"], "later": b["number"], "kind": "same-new-file", "hard": True, "detail": same[:5]})
            ma = {(m.group(1), m.group(2)) for f in a["added"] if (m := MIGRATION.match(f))}
            mb = {(m.group(1), m.group(2)) for f in b["added"] if (m := MIGRATION.match(f))}
            if ma & mb:
                out.append({"earlier": a["number"], "later": b["number"], "kind": "same-migration", "hard": True, "detail": sorted(d + n for d, n in ma & mb)})
            ids = set(ITEM_ID.findall(a["title"])) & set(ITEM_ID.findall(b["title"]))
            if ids:
                out.append({"earlier": a["number"], "later": b["number"], "kind": "same-item", "hard": False, "detail": sorted(ids)})
    return out


def words(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z][a-z0-9]+", s.lower()) if w not in STOP and len(w) > 2}


def related(intent: str, prs: list[dict], min_shared: int = 2) -> list[dict]:
    """PRs whose title or new file names share at least min_shared words with the intent, best first."""
    want = words(intent); hits = []
    for p in prs:
        have = words(p["title"]) | words(" ".join(re.sub(r"[/_.-]", " ", f) for f in p["added"]))
        shared = want & have
        if len(shared) >= min(min_shared, len(want)):
            hits.append({"number": p["number"], "title": p["title"], "merged_at": p.get("merged_at"), "shared": sorted(shared)})
    return sorted(hits, key=lambda h: -len(h["shared"]))


def main(argv: list[str]) -> int:
    try:
        if argv[:1] == ["--intent"]:
            intent = " ".join(argv[1:])
            open_prs = fetch()
            since = (datetime.now(timezone.utc) - timedelta(hours=48)).strftime("%Y-%m-%dT%H:%M:%SZ")
            merged = fetch(state="closed", merged_since=since, with_files=False)
            hits = related(intent, open_prs + merged)
            for h in hits:
                print(f"#{h['number']} {'merged' if h['merged_at'] else 'open'}: {h['title']}  (shares: {', '.join(h['shared'])})")
            print(f"overlap: {len(hits)} related PRs for {intent!r}; build on them, never beside them" if hits else f"overlap: nothing open or merged in 48 h matches {intent!r}")
            return 0
        prs = fetch()
    except Exception as e:  # noqa: BLE001 - an unreadable GitHub is unmeasured, never clean
        print(f"overlap: unmeasured, GitHub unreadable: {e}")
        return 2
    found = collisions(prs)
    if "--pr" in argv:
        n = int(argv[argv.index("--pr") + 1])
        mine = [c for c in found if c["later"] == n]
        for c in mine:
            print(f"{'FAIL' if c['hard'] else 'WARN'} #{n} {c['kind']} with earlier #{c['earlier']}: {', '.join(c['detail'])} (OVERLAP-1: carry this change onto #{c['earlier']} or renumber)")
        hard = [c for c in mine if c["hard"]]
        print("overlap ok" if not hard else f"overlap: {len(hard)} collisions")
        return 1 if hard and "--check" in argv else 0
    for c in found:
        print(f"{'FAIL' if c['hard'] else 'WARN'} #{c['later']} {c['kind']} with earlier #{c['earlier']}: {', '.join(c['detail'])}")
    print(f"overlap: {len(found)} collisions among {len(prs)} open PRs")
    return 1 if any(c["hard"] for c in found) and "--check" in argv else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

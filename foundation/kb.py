"""Knowledge retrieval: how reference documents are consumed by agents. Ultrastable is the foundation for any autonomous system.

The executor (`foundation/executor.py`, `build_prompt`) calls `retrieve()` for every issue it works. The reference documents named in
`doctrine/doc-consumers.json` under `knowledge.globs` are ranked by word overlap with the issue and the best few are added to the prompt
(capped), so a reference document is read by an agent whenever an item touches its subject. A document that no issue ever matches still
counts only while `python3 -m foundation docs_audit --check` can show it is inside a `knowledge.globs` pattern; the registry lists them.
"""
from __future__ import annotations
import fnmatch, json, re, subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
STOP = set("the a an and or of to in for on with is are be this that it as by from at not no we our you your".split())


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z][a-z0-9-]{2,}", text.lower()) if w not in STOP}


def knowledge_docs(root=REPO) -> list[str]:
    reg = json.loads((Path(root) / "doctrine/doc-consumers.json").read_text(encoding="utf-8"))
    pats = reg["knowledge"]["globs"]
    out = subprocess.run(["git", "-C", str(root), "ls-files"], capture_output=True, text=True, check=True).stdout.splitlines()
    return [f for f in out if f.endswith(".md") and any(fnmatch.fnmatch(f, p) or (p.endswith("/**") and f.startswith(p[:-2])) for p in pats)]


def retrieve(query: str, root=REPO, limit: int = 3, per_doc: int = 2500) -> str:
    """Return the best-matching reference documents for `query` as a prompt block ('' when nothing matches)."""
    q = _words(query)
    scored = []
    for d in knowledge_docs(root):
        try:
            text = (Path(root) / d).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        head = " ".join(re.findall(r"(?m)^#+ (.*)$", text)) + " " + d.replace("/", " ").replace("-", " ")
        score = 3 * len(q & _words(head)) + len(q & _words(text[:4000]))
        if score >= 3:
            scored.append((score, d, text))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return "".join(f"\n--- REFERENCE {d} ---\n{t[:per_doc]}\n" for _, d, t in scored[:limit])

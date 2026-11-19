"""The knowledge write-back path. The system is closed only if what a session learns lands in the repository, so every agent (Claude Code
included) ends a session by writing its decisions, lessons, open loops and term changes here, and CI fails a change that has code but no
write-back.

  python3 -m foundation writeback record --kind lesson|decision|open-loop|term --title T --body B --probe SPEC [--session ID] [--owner ROLE --trigger T] [--term ID --source PATH]
  python3 -m foundation writeback check [--base origin/main] [--head HEAD]   the range has a write-back, every session cites itself, no banned framing in commit messages
  python3 -m foundation writeback outputs DIR... [--ignore GLOB]           files in session output folders that are missing from the repository
"""
from __future__ import annotations
import datetime as dt, fnmatch, hashlib, json, re, subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
LEDGER = "doctrine/decision-ledger.json"
SHARDS = "doctrine/writeback"  # WRITEBACK-SHARD-1: one file per row, so two PRs never edit the same file (the ledger and provenance are folded on main by regen)
LEDGER_DOC = "CLOSED-LOOP-1 write-back: every lesson and decision as a row with a closing probe (file:<path> or grep:<path>::<regex>) that `python3 -m foundation orphans --check` executes on every PR and loop pass. Written by `python3 -m foundation writeback record --kind lesson|decision --probe SPEC`."
WB_PREFIXES = (LEDGER, SHARDS + "/", "doctrine/closed-loop", "doctrine/orphans", "docs/lessons/", "docs/decisions/", "docs/handoff/", "docs/PROJECT-MEMORY.md", "doctrine/glossary.json", "instances/ultrastable/loop-registry.json", "docs/issues/OL-", "ops/spinoff/",
               # WB-SWEEP-1: the branch sweep's own records are its write-back (each PORT item has owner, trigger and probe; the ledger holds every
               # disposition with its reason); without them every sweep PR failed this check (#702, 2026-11-19)
               "docs/issues/PORT-BRANCH-", "ops/branchsweep-ledger.jsonl")
DOC_ONLY = re.compile(r"^(docs/|doctrine/|GLOSSARY\.md$|.*\.md$)")


def ledger_rows(root=REPO) -> list[dict]:
    """Every ledger row: the folded ledger plus shards not yet folded (a PR branch carries its rows as shards)."""
    root = Path(root)
    led = root / LEDGER
    rows = {r["id"]: r for r in (json.loads(led.read_text(encoding="utf-8")).get("rows", []) if led.exists() else [])}
    for f in sorted((root / SHARDS).glob("*.json")):
        r = json.loads(f.read_text(encoding="utf-8"))["row"]
        rows[r["id"]] = r
    return list(rows.values())


def fold(root=REPO) -> dict:
    """Fold shards into doctrine/decision-ledger.json (union by id) and append each one's provenance row, then remove the shards. Idempotent."""
    root = Path(root)
    shards = sorted((root / SHARDS).glob("*.json"))
    if not shards:
        return {"folded": 0}
    led = root / LEDGER
    doc = json.loads(led.read_text(encoding="utf-8")) if led.exists() else {"_doc": LEDGER_DOC, "rows": []}
    have = {r["id"] for r in doc["rows"]}
    for f in shards:
        s = json.loads(f.read_text(encoding="utf-8"))
        r = s["row"]
        if r["id"] not in have:
            doc["rows"].append(r)
            _prov(root, s.get("kind", r["kind"]), s.get("title", r["title"]), s.get("session", ""), f"{LEDGER} ({r['id']})")
    led.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    for f in shards:
        f.unlink()
    return {"folded": len(shards)}


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60] or "note"


def _prov(root, kind: str, title: str, session: str, ref: str) -> str:
    """PROVENANCE-1: a write-back is a decision/lesson row; origin is the agent session that wrote it."""
    from . import provenance
    provenance.record(root, {"class": "agent", "actor": (session or "code-agent")[:40], "channel": "thread"}, "decision" if kind in ("decision", "lesson", "term") else "input", f"{kind}: {title.strip()}"[:200], ref=ref, affected=[ref.split(" ")[0]])
    return ref


def record(root, kind: str, title: str, body: str, *, session: str = "", owner: str = "", trigger: str = "", probe: str = "", term: str = "", source: str = "doctrine/glossary.json", today: str | None = None) -> str:
    from . import kernel, glossary
    root, day = Path(root), today or dt.date.today().isoformat()
    if not title.strip() or not body.strip():
        raise ValueError("a write-back needs a title and a body")
    if kind in ("lesson", "decision"):
        found = kernel.lint(body, kernel.load(root))
        if found:
            raise ValueError("rewrite before recording (the report hands work back or lacks evidence): " + "; ".join(f"{f['recognition']}: {f['text']}" for f in found[:3]))
        # CLOSED-LOOP-1: a lesson or decision is a ledger row with a closing probe that orphans --check executes on every PR and loop pass,
        # never a Markdown page written for a reader.
        if probe.split(":", 1)[0] not in ("file", "grep"):
            raise ValueError("a lesson or decision needs --probe file:<path> or grep:<path>::<regex>: the code or policy that carries it (CLOSED-LOOP-1)")
        rid = f"{kind}-{day}-{_slug(title)}"
        row = {"id": rid, "kind": kind, "date": day, "title": title.strip(), "body": body.strip(), "probe": probe, **({"session": session} if session else {})}
        # WRITEBACK-SHARD-1 (root cause of every PR conflicting): the ledger and provenance are single shared files that each PR appended to, so any two PRs
        # conflicted. A row is now its own file; `fold` (run by regen-generated on main) merges shards into the ledger and provenance and removes them.
        sp = root / SHARDS / f"{rid}.json"
        sp.parent.mkdir(parents=True, exist_ok=True)
        sp.write_text(json.dumps({"row": row, "kind": kind, "title": title.strip(), "session": session}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
        return f"{SHARDS}/{rid}.json"
    if kind == "open-loop":
        if not (owner and trigger and probe):
            raise ValueError("an open loop needs an owner role, a trigger and a closing probe")
        if probe.split(":", 1)[0] not in ("file", "grep", "cmd"):
            raise ValueError("probe must be file:<path>, grep:<path>::<regex> or cmd:<allowed command>")
        # Next number is max+1, never count+1: numbers have gaps (hand-picked ids such as -91), and count+1 overwrote an existing item.
        stem = f"OL-{day.replace('-', '')}-"
        nums = [int(p.stem[len(stem):]) for p in (root / "docs/issues").glob(stem + "*.json") if p.stem[len(stem):].isdigit()]
        iid = f"{stem}{max(nums, default=0) + 1}"
        if (root / "docs/issues" / f"{iid}.json").exists():
            raise ValueError(f"{iid} already exists; refusing to overwrite an open item")
        body_txt = f"**Owner:** {owner}\n**Trigger:** {trigger}\n**Done check:** {probe}\n**Status:** open\n\n{body.strip()}"
        item = {"id": iid, "title": f"{iid}: {title.strip()}", "body": body_txt, "labels": [f"role:{owner}", "open-loop"], "milestone": "Now", "workstream": "Open loops"}
        (root / "docs/issues" / f"{iid}.json").write_text(json.dumps(item, indent=2) + "\n", encoding="utf-8", newline="\n")
        return _prov(root, kind, title, session, f"docs/issues/{iid}.json")
    if kind == "term":
        t = glossary.term_change(root, term, body, title, source, day)
        return _prov(root, kind, title, session, f"doctrine/glossary.json ({t['id']} v{t['version']})")
    raise ValueError(f"unknown kind {kind!r}")


def _git(root, *a) -> str:
    r = subprocess.run(["git", "-C", str(root), *a], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"git {' '.join(a)}: {r.stderr.strip()[:200]}")
    return r.stdout


def check(root=REPO, base="origin/main", head="HEAD") -> list[str]:
    from . import doctrine
    root, bad = Path(root), []
    try:
        mb = _git(root, "merge-base", base, head).strip()
    except RuntimeError as e:
        return [f"no base to compare ({e}); fetch the base branch"] if base != "origin/main" else []
    commits = [c for c in _git(root, "log", "--no-merges", "--format=%H", f"{mb}..{head}").split() if c]
    if not commits:
        return []
    files = [f for f in _git(root, "diff", "--name-only", mb, head).splitlines() if f]
    code = [f for f in files if not DOC_ONLY.match(f) and not f.startswith("tests/")]
    if code and not any(f.startswith(WB_PREFIXES) for f in files):
        bad.append("code changed (" + ", ".join(code[:3]) + (" ..." if len(code) > 3 else "") + ") with no write-back: add a lesson, decision, handoff, open loop or memory update (python3 -m foundation writeback record)")
    msgs = _git(root, "log", "--no-merges", "--format=%H%x1f%B%x1e", f"{mb}..{head}").split("\x1e")
    sessions = set()
    for m in msgs:
        if "\x1f" not in m:
            continue
        sha, text = m.split("\x1f", 1)
        sessions.update(re.findall(r"Claude-Session:\s*\S*?(session_\w+)", text))
        if doctrine.banned_framing(text):
            bad.append(f"commit {sha.strip()[:8]}: message uses a banned framing (the doctrine is self-bootstrapped; say only that)")
    for s in sorted(sessions):
        cited = any(f.startswith(WB_PREFIXES) and (root / f).is_file() and s in (root / f).read_text(encoding="utf-8", errors="replace") for f in files)
        if not cited:
            bad.append(f"session {s} made commits but no write-back file in the range cites it (Session: {s})")
    return bad


def outputs(root, dirs, ignore=()) -> list[str]:
    """Files in session output folders whose content is not in the repository: knowledge that lives only outside."""
    root = Path(root)
    tracked = set()
    for f in _git(root, "ls-files").splitlines():
        p = root / f
        if p.is_file():
            tracked.add(hashlib.sha256(p.read_bytes()).hexdigest())
    missing = []
    for d in dirs:
        for p in sorted(Path(d).rglob("*")):
            if p.is_file() and not any(fnmatch.fnmatch(p.name, g) or fnmatch.fnmatch(str(p), g) for g in ignore):
                if hashlib.sha256(p.read_bytes()).hexdigest() not in tracked:
                    missing.append(f"{p}: not in the repository")
    return missing

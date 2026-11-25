"""SERVER-OWNS-LOOPS-1: every loop declares a server-side owner and at least one server-side path; no loop's completion depends on a client session.

  python3 -m foundation loopowner --check     fails a loop with no server_owner, a client-only path set, or a closing probe/done that names a client session
  python3 -m foundation loopowner --sync      writes the derived server_owner into loops that lack one
  python3 -m foundation loopowner --scan      lists phrases that hand a loop back to the session that opened it (also part of --check)
  python3 -m foundation loopowner --adopt [--apply]   every open PR the lane cannot merge gets queue item docs/issues/OL-PR-<n>.json (owner, trigger, probe); run by scripts/lane.sh
  python3 -m foundation loopowner --closed N  closing probe of OL-PR-N: exit 0 when PR N is merged or closed
Rule and sweeper: doctrine/loop-ownership.json, seed/worker/src/sweeper.js.
"""
from __future__ import annotations
import json, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CLIENT_TEXT = re.compile(r"\b(owner (must|will|to) (merge|click|run|review)|person (merges|runs|closes)|in a (chat|code agent) session|laptop|desktop app)\b", re.I)


def _load(root):
    r = Path(root)
    return json.loads((r / "doctrine/loop-ownership.json").read_text("utf-8")), json.loads((r / "instances/ultrastable/loop-registry.json").read_text("utf-8"))


def derive(loop: dict, owners: list[str]) -> str:
    if loop.get("workflows"):
        return "github-actions"
    return "ultrastable-tick"


def check(root=REPO) -> list[str]:
    pol, reg = _load(root)
    errs = []
    for l in reg["loops"] if isinstance(reg, dict) else reg:
        i = l.get("id")
        if l.get("server_owner") not in pol["server_owners"]:
            errs.append(f"{i}: server_owner missing or not one of {pol['server_owners']}")
        classes = {p.get("class") for p in l.get("paths", [])}
        if not classes & set(pol["server_path_classes"]):
            errs.append(f"{i}: no server-side path (classes: {sorted(classes)}); a loop never closes through a client session alone")
        for k in ("done", "closing_probe", "trigger"):
            if CLIENT_TEXT.search(str(l.get(k, ""))):
                errs.append(f"{i}: {k} depends on a client or a person")
    return errs


# --- no hand-back, and adoption (the lane files the tracked item the same pass; see `adopt.why` in doctrine/loop-ownership.json) ---
import fnmatch, os, subprocess

PATH = "doctrine/loop-ownership.json"
ISSUES = "docs/issues"
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".selfhost"}
FAILED = {"FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "ERROR"}
PR_FIELDS = "number,title,isDraft,mergeable,labels,headRefName,headRefOid,author,statusCheckRollup,files"


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def policy_check(root=REPO) -> list[str]:
    """The rule is in the instruction files, no code or message hands a loop back to the session that opened it, and the lane adoption is wired."""
    d = load(root)
    return data_check(d) + rule_check(root, d) + wiring_check(root, d) + scan(root, d)


def _match(rel: str, globs) -> bool:
    return any(fnmatch.fnmatch(rel, g) for g in globs)


def files(root, d: dict) -> list[str]:
    root, out = Path(root), []
    excluded = [e["path"] for e in d["exclude"]] + [PATH]
    for base, dirs, names in os.walk(root):
        rel_base = Path(base).relative_to(root).as_posix()
        dirs[:] = sorted(n for n in dirs if n not in SKIP_DIRS)
        for n in sorted(names):
            rel = n if rel_base == "." else f"{rel_base}/{n}"
            if _match(rel, d["scan"]) and not _match(rel, excluded):
                out.append(rel)
    return out


def lint(text: str, d: dict) -> list[dict]:
    """Hand-back phrases in one text: [{line, id, text}]. A line that cites or forbids the rule (`excused_by`) is not a match."""
    rules = [(b["id"], re.compile(b["pattern"], re.I)) for b in d["handback"]]
    excused = re.compile(d["excused_by"], re.I)
    out = []
    for n, ln in enumerate(text.splitlines(), 1):
        if excused.search(ln):
            continue
        for bid, rx in rules:
            m = rx.search(ln)
            if m:
                out.append({"line": n, "id": bid, "text": ln[max(0, m.start() - 30):m.end() + 30].strip()})
    return out


def scan(root=REPO, d: dict | None = None) -> list[str]:
    root = Path(root); d = d or load(root)
    why = {b["id"]: b["why"] for b in d["handback"]}
    bad = []
    for rel in files(root, d):
        p = root / rel
        if p.stat().st_size > d["max_bytes"]:
            continue
        try:
            text = p.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        bad += [f"{rel}:{f['line']}: hands a loop back ({f['id']}: {why[f['id']]}): {f['text'][:90]}" for f in lint(text, d)]
    return bad


def rule_check(root, d: dict) -> list[str]:
    root, bad = Path(root), []
    need = re.compile(d["required_pattern"])
    for rel in d["required_in"]:
        p = root / rel
        if not p.is_file() or not need.search(p.read_text(encoding="utf-8")):
            bad.append(f"{rel}: lacks the rule ({d['marker']})")
    return bad


def wiring_check(root, d: dict) -> list[str]:
    root, bad = Path(root), []
    for w in d["wiring"]:
        p = root / w["file"]
        if not p.is_file() or not re.search(w["pattern"], p.read_text(encoding="utf-8")):
            bad.append(f"{w['file']}: not wired ({w['why']})")
    return bad


def data_check(d: dict) -> list[str]:
    bad = []
    for b in d["handback"]:
        try:
            re.compile(b["pattern"])
        except re.error as e:
            bad.append(f"pattern {b['id']}: {e}")
    return bad


# --- adoption: the server takes every pull request the lane cannot merge ---

def state(pr: dict) -> str:
    """Pure: where one open pull request stands. `lane` means the merge lane already drives it (green or still running)."""
    labels = {l["name"] if isinstance(l, dict) else l for l in pr.get("labels") or []}
    if "hold" in labels:
        return "held"
    if pr.get("mergeable") == "CONFLICTING":
        return "conflict"
    if any((c.get("conclusion") or c.get("state") or "").upper() in FAILED for c in pr.get("statusCheckRollup") or []):
        return "ci-failed"
    if "needs-pat" in labels:
        return "needs-pat"
    return "lane"


def item(pr: dict, st: str, d: dict) -> dict:
    """The queue item that makes the server the owner of one pull request. Its closing probe is this module, so the queue closes it by itself."""
    a, n = d["adopt"], pr["number"]
    failed = sorted({c.get("name") or c.get("context") or "?" for c in pr.get("statusCheckRollup") or [] if (c.get("conclusion") or c.get("state") or "").upper() in FAILED})
    paths = [f["path"] if isinstance(f, dict) else f for f in pr.get("files") or []]
    who = (pr.get("author") or {}).get("login", "unknown")
    body = (f"**Owner:** {a['owner']}\n**Trigger:** lane pass: pull request #{n} is {st}\n**Done check:** cmd:python3 -m foundation loopowner --closed {n}\n"
            f"**Prediction:** open_loop_age_hours <= 24 within 24 h\n**Out of scope:** files outside pull request #{n}'s own diff\n**Status:** open\n\n"
            f"{d['marker']}: the server owns pull request #{n} (`{pr.get('headRefName', '')}` at {str(pr.get('headRefOid', ''))[:10]}, opened by {who}): {pr.get('title', '')}. "
            f"The session that opened it is not its closer and is never asked to act. {a['states'][st]}"
            + (f" Failed checks: {', '.join(failed)}." if failed else "")
            + (f" Files ({len(paths)}): {', '.join(paths[:40])}{' ...' if len(paths) > 40 else ''}." if paths else "")
            + f" Closing probe: pull request #{n} is merged or closed.")
    return {"id": f"{a['item_prefix']}{n}", "title": f"{a['item_prefix']}{n}: land or supersede pull request #{n} ({st})", "body": body,
            "labels": ["role:" + a["owner"], "open-loop", "server-owned"], "milestone": "Now", "workstream": "Open loops"}


def _gh(root, *args, timeout=60):
    try:
        p = subprocess.run(["gh", *args], cwd=root, capture_output=True, text=True, encoding="utf-8", timeout=timeout)
    except (OSError, subprocess.SubprocessError) as e:
        return 127, str(e)
    return p.returncode, (p.stdout if p.returncode == 0 else p.stderr or p.stdout)


def adopt(prs: list[dict], root=REPO, apply=False, d: dict | None = None, gh=_gh) -> list[dict]:
    """One row per open pull request. A pull request the lane cannot merge gets its queue item (once) and the server-owned label."""
    root = Path(root); d = d or load(root)
    rows = []
    for pr in prs:
        st = state(pr)
        row = {"pr": pr["number"], "state": st, "owner": "merge-lane" if st == "lane" else d["adopt"]["owner"]}
        if st != "lane":
            it = item(pr, st, d)
            p = root / ISSUES / (it["id"] + ".json")
            row["item"] = it["id"]
            row["filed"] = not p.exists()
            if apply and not p.exists():
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(json.dumps(it, indent=2) + "\n", encoding="utf-8", newline="\n")
                rc, out = gh(root, "pr", "edit", str(pr["number"]), "--add-label", d["adopt"]["label"])
                if rc:
                    # The label is a marker only; the queue item is the owner record. A missing label is created and the edit tried once more.
                    gh(root, "label", "create", d["adopt"]["label"], "--color", "0e8a16", "--description", "A server-side owner holds this loop")
                    rc, out = gh(root, "pr", "edit", str(pr["number"]), "--add-label", d["adopt"]["label"])
                row["labelled"] = rc == 0
                # LANE-DEDUPE-1 (measured on PR 826, 2026-11-20: the same comment five times in four minutes): lane runs overlap before the item file
                # reaches main, so the file check alone races. The PR's own comments are the second, race-free record.
                vc, vout = gh(root, "pr", "view", str(pr["number"]), "--json", "comments", "--jq", f'[.comments[].body | select(contains("queue item `{it["id"]}`"))] | length')
                if vc == 0 and vout.strip() not in ("", "0"):
                    row["commented"] = "already"
                    rows.append(row)
                    continue
                rc, out = gh(root, "pr", "comment", str(pr["number"]), "--body",
                             f"{d['marker']}: this pull request is {st} and the server owns it now: queue item `{it['id']}` (owner {d['adopt']['owner']}, "
                             f"closing probe: merged or closed). The executor lands or supersedes it; nothing is asked of the session that opened it.")
                row["commented"] = rc == 0
        rows.append(row)
    return rows


def closed(n: int, root=REPO, gh=_gh) -> tuple[bool, str]:
    # PR-PROBE-REST-1 (2026-11-21): `gh pr view` needs GraphQL, which cloud agent sessions refuse (HTTP 403), so 108 OL-PR items whose pull
    # request had long merged or closed stayed open. The REST route works on every host; GraphQL stays as the second route.
    repo = os.environ.get("GITHUB_REPOSITORY", "ultrastable/ultrastable")
    rc, out = gh(root, "api", f"repos/{repo}/pulls/{n}", "--jq", 'if .merged then "MERGED" else (.state | ascii_upcase) end')
    if rc:
        rc, out = gh(root, "pr", "view", str(n), "--json", "state", "--jq", ".state")
    st = out.strip()
    return (rc == 0 and st in ("MERGED", "CLOSED")), (st or "unknown")[:120]


def main(argv):
    if "--closed" in argv:
        ok, st = closed(int(argv[argv.index("--closed") + 1]), REPO)
        print(f"pull request {'is ' + st.lower() if ok else 'is not closed: ' + st}")
        return 0 if ok else 1
    if "--adopt" in argv:
        rc, out = _gh(REPO, "pr", "list", "--state", "open", "--base", "main", "--limit", "100", "--json", PR_FIELDS, timeout=120)
        if rc:
            print("loopowner: gh failed: " + out[-300:]); return 2
        rows = adopt(json.loads(out), REPO, apply="--apply" in argv)
        for r in rows:
            print(json.dumps(r))
        owned = [r for r in rows if r["state"] != "lane"]
        print(f"loopowner: open={len(rows)} lane={len(rows) - len(owned)} server-owned={len(owned)} filed-now={sum(1 for r in owned if r.get('filed'))} unowned=0")
        return 0
    if argv[:1] == ["--scan"]:
        bad = scan(REPO)
        print("\n".join(bad) if bad else "loopowner: no hand-back phrase"); return 0
    if argv[:1] == ["--sync"]:
        pol, reg = _load(REPO)
        n = 0
        for l in reg["loops"] if isinstance(reg, dict) else reg:
            if l.get("server_owner") not in pol["server_owners"]:
                l["server_owner"] = derive(l, pol["server_owners"]); n += 1
        (REPO / "instances/ultrastable/loop-registry.json").write_text(json.dumps(reg, indent=2, ensure_ascii=False) + "\n", "utf-8")
        print(f"loopowner: set server_owner on {n} loops"); return 0
    errs = check() + policy_check()
    for e in errs:
        print("FAIL", e)
    print("loopowner ok" if not errs else f"loopowner: {len(errs)} problems")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

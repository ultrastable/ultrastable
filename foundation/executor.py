"""Agent executor: the step of the tick that does the work. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation executor [--apply] [--issue N] [--repo OWNER/REPO]

One run = pick the top open issue in driver order, claim it, ask a model for a change, apply it under a path guard, run the
checks, and open a PR on green (the lane marks it ready and squash-merges it after CI). Every run, success or failure, appends
one provenance row to ops/executor-log.jsonl. Hosts: the Cloudflare tick Worker dispatches `executor.yml` (seed/worker/src/
executor.js); GitHub's own daily schedule and a manual dispatch run the same command, so the loop has two routes and no host
is required. Without --apply nothing is changed on GitHub or in git: the pick, the prompt size and the guard are reported.
"""
from __future__ import annotations
import datetime as dt, json, os, re, shlex, subprocess, sys, urllib.request
from . import queue as qmod
from . import crossrepo
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
LOG = "ops/executor-log.jsonl"
SKIP_LABELS = {"hold", "blocked", "owner", "gate", "identity-bound", "wontfix", "in-progress", "executor-failed"}
CLAIM_LABEL = "in-progress"
DENY_PREFIXES = (".git/", ".github/", "autonomy/", "ops/executor-log")
DENY_NAMES = (".env", "id_rsa", "credentials")
MAX_FILES, MAX_BYTES = 8, 200_000
# Generated files are derived from the queue and docs, so any change makes them stale; the executor regenerates them instead of failing its own checks.
REPAIRS = 2
GENERATORS = [["python3", "-m", "foundation", "publication", "--fix"], ["python3", "-m", "foundation", "claims", "--fix", "--apply"], ["python3", "scripts/build_dashboard.py"], ["python3", "scripts/build_site_roadmap.py"], ["python3", "-m", "foundation", "doctrine", "--apply"], ["python3", "-m", "foundation", "glossary", "--apply"], ["python3", "-m", "foundation", "standards", "--apply"]]
CHECKS = [["python3", "scripts/lint_workflows.py"], ["python3", "-m", "unittest", "discover", "-s", "tests/foundation"]]
TEST_DIR = "tests/foundation"
MAX_TARGETED = 12


class Stall(BaseException):
    """EXEC-WATCHDOG-2: the watchdog's signal. A BaseException, so run()'s `except Exception` (which records provider and check failures) cannot swallow
    it: measured 2026-11-19, 12 of 12 runs recorded `failed: _Stall:` with exit 1 instead of the watchdog's own stalled row."""


LAST_ROW: dict = {}  # the row of the item in progress, so a stall row still says which item, which models and which attempts


def related_tests(files: list[str], root=REPO) -> list[str]:
    """CHECKS-TARGETED-1: the test modules of tests/foundation that exercise the changed files: a changed test module itself, test_<stem>.py, and any
    module that imports or names the changed file. Measured 2026-11-19: the whole suite run serially takes longer than the executor's 10 minute watchdog
    (CI runs it four-way parallel in about 4 minutes), so no run ever reached a pull request. The full suite still gates the merge: the `checks` workflow
    on the pull request is the required status."""
    root, out = Path(root), []
    tests = sorted((root / TEST_DIR).glob("test_*.py"))
    texts = {t.name: t.read_text(encoding="utf-8", errors="replace") for t in tests}
    for f in files:
        name, stem = Path(f).name, Path(f).stem
        if f.startswith(TEST_DIR + "/") and name.startswith("test_") and name in texts:
            out.append(name); continue
        if not f.endswith(CODE_EXT):
            continue
        mod = re.escape(stem)
        pat = re.compile(rf"(?:\bfoundation\.{mod}\b|\bfrom\s+foundation\s+import\s[^\n]*\b{mod}\b|\bimport\s+{mod}\b|{re.escape(f)})")
        out += [n for n, t in texts.items() if n == f"test_{stem}.py" or pat.search(t)]
    return list(dict.fromkeys(out))[:MAX_TARGETED]


def checks_for(files: list[str], root=REPO) -> list[list[str]]:
    """CHECKS-TARGETED-1: the executor's pre-PR checks for one change: the workflow lint, every changed Python file compiles, and the related test
    modules (each one its own process). EXECUTOR_CHECKS=full restores the whole suite."""
    if os.environ.get("EXECUTOR_CHECKS") == "full":
        return CHECKS
    out = [CHECKS[0]]
    py = [f for f in files if f.endswith(".py")]
    if py:
        out.append(["python3", "-m", "py_compile", *py])
    out += [["python3", "-m", "unittest", "discover", "-s", TEST_DIR, "-p", t] for t in related_tests(files, root)]
    return out


DEADLINE: list[float] = []  # monotonic time by which the run must stop starting new work (set by main from the watchdog)
REPAIR_MIN_S = 150  # an attempt (model call, generators, targeted checks) needs about this long; with less left the run ends with its real reasons


def time_left() -> float:
    import time
    return DEADLINE[0] - time.monotonic() if DEADLINE else float("inf")


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


EFFECT_PREFIXES = ("Q-CIFAIL-", "Q-CLAIM", "Q-UNK-", "Q-SELF-", "Q-BUG", "BREACH-", "Q-CRIT")  # EFFECT-1: items whose fix changes running behaviour
EFFECT_LABELS = {"bug", "failing-check", "raises-self"}
CODE_EXT = (".py", ".js", ".mjs", ".cjs", ".ts", ".sh", ".sql")


FOREIGN_CIFAIL = re.compile(r"is failing in ([\w.-]+/[\w.-]+)")


def foreign_cifail(issue: dict, repo: str) -> bool:
    """FOREIGN-FIX-1: a Q-CIFAIL item about another repository's workflow cannot be fixed by editing this repository's files. The executor took
    Q-CIFAIL-practical-solutions-deploy-tenant, patched style.css here, and merged #595 over a red `checks`. Such an item belongs to that
    repository's own lane (ciwatch closes it by probe when that workflow is green); it is never takeable here."""
    m = FOREIGN_CIFAIL.search(str(issue.get("title", ""))) if str(issue.get("number", "")).startswith("Q-CIFAIL-") else None
    return bool(m and m.group(1) != repo)


def effect_tier(issue: dict) -> float:
    """EFFECT-1: 0 for an item with executable effect (a failing check, a claim drift, an unknown, a bug), else 1. The picker takes tier 0 first."""
    names = {(l["name"] if isinstance(l, dict) else l) for l in issue.get("labels", [])}
    n = str(issue.get("number", ""))
    if n.startswith("Q-CLAIM-COVER"):  # a coverage item is often a wording change; it comes after items that change code
        return 0.5
    return 0 if n.startswith(EFFECT_PREFIXES) or names & EFFECT_LABELS else 1


def consumer_gap(files: list[str], root=REPO) -> str | None:
    """EFFECT-1 / CLOSED-LOOP-1: a change must alter running behaviour. It passes when it touches a code file outside docs/, or when every data file it
    writes is named by existing code. Otherwise the reason, fed back to the model as a failed check."""
    real = [f for f in files if not f.startswith(("docs/issues/", "ops/")) and f != "doctrine/decision-ledger.json"]
    if any(f.endswith(CODE_EXT) and not f.startswith("docs/") for f in real):
        return None
    orphans = []
    for f in real:
        r = subprocess.run(["git", "grep", "-l", "-F", f, "--", *[f"*{e}" for e in CODE_EXT], ":(exclude)tests/", ":(exclude)*/test/*"], cwd=root, capture_output=True, text=True)
        if not r.stdout.strip():
            orphans.append(f)
    if orphans or not real:
        return ("the change has no code consumer (CLOSED-LOOP-1): " + (", ".join(orphans) if orphans else "it writes only queue or ops files")
                + ". Change code that runs (a .py or .js file and its test), or make existing code read the file")
    return None


ELISION_RE = re.compile(r"(?:\.\.\.|\u2026)\s*(?:existing|rest of|remaining|unchanged|previous)\b[^\n]{0,40}\b(?:code|file|implementation|logic|functions?)", re.I)


def elision_gap(files: list[str], root=REPO) -> str | None:
    """ELISION-1: a model that answers with a whole file sometimes writes "// ... existing code ..." where the file was, and the change deletes the
    module (#725 cut seed/worker/src/worker-gate.js from 150 lines to 17 that way and stayed open as a PR). A changed file that carries an elision
    marker, or loses more than half of an existing file of 40 lines or more, is refused and the reason is fed back to the model."""
    for f in files:
        path = Path(root) / f
        if not path.is_file() or not f.endswith(CODE_EXT):
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        if ELISION_RE.search(text):
            return f"{f} contains an elision marker in place of code (ELISION-1); change this file with EDIT blocks (FIND lines copied from the file, then REPLACE), not a FILE block"
        r = subprocess.run(["git", "show", f"HEAD:{f}"], cwd=root, capture_output=True, text=True)
        if r.returncode == 0:
            before, after = r.stdout.count(chr(10)), text.count(chr(10))
            if before >= 40 and after < before * 0.5:
                return f"{f} would shrink from {before} to {after} lines (ELISION-1); keep the code the item does not ask to remove: change this file with EDIT blocks (FIND lines copied from the file, then REPLACE), not a FILE block"
    return None


def contract_gap(files: list[str], root=REPO) -> str | None:
    """SCHEMA-KEEP-1 (incident 2026-11-27): executor commit 54d6e57e7 replaced actions-budget.json, the workflow kill-switch config, with an unrelated
    document; every consumer then raised KeyError and main stayed red. A changed JSON object that already exists in HEAD must keep each top-level key it
    had (`_doc` aside): code reads those keys, so a change that drops them is refused and the reason is fed back to the model."""
    for f in files:
        path = Path(root) / f
        if not path.is_file() or not f.endswith(".json"):
            continue
        r = subprocess.run(["git", "show", f"HEAD:{f}"], cwd=root, capture_output=True, text=True)
        if r.returncode != 0:
            continue
        try:
            before, after = json.loads(r.stdout), json.loads(path.read_text(encoding="utf-8"))
        except (ValueError, OSError, UnicodeDecodeError):
            continue
        if isinstance(before, dict) and isinstance(after, dict):
            lost = sorted(k for k in before if k != "_doc" and k not in after)
            if lost:
                return f"{f} would lose the top-level key(s) {', '.join(lost[:6])} that code reads (SCHEMA-KEEP-1); keep every existing key and add yours beside them, or put the new data in a new file with its own reader"
    return None


def priority(issue: dict) -> tuple:
    """Driver order: items with executable effect first (EFFECT-1), then p0..p9 label (lower first), then oldest number."""
    if "score" in issue:  # PRIORITIZE-1: the ranker's score (goal weight, dependency centrality, size, age) replaces label-then-age order
        return (effect_tier(issue), 0, -issue["score"], str(issue["number"]))
    p = 5
    for l in issue.get("labels", []):
        m = re.fullmatch(r"(?:p|priority[:/ -]?)(\d)", l["name"] if isinstance(l, dict) else l, re.I)
        if m:
            p = min(p, int(m.group(1)))
    return (effect_tier(issue), p, issue["number"])


def pick(issues: list[dict], at: dt.datetime | None = None):
    """Top issue the executor may take. A claim older than 2h is stale and does not block."""
    at = at or dt.datetime.now(dt.timezone.utc)
    ok = []
    for i in issues:
        if "pull_request" in i:
            continue
        names = {(l["name"] if isinstance(l, dict) else l) for l in i.get("labels", [])}
        if names & (SKIP_LABELS - {CLAIM_LABEL}):
            continue
        if CLAIM_LABEL in names:
            upd = dt.datetime.fromisoformat(i["updated_at"].replace("Z", "+00:00"))
            if (at - upd).total_seconds() < 7200:
                continue
        ok.append(i)
    return min(ok, key=priority) if ok else None


def safe_path(p: str) -> str | None:
    """None when the path is acceptable, else the reason. The executor never touches workflows, policy, git or secrets."""
    if not p or p.startswith("/") or ".." in Path(p).parts or "\\" in p:
        return "path escapes the repository"
    if p.startswith(DENY_PREFIXES) or Path(p).name in DENY_NAMES:
        return "path is on the deny list (workflows, policy, git, secrets)"
    return None


def apply_edits(edits: list[dict], root=REPO) -> list[str]:
    if not edits or len(edits) > MAX_FILES:
        raise ValueError(f"need 1..{MAX_FILES} files, got {len(edits or [])}")
    total = 0
    from . import agents
    for e in edits:
        why = safe_path(e.get("path", ""))
        if why:
            raise ValueError(f"{e.get('path')!r}: {why}")
        if e.get("edits") and "content" not in e:  # PATCH-EDIT-1: find-and-replace edits are resolved against the file as it stands; nothing is written until every edit of every file resolved
            f = Path(root) / e["path"]
            text = f.read_text(encoding="utf-8") if f.is_file() else ""
            for ed in e["edits"]:
                text = agents.apply_edit(text, str(ed.get("find", "")), str(ed.get("replace", "")), e["path"])
            e["content"] = text
        total += len(e.get("content", ""))
    if total > MAX_BYTES:
        raise ValueError("change is larger than the executor limit")
    out = []
    base = Path(root).resolve()
    for e in edits:
        f = Path(root) / e["path"]
        try:  # RND-1 (adopted from claude-code v2.1.314): a symlink inside the tree must not carry a write outside the working tree
            f.parent.resolve().relative_to(base)
            if f.is_symlink():
                f.resolve().relative_to(base)
        except ValueError:
            raise ValueError(f"{e['path']!r}: resolves outside the working tree")
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(e["content"], encoding="utf-8")
        out.append(e["path"])
    return out


def _public_context(issue: dict) -> str:
    from . import publicread
    return publicread.context(issue, REPO)


def axiom() -> str:
    """The CLOSED-LOOP-AXIOM, loaded from doctrine/closed-loop.json so every prompt carries it (a test fails when it does not)."""
    return json.loads((REPO / "doctrine/closed-loop.json").read_text(encoding="utf-8"))["axiom"]


def build_prompt(issue: dict, tree: str) -> str:
    from . import kb  # reference documents are consumed here: the best matches for this issue are read by the agent
    ref = kb.retrieve(f"{issue['title']} {issue.get('body') or ''}")
    return (axiom() + "\n\n" + json.loads((REPO / "doctrine/standing-order.json").read_text(encoding="utf-8"))["order"] + "\n\n" + json.loads((REPO / "doctrine/self-improvement.json").read_text(encoding="utf-8"))["axiom"] + "\n\nYou are the work step of an autonomous software organization. Resolve this issue with the smallest correct change to the repository. "
            "Reply in exactly this format and nothing else:\n" + agents_block_format() + "\n"
            "Never rewrite a whole existing file: change it with EDIT blocks whose FIND lines are copied exactly from CURRENT FILES below. "
            "Never touch .github/, autonomy/, secrets or git files. Write tests where the change is code. "
            "Every new Markdown file must contain the exact line: Ultrastable is the foundation for any autonomous system. Do not write about memory or chat as storage. Server-side only: never reference localhost, 127.0.0.1 or a listening port; code runs as a Cloudflare Worker or a plain function with injected fetch.\n\n"
            f"ISSUE #{issue['number']}: {issue['title']}\n{(issue.get('body') or '')[:6000]}\n\nREPOSITORY FILES (partial):\n{tree[:6000]}\n"
            + file_context(issue) + (lambda c: f"\n{c[:6000]}\n" if c else "")(_public_context(issue)) + ref)


PATH_RE = re.compile(r"(?<![\w/.-])((?:[\w.-]+/)+[\w.-]+\.(?:py|js|mjs|json|md|sh|sql|html|css|toml|yml))(?![\w/-])")
CONTEXT_FILES, CONTEXT_WHOLE, CONTEXT_EXCERPT = 4, 9000, 7000


def named_files(issue: dict, root=REPO) -> list[str]:
    """Repository files the item names in its title or body, in order of first mention; the item's own file and other queue items are not context."""
    out = []
    for p in PATH_RE.findall(f"{issue.get('title', '')}\n{issue.get('body') or ''}"):
        p = p.lstrip("./")
        if p not in out and not p.startswith(("docs/issues/", "ops/")) and safe_path(p) is None and (Path(root) / p).is_file():
            out.append(p)
    return out[:CONTEXT_FILES]


def excerpt(text: str, terms: list[str], budget: int = CONTEXT_EXCERPT) -> str:
    """The parts of a long file a change is likely to touch: its first lines, every definition line, and a window around each line that carries one
    of `terms`. Gaps are marked with the number of lines left out, so the model sees that the file continues."""
    lines = text.splitlines()
    keep = set(range(min(25, len(lines))))
    for i, l in enumerate(lines):
        if re.match(r"\s*(?:def |class |function |export |async function |const \w+ = (?:async )?\()", l):
            keep.add(i)
    hot = [i for i, l in enumerate(lines) if any(t in l for t in terms)]
    for i in hot[:12]:
        keep.update(range(max(0, i - 12), min(len(lines), i + 13)))
    out, used, prev = [], 0, -1
    for i in sorted(keep):
        if used > budget:
            break
        if i != prev + 1:
            out.append(f"[... {i - prev - 1} lines not shown ...]")
        out.append(lines[i][:400]); used += len(out[-1]) + 1; prev = i
    if prev < len(lines) - 1:
        out.append(f"[... {len(lines) - 1 - prev} lines not shown ...]")
    return "\n".join(out)


def file_context(issue: dict, root=REPO) -> str:
    """PATCH-EDIT-1: the current text of the files the item names, whole when small and as an excerpt when long. Before this the prompt held only file
    names, so a model asked to change site/worker.js had never seen it and replied with a stub."""
    files = named_files(issue, root)
    if not files:
        return ""
    ticked = [t for t in re.findall(r"`([^`\n]{4,60})`", issue.get("body") or "") if "/" not in t and " " not in t]
    words = re.findall(r"[A-Za-z_][\w-]{5,}", f"{issue.get('title', '')} {FIELD_PROBE(issue)}")
    terms = list(dict.fromkeys(ticked + [w for w in words if not w.islower() or "_" in w or "-" in w]))[:12]
    out = ["\nCURRENT FILES (copy FIND lines from here exactly; lines not shown still exist and stay unchanged):"]
    for p in files:
        try:
            text = (Path(root) / p).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        n = text.count(chr(10))
        if len(text) <= CONTEXT_WHOLE:
            out.append(f"--- {p} ({n} lines, complete) ---\n{text}")
        else:
            out.append(f"--- {p} ({n} lines, EXCERPT: use EDIT blocks, never a FILE block) ---\n{excerpt(text, terms)}")
    return "\n".join(out) + "\n"


def FIELD_PROBE(issue: dict) -> str:
    m = re.search(r"^\*\*Done check:\*\*\s*(.+)$", issue.get("body") or "", re.M)
    return m.group(1) if m else ""


def agents_block_format() -> str:
    from . import agents
    return agents.BLOCK_FORMAT


def cf_ready() -> bool:
    return bool(os.environ.get("CLOUDFLARE_API_TOKEN") and os.environ.get("CLOUDFLARE_ACCOUNT_ID"))


def call_cloudflare(prompt: str) -> dict:
    """Second model route (no Anthropic key needed): Workers AI on the account the fleet already holds. Same JSON contract as call_model."""
    acct, tok = os.environ["CLOUDFLARE_ACCOUNT_ID"], os.environ["CLOUDFLARE_API_TOKEN"]
    model = os.environ.get("EXECUTOR_CF_MODEL", "@cf/qwen/qwen2.5-coder-32b-instruct")
    req = urllib.request.Request(f"https://api.cloudflare.com/client/v4/accounts/{acct}/ai/run/{model}", method="POST",
        data=json.dumps({"messages": [{"role": "user", "content": prompt}], "max_tokens": 7000}).encode(),
        headers={"authorization": "Bearer " + tok, "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        text = json.loads(r.read())["result"]["response"]
    if isinstance(text, dict):  # some Workers AI models return the JSON object already parsed
        return text
    s, e = text.find("{"), text.rfind("}")
    return json.loads(text[s:e + 1])


def call_model(prompt: str, key: str | None, model: str | None = None) -> dict:
    if not key:
        from . import agents  # CODE-AGENTS-1: routed by cost across the adapter registry, falling back on failure
        return agents.complete(prompt)[0]
    model = model or os.environ.get("EXECUTOR_MODEL", "claude-sonnet-5-5")
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", method="POST",
        data=json.dumps({"model": model, "max_tokens": 16000, "messages": [{"role": "user", "content": prompt}]}).encode(),
        headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        text = json.loads(r.read())["content"][0]["text"]
    s, e = text.find("{"), text.rfind("}")
    return json.loads(text[s:e + 1])


def sh(argv, root=REPO, timeout=600):
    try:
        r = subprocess.run(argv, capture_output=True, text=True, cwd=root, timeout=timeout)
        return r.returncode, (r.stdout + r.stderr).strip()
    except (OSError, subprocess.TimeoutExpired) as e:
        return 127, f"{type(e).__name__}: {e}"


def ladder_call(prompt: str, attempt: int, root=REPO):
    """LADDER-RESILIENCE-1: the model call for one attempt; a rung's transport failure surfaces as a RuntimeError that run() counts as a failed attempt (FREE-LLM-3),
    so the next attempt escalates to the next rung."""
    from . import agent_ladder
    return agent_ladder.call(prompt, attempt, root=root)


FAIL_ID = re.compile(r"^(?:FAIL|ERROR): (\S+) \(([\w.]+)\)", re.M)
KEEP_ON_CLEAN = ["-e", "docs/issues/Q-SELF-*", "-e", "docs/issues/Q-INTAKE-*", "-e", "ops/selfcode"]  # SELFCODE-1: a retry must not delete the item it is working or the ledger


def failing_tests(output: str) -> list[tuple[str, str]]:
    """(method, dotted id) of every failed or errored unittest in a runner's output."""
    return list(dict.fromkeys(FAIL_ID.findall(output or "")))


def preexisting_failures(tests: list[tuple[str, str]], root=REPO) -> set[str]:
    """BASELINE-1: which of these tests also fail on the committed tree, without the change under test. A red main must not block every agent change:
    only a failure the change introduced counts. The tests are run in a clean worktree of HEAD (a few tests, not the whole suite)."""
    import tempfile
    tmp = tempfile.mkdtemp(prefix="exec-baseline-")
    code, _ = sh(["git", "worktree", "add", "--detach", tmp + "/wt", "HEAD"], root)
    if code:
        return set()
    try:
        argv = ["python3", "-m", "unittest", "discover", "-s", "tests/foundation"]
        for name in dict.fromkeys(m for m, _ in tests):
            argv += ["-k", name]
        _, out = sh(argv, tmp + "/wt", timeout=300)
        return {i for _, i in failing_tests(out)} & {i for _, i in tests}
    finally:
        sh(["git", "worktree", "remove", "--force", tmp + "/wt"], root)


REPO_SLUG = os.environ.get("GITHUB_REPOSITORY", "ultrastable/ultrastable")


def publish_change(repo: str, root, branch: str, subject: str, body: str, remote: bool = False) -> dict:
    """Commit the working tree on `branch` and open it the executor's way: draft PR, marked ready, checks dispatched on the branch (a PR opened with the workflow token
    raises no pull_request event); the lane merges on green. Used by the product manager loop for the items it files."""
    steps = [["git", "checkout", "-B", branch], ["git", "add", "-A", "--", ".", f":!{LOG}"],
             ["git", "-c", "user.name=ultrastable-pm", "-c", "user.email=pm@users.noreply.github.com", "commit", "-m", subject], ["git", "push", "-u", "origin", branch]]
    for s in steps:
        code, o = sh(s, root)
        if code:
            return {"pr": None, "error": f"{' '.join(s[:2])} failed: {o[-200:]}"}
    code, o = sh(["gh", "pr", "create", "-R", repo, "--draft", "--base", "main", "--head", branch, "--title", subject, "--body", body + "\n\nProduct manager pass " + now() + "."], root)
    if code:
        return {"pr": None, "error": "pr create failed: " + o[-200:]}
    pr, res = o.splitlines()[-1], {}
    res["pr"] = pr
    for kick in (["gh", "pr", "ready", pr, "-R", repo], ["gh", "workflow", "run", "ci.yml" if remote else "checks.yml", "-R", repo, "--ref", branch]):
        kc, ko = sh(kick, root)
        if kc:
            res["kick_failed"] = (res.get("kick_failed", "") + f" {' '.join(kick[:3])}: {ko[-120:]}").strip()
    return res


def gh_json(args, root=REPO):
    code, out = sh(["gh"] + args, root, 90)
    if code:
        raise RuntimeError(f"gh {' '.join(args[:3])} failed: {out[-300:]}")
    return json.loads(out or "null")


def log(root, row: dict) -> None:
    p = Path(root) / LOG
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"schema": "ultrastable-executor/1", "at": now(), "host": os.environ.get("ULTRASTABLE_HOST", "unspecified"), **row}) + "\n")
    # PROVENANCE-1: each executor outcome is a change row (origin loop, actor executor); a failure to record never stops the loop but is printed, not swallowed.
    try:
        from . import provenance
        provenance.record(root, {"class": "loop", "actor": "executor", "channel": "pr"}, "change" if row.get("result") in (None, "pr", "verified", "merged") else "incident",
                          f"executor {row.get('result') or row.get('status') or 'run'}: {str(row.get('title') or row.get('item') or row.get('issue') or '')[:120]}",
                          ref=str(row.get("pr") or row.get("issue") or ""), affected=[str(row.get("item") or "queue")], effect={"status": "pending"})
    except Exception as e:  # noqa: BLE001
        print(f"provenance record failed: {e}", file=sys.stderr)


def queue_mode() -> bool:
    """QUEUE-1: the work queue is repository data (docs/issues/*.json, foundation/queue.py), not GitHub Issues, so Issues can stay off on the code
    repository. EXECUTOR_SOURCE=issues restores the old source for a repository that still uses it."""
    return os.environ.get("EXECUTOR_SOURCE", "queue") == "queue"


PORT_ITEM = re.compile(r"^PORT-([a-z0-9]+)", re.I)  # PORT-EXEC-1: a runtime port item is closed by running its adapter verify command, no model


def verify_command(issue: dict) -> str | None:
    """PORT-EXEC-1: the adapter verify command is a `verify:` line in the item body. None when absent."""
    m = re.search(r"^verify:\s*(.+)$", issue.get("body") or "", re.M)
    return m.group(1).strip() if m else None


def port_call(issue: dict, root):
    """PORT-EXEC-1: stands in for the model on a PORT-<runtime> item. Runs the verify command (argv, no shell) and returns the
    evidence file as the change, so the item closes through the same checks, write-back, commit and pull request as any other.
    A failing command raises: the item is recorded failed and stays open."""
    runtime = PORT_ITEM.match(str(issue["number"])).group(1).lower()
    cmd = verify_command(issue)
    code, out = sh(shlex.split(cmd), root, 900)
    if code:
        raise RuntimeError(f"PORT verify failed (exit {code}): {cmd}: {out[-400:]}")
    ev = {"schema": "ultrastable-port-evidence/1", "at": now(), "item": issue["number"], "command": cmd, "exit": code, "output": out[-4000:]}
    return lambda _prompt: {"summary": f"{issue['number']}: adapter verify passed", "files": [{"path": f"ops/port-evidence/{runtime}-verify.json", "content": json.dumps(ev, indent=2) + chr(10)}]}


def ladder_call(prompt: str, attempt: int, root):
    """One rung of the author ladder (#513, FREE-LLM-3). A transport failure is a RuntimeError, which run() counts as a failed attempt, so the next attempt uses the next rung."""
    from . import agent_ladder
    return agent_ladder.call(prompt, attempt, root=root)


# DECISION-METRIC: work-queue-priority
PR_ITEM = re.compile(r"^OL-PR-(\d+)$")
PR_REPAIR_TRIES = 2  # a pull request is repaired in place at most twice; after that the change is redone from main and the pull request is closed as superseded


def pr_repair_failures(item, root=REPO) -> int:
    """How many earlier in-place repairs of this adoption item failed (rows with mode pr-repair), read from the executor log."""
    return sum(1 for r in qmod.executor_rows(root) if str(r.get("issue")) == str(item) and r.get("mode") == "pr-repair" and r.get("result") == "failed")


def pr_repair(issue: dict, repo: str, root=REPO) -> dict | None:
    """PR-REPAIR-1 (OL-20261113-2): an OL-PR-<n> item is a pull request the lane could not merge. The executor repairs that pull request in place
    instead of redoing it from main: it checks out the head branch, merges main in (generated and append-only files are reconciled by
    scripts/resolve_generated.py) and reads the failed check log, which goes into the prompt. Returns {pr, branch, context} with the working tree on
    the head branch, or None (with the tree back where it was) when the pull request is not open, comes from a fork, has already failed
    PR_REPAIR_TRIES repairs, or cannot be reconciled with main; then the caller redoes the change from main and supersedes the pull request."""
    m = PR_ITEM.match(str(issue.get("number")))
    if not m:
        return None
    n = int(m.group(1))
    if pr_repair_failures(issue["number"], root) >= PR_REPAIR_TRIES:
        return None
    try:
        pr = gh_json(["pr", "view", str(n), "-R", repo, "--json", "state,headRefName,isCrossRepository,title,files"], root)
    except (RuntimeError, ValueError):
        return None
    head = (pr or {}).get("headRefName") or ""
    if (pr or {}).get("state") != "OPEN" or pr.get("isCrossRepository") or not head or head in ("main", "master"):
        return None
    _, start = sh(["git", "rev-parse", "HEAD"], root)
    back = lambda: (sh(["git", "merge", "--abort"], root), sh(["git", "checkout", "-f", "--detach", start.strip()], root))
    if sh(["git", "fetch", "origin", f"+refs/heads/{head}:refs/remotes/origin/{head}", "+refs/heads/main:refs/remotes/origin/main"], root)[0] \
            or sh(["git", "checkout", "-B", head, f"origin/{head}"], root)[0]:
        back(); return None
    code, _ = sh(["git", "-c", "user.name=ultrastable-executor", "-c", "user.email=executor@users.noreply.github.com", "merge", "--no-edit", "origin/main"], root)
    if code:  # a conflict: generated and append-only files have a mechanical resolution; anything else is not repairable in place
        sh(["python3", "scripts/resolve_generated.py"], root)
        if sh(["git", "diff", "--name-only", "--diff-filter=U"], root)[1].strip() or \
                sh(["git", "-c", "user.name=ultrastable-executor", "-c", "user.email=executor@users.noreply.github.com", "commit", "--no-edit", "-a"], root)[0]:
            back(); return None
    log_tail = ""
    try:
        runs = gh_json(["run", "list", "-R", repo, "--branch", head, "--status", "failure", "--limit", "1", "--json", "databaseId,name"], root) or []
        if runs:
            log_tail = sh(["gh", "run", "view", str(runs[0]["databaseId"]), "-R", repo, "--log-failed"], root, 90)[1][-4000:]
    except (RuntimeError, ValueError, KeyError):
        log_tail = ""  # no failed run to read (a conflict-only pull request): the merge of main above is the repair
    files = [f.get("path", "") for f in (pr.get("files") or [])][:40]
    ctx = (f"\n\nYOU ARE REPAIRING PULL REQUEST #{n} IN PLACE ({pr.get('title', '')[:160]}). Its branch `{head}` is checked out with main merged in. "
           "Keep its change; fix only what stops it from merging. Files it changes: " + ", ".join(files) + "."
           + (f"\nFAILED CHECK OUTPUT (last lines):\n{log_tail}" if log_tail else "\nNo failed check log is available; make the existing change pass the checks."))
    return {"pr": n, "branch": head, "context": ctx}


def supersede_pr(repo: str, old: int, new: str, root=REPO) -> str | None:
    """Close a pull request whose change now travels in another one, saying which (a superseded pull request never closes silently)."""
    code, o = sh(["gh", "pr", "close", str(old), "-R", repo, "--comment", f"Superseded by {new}: the executor could not repair this branch in place (PR-REPAIR-1), so the change was redone from main."], root)
    return o[-160:] if code else None


BOOKKEEPING = ("docs/issues/", "ops/", "doctrine/writeback/")


def saydo_gap(files) -> str | None:
    """SAY-DO-1: a change that touches only the item file, ledgers and write-backs would close the item without doing it (2026-11-21: PR 836
    'Port EDIT blocks and file context to the Worker executor' changed no code, only its own issue and ledgers). Such a reply is a failed
    attempt, never a pull request; an item that is already done closes through its own closing probe (foundation/dispose.py), not a PR."""
    if files and all(str(f).startswith(BOOKKEEPING) for f in files):
        return "SAY-DO-1: the change touches only " + ", ".join(sorted(files))[:300] + "; it must change the files that do what the item says"
    return None


def trailers(n, row: dict) -> str:
    """ZHC-R7: provenance trailers written by the harness, never by the model, so every executor commit names its agent, model, item and run."""
    models = row.get("models") or ["none"]
    run_id = os.environ.get("GITHUB_RUN_ID", "local")
    return "\n".join([f"Agent: ultrastable-agent/executor", f"Model: {models[-1]}", f"Work-Item: {n}", f"Run-Id: {run_id}",
                      f"Assisted-by: executor:{models[-1]}"])


def run(repo: str, apply: bool = False, issue_no=None, root=REPO, model_call=None, checks=None, remote: bool = False) -> dict:
    """Returns the provenance row. Never raises for a failed step; the failure is the row (and an `executor-failed` label)."""
    root = Path(root)
    qm = queue_mode() and not remote  # EXEC-X: a remote repository (EXECUTOR_TARGET_REPOS) is worked from its own GitHub issues in a clone
    lroot = REPO if remote else root  # the log, the model ladder and its reviewer stay the executor's own, whatever repository is being changed
    if remote and checks is None:
        checks = crossrepo.CHECKS
    issues = crossrepo.takeable(repo, root) if remote else qmod.takeable(root) if qm else gh_json(["api", f"repos/{repo}/issues?state=open&per_page=100"], root)
    if not remote:
        issues = [i for i in issues if not foreign_cifail(i, repo)]  # FOREIGN-FIX-1
    if qm and not issue_no:
        from . import growth  # GROWTH-1: a product manager keeps the backlog from devolving into bug fixes
        from . import rnd  # RND-1: competitor gaps and adopted findings carry a priority the loop computed
        from . import selfcode  # SELFCODE-1: a share of runs goes to the code agent's own findings and trusted issue intake; it runs first so growth.prefer cannot filter them out
        eff = [i for i in issues if effect_tier(i) < 1]  # EFFECT-1: failing checks, claim drift, unknowns and bugs go before the growth mix and R&D boost
        issues = selfcode.prefer(eff, root) if eff else rnd.boost(  # SELFCODE-1 share applies inside the effect tier too
            growth.prefer(selfcode.prefer(issues, root), root), root)
    issue = next((i for i in issues if str(i["number"]) == str(issue_no)), None) if issue_no else pick(issues)
    if not issue:
        row = {"result": "idle", "detail": "no open issue the executor may take", "prediction": "open_issues_takeable <= 0 within 24 h"}
        log(lroot, row); return row
    n = issue["number"]
    row = {"issue": n, "title": issue["title"], "prediction": f"issue_{n}_closed = 1 within 24 h"}
    LAST_ROW.clear(); LAST_ROW.update(row)
    if apply and not remote:  # DECISIONS-1: the pick is scored by whether the item closes inside its window
        from . import decisions
        decisions.record(root, "work-queue-priority", f"issue {n}", str(n), 1.0, f"driver order pick of {len(issues)} takeable items: {str(issue['title'])[:120]}", alternatives=max(0, len(issues) - 1))
    key = os.environ.get("ANTHROPIC_API_KEY")
    port = bool(qm and model_call is None and PORT_ITEM.match(str(n)) and verify_command(issue))  # PORT-EXEC-1: queue items only; a remote issue body is never run as a command
    from . import agent_ladder  # SYS-2: which model writes the change, who reviews it and what it cost
    from . import mechfix  # MECH-FIX-1: a mechanical item needs no model credential
    mech = bool(qm and model_call is None and mechfix.call_for(issue, root))
    if model_call is None and not port and not mech and not key and not cf_ready() and not agent_ladder.rungs(root):
        row.update(result="no-model-credential", detail="ANTHROPIC_API_KEY is not bound on this host; recorded as a failure (docs/failures/). The Claude-session route (a cloud-hosted routine that starts a Claude session, which runs --pick and --record) takes the item without any key")
        log(lroot, row); return row
    if not apply:
        row.update(result="dry-run", detail="would claim, change, check and open a PR")
        return row
    gi = (lambda *a, **k: (0, "")) if qm else sh  # queue items carry no remote labels or comments; the log row is the claim
    gi(["gh", "issue", "edit", str(n), "-R", repo, "--add-label", CLAIM_LABEL], root)
    gi(["gh", "issue", "comment", str(n), "-R", repo, "--body", f"claim: executor {now()}"], root)
    try:
        _, tree = sh(["git", "ls-files"], root)
        branch = f"agent/{n}-{re.sub(r'[^a-z0-9]+', '-', issue['title'].lower())[:40].strip('-')}"
        repair = pr_repair(issue, repo, root) if qm and PR_ITEM.match(str(n)) else None  # PR-REPAIR-1: an adopted pull request is repaired on its own branch
        if repair:
            branch = repair["branch"]; row.update(mode="pr-repair", repairs_pr=repair["pr"])
            _, tree = sh(["git", "ls-files"], root)
        else:
            sh(["git", "checkout", "-B", branch], root)
        if port:
            model_call = port_call(issue, root)
        if qm and model_call is None:  # MECH-FIX-1: a finding the syntax tree fully determines is fixed by code; no model call, and the same scope check, checks and PR follow
            from . import mechfix
            model_call = mechfix.call_for(issue, root)
            if model_call:
                row["models"] = ["mechfix"]
        base_prompt = lambda: build_prompt(issue, tree) + (repair["context"] if repair else "")
        prompt, failed, files, out = base_prompt(), [], [], {}
        for attempt in range(REPAIRS + 1):  # REPAIR-1: a failed check is fed back to the model; the change is only abandoned after the last try
            if attempt and time_left() < REPAIR_MIN_S:  # EXEC-WATCHDOG-2: end with the real reasons rather than be cut off by the watchdog mid-attempt
                row["out_of_time"] = f"{int(time_left())} s left before attempt {attempt + 1}"
                break
            failed = []
            LAST_ROW.update(row)
            try:
                if model_call:
                    out, meta = model_call(prompt), {}
                else:
                    out, meta = ladder_call(prompt, attempt, lroot)
                    row.setdefault("models", []).append(meta["model"])
                if str(n).startswith(("Q-SELF-", "Q-INTAKE-")):  # SELFCODE-1 (every Q-SELF item, hand-filed ones too): the self-code loop writes only inside the allowlist of doctrine/selfcode.json, checked before anything is written
                    from . import selfcode
                    bad = selfcode.scope_violation([e.get("path", "") for e in out["files"]], lroot)
                    if bad:
                        raise ValueError("outside the self-code scope: " + ", ".join(bad))
                files = apply_edits(out["files"], root)
            except (ValueError, KeyError, TypeError, OSError, AttributeError, RuntimeError) as e:  # FREE-LLM-3: a provider failure (RuntimeError) also moves to the next rung instead of ending the run; unusable reply (bad JSON, missing files): counts as a failed attempt, not a crash
                failed.append("the reply was not valid JSON with a files list: " + type(e).__name__ + ": " + str(e)[:300])
                row.setdefault("attempts", []).append([failed[-1][:400]])
                if attempt < REPAIRS:
                    prompt = base_prompt() + chr(10) * 2 + "YOUR PREVIOUS REPLY COULD NOT BE USED (" + failed[0] + "). Do NOT reply with JSON this time. Reply in exactly this format instead:" + chr(10) + agents_block_format()
                continue
            gap = (consumer_gap(files, root) if checks is None and not port else None) or elision_gap(files, root) or contract_gap(files, root) or saydo_gap(files)
            if gap:
                failed.append(gap)
            if checks is None and not gap:
                for g in GENERATORS:
                    sh(g, root)
            run_checks = [] if gap else checks if checks is not None else checks_for(files, root)
            if checks is None and not gap:
                row["checks"] = [" ".join(c[-1:] if "-p" in c else c[:3]) for c in run_checks]
            for c in run_checks:
                code, o = sh(c, root, timeout=max(30, min(600, int(time_left()) - 20)))
                if code:
                    tests = failing_tests(o)
                    if tests and checks is None and set(i for _, i in tests) <= preexisting_failures(tests, root):
                        row.setdefault("baseline_failures", sorted(i for _, i in tests))  # BASELINE-1: red before the change, so not this change's failure
                        continue
                    heads = "; ".join(i for _, i in tests)[:600]
                    failed.append(f"{' '.join(c)}: " + (f"FAILING TESTS: {heads}. " if heads else "") + o[-2500:])
            if not failed and model_call is None:
                rv = agent_ladder.review(issue, out, meta.get("family", ""), root=lroot)
                row["review"] = rv
                if not rv["approve"]:
                    failed.append("independent reviewer (" + str(rv.get("model")) + ") vetoed the change: " + "; ".join(rv["reasons"]))
            if not failed:
                break
            row.setdefault("attempts", []).append([f[:400] for f in failed][:3])  # FREE-LLM-1: every failed attempt's reasons, not only the last
            sh(["git", "checkout", "--", "."], root); sh(["git", "clean", "-fd", *KEEP_ON_CLEAN], root)
            prompt = base_prompt() + chr(10) * 2 + "YOUR PREVIOUS ATTEMPT FAILED THESE CHECKS; fix exactly these problems and reply in the same EDIT and FILE block format again:" + chr(10) + chr(10).join(failed)[:5000]
        if failed:
            raise RuntimeError("checks failed after " + str(len(row.get("attempts", [])) or REPAIRS + 1) + " attempts: " + " | ".join(failed))
        if not repair:  # SUBSTANCE-1 (Rowan, 2026-11-21): a change that alters no executable behaviour (a bumped number, a hash, an unused import, records only) opens no PR, runs no CI and deploys nothing
            from . import substance
            sub = substance.classify_range(None, root)
            row["substance"] = sub["verdict"]
            if sub["verdict"] != "substantive":
                raise RuntimeError("rejected-trivial (SUBSTANCE-1): the change alters no executable behaviour (" + sub["verdict"] + ": "
                                   + ", ".join(f"{x['path']}={x['kind']}" for x in sub["files"][:8]) + "); no PR is opened for it")
        row.update(files=files, summary=out.get("summary", ""))
        # WRITEBACK-1: the `checks` write-back gate fails any change that has code and no write-back (the first live executor PR failed on it), so
        # the executor records its own decision in the same commit: what it did, the evidence (checks that passed) and a file probe.
        probe_file = next((f for f in files if f != qmod.QUEUE_GLOB and not f.startswith("docs/issues/")), files[0] if files else "docs/issues")
        wc, wo = (0, "") if remote else sh(["python3", "-m", "foundation", "writeback", "record", "--kind", "decision", "--title", f"Executor closed {n}: {out.get('summary', issue['title'])}"[:140],
                     "--body", f"Measured: checks passed before the PR ({', '.join(' '.join(c) for c in (checks if checks is not None else CHECKS))}); files changed: {', '.join(files)}.",
                     "--owner", "executor", "--probe", f"file:{probe_file}"], root)
        if wc:
            raise RuntimeError("write-back failed: " + wo[-300:])
        if qm:
            qmod.close(root, n, "closed by the pull request that carries this change")  # merging the PR closes the item: no remote state to update
        if checks is None and not remote:
            for g in GENERATORS:
                gc, go = sh(g, root)
                if gc:
                    raise RuntimeError("generator failed: " + " ".join(g) + ": " + go[-300:])
        sh(["git", "add", "-A", "--", ".", f":!{LOG}"], root)
        sh(["git", "-c", "user.name=ultrastable-executor", "-c", "user.email=executor@users.noreply.github.com", "commit", "-m", f"{out.get('summary', issue['title'])} (#{n})", "-m", trailers(n, row)], root)
        code, o = sh(["git", "push", "-u", "origin", branch], root)
        if repair:  # the pull request already exists: the push is the repair. Never force a branch another actor opened; a rejected push is this run's failure.
            if code:
                raise RuntimeError("push to the pull request branch failed: " + o[-300:])
            row.update(result="pr-repaired", pr=f"https://github.com/{repo}/pull/{repair['pr']}")
            for kick in (["gh", "pr", "ready", str(repair["pr"]), "-R", repo], ["gh", "workflow", "run", "checks.yml", "-R", repo, "--ref", branch]):
                kc, ko = sh(kick, root)
                if kc:
                    row["kick_failed"] = (row.get("kick_failed", "") + f" {' '.join(kick[:3])}: {ko[-120:]}").strip()
            log(lroot, row)
            return row
        if code and "rejected" in o and branch.startswith("agent/"):
            # STALE-BRANCH-1: the branch name is derived from the item, so a branch left by an earlier attempt whose PR was closed rejects every new
            # attempt (Q-GATE-403 failed three runs in a row on 2026-11-20). The branch is the executor's own: this attempt, built from main, replaces it.
            sh(["git", "fetch", "origin", f"+refs/heads/{branch}:refs/remotes/origin/{branch}"], root)
            code, o = sh(["git", "push", "--force-with-lease", "-u", "origin", branch], root)
        if code:
            raise RuntimeError("push failed: " + o[-300:])
        body = f"Closes #{n}\n\nExecutor run {now()}. Checks passed before the PR: {', '.join(' '.join(c) for c in (checks if checks is not None else CHECKS))}.\nProvenance: {LOG} on branch loop-evidence. The lane merges on green CI."
        code, o = sh(["gh", "pr", "create", "-R", repo, "--draft", "--base", "main", "--head", branch, "--title", f"{out.get('summary', issue['title'])} (#{n})", "--body", body], root)
        if code:
            raise RuntimeError("pr create failed: " + o[-300:])
        row.update(result="pr-opened", pr=o.splitlines()[-1])
        if qm and PR_ITEM.match(str(n)):  # redone from main (not repairable in place, or two repairs failed): the old pull request is superseded by this one
            err = supersede_pr(repo, int(PR_ITEM.match(str(n)).group(1)), row["pr"], root)
            row.update(superseded_pr=int(PR_ITEM.match(str(n)).group(1)), **({"supersede_failed": err} if err else {}))
        # A PR opened with GITHUB_TOKEN raises no pull_request event, and a draft runs no CI, so the executor starts the loop itself: mark ready,
        # dispatch checks on the branch (workflow_dispatch is allowed for the token); the lane merges when that run completes green.
        for kick in (["gh", "pr", "ready", row["pr"], "-R", repo], ["gh", "workflow", "run", "ci.yml" if remote else "checks.yml", "-R", repo, "--ref", branch]):
            kc, ko = sh(kick, root)
            if kc:
                row["kick_failed"] = (row.get("kick_failed", "") + f" {' '.join(kick[:3])}: {ko[-120:]}").strip()
        log(lroot, row)
    except Exception as e:  # recorded, labelled, never swallowed
        row.update(result="failed", detail=f"{type(e).__name__}: {str(e)[:600]}")
        from . import publicread
        if publicread.is_reach_error(row["detail"]) and publicread.mentioned(f"{issue['title']} {issue.get('body') or ''}") and publicread.works(publicread.mentioned(f"{issue['title']} {issue.get('body') or ''}")[0]):
            # A public route exists: do not label executor-failed; release the claim so the next tick retries with public history in the prompt.
            row.update(result="retry-public", detail=row["detail"] + " | public unauthenticated read works; retrying next tick through it")
            gi(["gh", "issue", "edit", str(n), "-R", repo, "--remove-label", CLAIM_LABEL], root)
            log(lroot, row)
            return row
        gi(["gh", "issue", "edit", str(n), "-R", repo, "--remove-label", CLAIM_LABEL, "--add-label", "executor-failed"], root)
        gi(["gh", "issue", "comment", str(n), "-R", repo, "--body", f"executor failed: {row['detail']}\n\nA failure is a backlog item: remove `executor-failed` to retry, or the next tick with a different provider takes it."], root)
        log(lroot, row)
    return row


def pick_row(repo: str, root=REPO) -> dict:
    """The pick alone: what a model session (any host, no API key) should work next. Same driver order as run()."""
    issue = pick(qmod.takeable(root) if queue_mode() else gh_json(["api", f"repos/{repo}/issues?state=open&per_page=100"], root))
    if not issue:
        return {"result": "idle", "detail": "no open issue the executor may take"}
    return {"result": "picked", "issue": issue["number"], "title": issue["title"], "body": (issue.get("body") or "")[:6000]}


def fold_outcomes(root=REPO, apply=False, pr_state=None) -> dict:
    """PR-OUTCOME-1 (Q-GAP-executor-merged-pr): what became of every pull request the executor opened, written to the log on main. The executor's rows
    live on the evidence branch and say only `pr-opened`; whether the change merged was never recorded, so "the executor merges its own work" could not be
    read from the repository. One row per pull request and outcome: `pr-merged` or `pr-closed` (closed without merging). An open or unreadable pull request
    writes nothing: an outcome is never guessed. Runs after every merge (scripts/regen_generated.py)."""
    from . import queue as qmod, selfcode
    root, state = Path(root), pr_state or selfcode.pr_state
    logp = root / "ops/executor-log.jsonl"
    have = set()
    for line in (logp.read_text(encoding="utf-8").splitlines() if logp.is_file() else []):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if r.get("result") in ("pr-merged", "pr-closed"):
            have.add(r.get("pr"))
    out = {"merged": [], "closed": [], "open": [], "unreadable": [], "applied": apply}
    for r in qmod.executor_rows(root):
        url = r.get("pr")
        if r.get("result") != "pr-opened" or not url or url in have:
            continue
        s = state(url, root)
        if not s or not s.get("state"):
            out["unreadable"].append(url); continue
        if s["state"] == "OPEN":
            out["open"].append(url); continue
        merged = s["state"] == "MERGED"
        out["merged" if merged else "closed"].append(url); have.add(url)
        if apply:
            row = {"schema": "ultrastable-executor/1", "at": s.get("mergedAt") or now(), "host": "pr-outcome", "issue": r.get("issue"), "result": "pr-merged" if merged else "pr-closed",
                   "pr": url, "opened_at": r.get("at"), "models": r.get("models") or []}
            if merged and s.get("mergeCommit"):
                row["merge_commit"] = s["mergeCommit"].get("oid")
            logp.parent.mkdir(parents=True, exist_ok=True)
            with logp.open("a", encoding="utf-8") as f:
                f.write(json.dumps(row) + "\n")
    return out


def main(argv=None) -> int:
    import argparse
    ap = argparse.ArgumentParser(prog="foundation executor")
    ap.add_argument("--fold", action="store_true", help="record what became of every pull request the executor opened (PR-OUTCOME-1)")
    ap.add_argument("--apply", action="store_true"); ap.add_argument("--issue")
    ap.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", "ultrastable/ultrastable"))
    ap.add_argument("--pick", action="store_true", help="print the top takeable issue and exit; needs no model credential (Claude-session route)")
    ap.add_argument("--record", action="store_true", help="append one provenance row for work done by a model session (with --issue --result [--pr --detail --host])")
    ap.add_argument("--result"); ap.add_argument("--pr"); ap.add_argument("--detail", default=""); ap.add_argument("--host", default="claude-session")
    a = ap.parse_args(argv)
    if a.fold:
        print(json.dumps(fold_outcomes(apply=a.apply), indent=1)); return 0
    if a.pick:
        row = pick_row(a.repo)
        print(json.dumps(row, indent=2)); return 0
    if a.record:
        if not (a.issue and a.result):
            ap.error("--record needs --issue and --result")
        row = {"issue": a.issue, "result": a.result, "detail": a.detail, "prediction": f"issue_{a.issue}_closed = 1 within 24 h"}
        if a.pr:
            row["pr"] = a.pr
        os.environ["ULTRASTABLE_HOST"] = a.host
        log(REPO, row); print(json.dumps(row, indent=2)); return 0
    # EXEC-WATCHDOG-1: a hung step (measured 2026-11-19: the job ran its full 12 minutes and was cancelled with no row written, so the
    # executor clock read stale for 160 h) ends itself at 10 minutes, records the stall as a row and exits clean.
    import signal, time
    def _stall(*_):
        raise Stall()
    limit = int(os.environ.get("EXECUTOR_WATCHDOG_S", "600"))
    DEADLINE[:] = [time.monotonic() + limit]
    if hasattr(signal, "SIGALRM"):
        signal.signal(signal.SIGALRM, _stall); signal.alarm(limit)
    LAST_ROW.clear()
    try:
        row = run(a.repo, a.apply, a.issue)
    except Stall:
        row = {**LAST_ROW, "result": "stalled", "detail": "executor watchdog: no result within the time limit; the item is retried next run", "prediction": "executor_rows_24h >= 1 within 24 h"}
        log(REPO, row); print(json.dumps(row, indent=2)); return 0
    if row["result"] in ("idle", "failed", "no-model-credential") and not a.issue:  # EXEC-X: own queue empty or its top item failed (e.g. needs a protected path), so work the target repositories' issues (EXECUTOR_TARGET_REPOS)
        for target in crossrepo.targets():
            try:
                root = crossrepo.clone(target) if a.apply else REPO
                row = run(target, a.apply, None, root=root, remote=True)
            except Stall:
                row = {"result": "stalled", "detail": f"executor watchdog while working {target}", "prediction": "executor_rows_24h >= 1 within 24 h"}
                log(REPO, row); break
            except Exception as e:  # a target that cannot be reached must not hide the next one
                row = {"result": "failed", "detail": f"{target}: {type(e).__name__}: {str(e)[:300]}"}
                log(REPO, row)
            if row["result"] not in ("idle", "failed"):
                break
    print(json.dumps(row, indent=2))
    if row["result"] == "no-model-credential":
        print("::warning::executor has no model credential on this host; recorded")
    return 1 if row["result"] == "failed" else 0

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SELFCODE-1: the self-improving code loop. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation selfcode --sense [--tests] [--apply]   measure signals about the repository; with --apply file the top ones as Q-SELF-* queue items (and trusted GitHub issues as Q-INTAKE-*)
  python3 -m foundation selfcode --settle [--apply]            score each merged agent change against its signal; revert a regression; write the kept/reverted outcome
  python3 -m foundation selfcode --probe KIND KEY              closing probe: exit 0 when that signal no longer fires
  python3 -m foundation selfcode --status                      per-kind kept rate and which kinds the loop has paused
  python3 -m foundation selfcode --check

The loop: signals (failing tests, failing CI on main, open unknowns, unused imports, swallowed errors, TODOs, trusted issues labelled `agent-task`) -> queue item with a closing
probe -> the executor's model ladder writes the change (free GitHub Models first) under the path guard and the scope allowlist in doctrine/selfcode.json -> checks and an
independent reviewer of another model family -> PR -> the lane merges -> settle re-measures the signal, reverts on a regression and records the effect per kind in
ops/selfcode/ledger.jsonl (shared on branch loop-evidence). Kinds whose settled kept rate falls under the floor are paused, so the loop spends effort where change helps.
Rails: `enabled` kill switch, the repository HALT variable, per-run, open and per-day caps, a re-file cooldown, and the protected-path deny list of the executor.
"""
from __future__ import annotations
import ast, fnmatch, json, os, re, subprocess, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CONFIG = "doctrine/selfcode.json"
LEDGER = "ops/selfcode/ledger.jsonl"
FINAL = ("kept", "reverted", "failed")


def cfg(root=REPO) -> dict:
    p = Path(root) / CONFIG
    return json.loads((p if p.is_file() else REPO / CONFIG).read_text(encoding="utf-8"))


def now() -> datetime:
    return datetime.now(timezone.utc)


def stamp(t: datetime | None = None) -> str:
    return (t or now()).strftime("%Y-%m-%dT%H:%M:%SZ")


def enabled(root=REPO, env=None) -> bool:
    env = os.environ if env is None else env
    return bool(cfg(root).get("enabled")) and env.get("SELFCODE_OFF") != "1" and env.get("HALT") != "1"


def sh(argv, root=REPO, timeout=120):
    try:
        r = subprocess.run(argv, capture_output=True, text=True, cwd=root, timeout=timeout)
        return r.returncode, (r.stdout + r.stderr).strip()
    except (OSError, subprocess.TimeoutExpired) as e:
        return 127, f"{type(e).__name__}: {e}"


# ---- scope ----------------------------------------------------------------------------------------------------------------------------------------------------

def in_scope(path: str, root=REPO) -> bool:
    return any(fnmatch.fnmatch(path, g) for g in cfg(root)["scope"]["write"])


def scope_violation(paths, root=REPO) -> list[str]:
    """Files a Q-SELF/Q-INTAKE change may not write (outside the allowlist); the executor fails the attempt on a non-empty answer."""
    return [p for p in paths if not in_scope(p, root)]


# ---- sensors --------------------------------------------------------------------------------------------------------------------------------------------------

def _py_files(root) -> list[Path]:
    root, out = Path(root), []
    for g in cfg(root)["scope"]["read_globs"]:
        out += [p for p in root.glob(g) if p.is_file() and "__pycache__" not in p.parts]
    return sorted(set(out))


def _rel(p: Path, root) -> str:
    return p.relative_to(Path(root)).as_posix()


def _unused_imports(src: str) -> list[str]:
    tree = ast.parse(src)
    lines = src.splitlines()
    bound: dict[str, int] = {}
    for n in tree.body:  # module level only; imports inside try/except ImportError or functions are deliberate
        if isinstance(n, ast.Import):
            for a in n.names:
                bound[(a.asname or a.name).split(".")[0]] = n.lineno
        elif isinstance(n, ast.ImportFrom) and n.module != "__future__":
            for a in n.names:
                if a.name != "*":
                    bound[a.asname or a.name] = n.lineno
    used = {x.id for x in ast.walk(tree) if isinstance(x, ast.Name)} | {x.value.id for x in ast.walk(tree) if isinstance(x, ast.Attribute) and isinstance(x.value, ast.Name)}
    exported: set[str] = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "__all__" for t in n.targets) and isinstance(n.value, (ast.List, ast.Tuple)):
            exported |= {e.value for e in n.value.elts if isinstance(e, ast.Constant)}
    strings = " ".join(x.value for x in ast.walk(tree) if isinstance(x, ast.Constant) and isinstance(x.value, str))
    return sorted(f"line {ln}: unused import {name}" for name, ln in bound.items()
                  if name not in used and name not in exported and "noqa" not in lines[ln - 1] and not re.search(rf"\b{re.escape(name)}\b", strings))


def _swallowed(src: str) -> list[str]:
    out = []
    for n in ast.walk(ast.parse(src)):
        if isinstance(n, ast.ExceptHandler):
            broad = n.type is None or (isinstance(n.type, ast.Name) and n.type.id in ("Exception", "BaseException"))
            if n.type is None or (broad and all(isinstance(b, ast.Pass) for b in n.body)):
                out.append(f"line {n.lineno}: {'bare except' if n.type is None else 'except Exception: pass'} hides the failure (log it, narrow it, or let it raise)")
    return out


def _todos(src: str) -> list[str]:
    """Markers in real comment tokens only: a pattern or a string that mentions the marker is not a finding."""
    import io, tokenize
    try:
        toks = list(tokenize.generate_tokens(io.StringIO(src).readline))
    except (tokenize.TokenError, IndentationError):
        return []
    return [f"line {t.start[0]}: {t.string.strip()[:100]}" for t in toks if t.type == tokenize.COMMENT and re.search(r"\b(TODO|FIXME|XXX)\b", t.string)]


def sense_files(root=REPO) -> list[dict]:
    root, found = Path(root), []
    for p in _py_files(root):
        try:
            src = p.read_text(encoding="utf-8")
            per = {"unused_import": _unused_imports(src) if p.name != "__init__.py" else [], "bare_except": _swallowed(src),
                   "todo": _todos(src)}
        except (SyntaxError, UnicodeDecodeError) as e:
            found.append({"kind": "failing_test", "key": _rel(p, root), "count": 1, "detail": [f"{_rel(p, root)} does not parse: {e}"]}); continue
        for kind, details in per.items():
            if details:
                found.append({"kind": kind, "key": _rel(p, root), "count": len(details), "detail": details[:8]})
    return found


def sense_tests(root=REPO) -> list[dict]:
    code, out = sh(["python3", "-m", "unittest", "discover", "-s", "tests/foundation"], root, 900)
    if code == 0:
        return []
    mods: dict[str, list[str]] = {}
    for m in re.finditer(r"^(?:FAIL|ERROR): (\w+) \(([\w.]+)\)", out, re.M):
        mods.setdefault(m.group(2).rsplit(".", 1)[0], []).append(m.group(1))
    return [{"kind": "failing_test", "key": k, "count": len(v), "detail": [f"test {t} fails" for t in v[:8]]} for k, v in mods.items()]


def sense_ci(root=REPO) -> list[dict] | None:
    """Workflows whose latest run on main failed. None = unmeasured (gh unavailable), never "no failures"."""
    code, out = sh(["gh", "run", "list", "--branch", "main", "--limit", "60", "--json", "workflowName,conclusion,createdAt,url,event"], root)
    if code:
        return None
    latest: dict[str, dict] = {}
    for r in sorted(json.loads(out or "[]"), key=lambda r: r["createdAt"]):
        if r["conclusion"] in ("success", "failure"):
            latest[r["workflowName"]] = r
    return [{"kind": "ci_failure", "key": w, "count": 1, "detail": [f"latest main run of {w} failed: {r['url']}"]} for w, r in latest.items() if r["conclusion"] == "failure"]


def sense_unknowns(root=REPO) -> list[dict]:
    """Open rows of the ignorance ledger (UNKNOWNS-1) become work: what the system does not know is a signal the code loop can act on."""
    p = Path(root) / "ops/unknowns/ledger.jsonl"
    if not p.is_file():
        return []
    state: dict[str, dict] = {}
    for line in p.read_text(encoding="utf-8").splitlines():
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if r.get("id"):
            state[str(r["id"])] = r
    return [{"kind": "unknown", "key": k, "count": 1, "detail": [str(r.get("question") or r.get("title") or r.get("text") or k)[:200]]}
            for k, r in state.items() if str(r.get("status", "open")).lower() in ("open", "unknown")]


def sense(root=REPO, tests=False, ci=True) -> tuple[list[dict], list[str]]:
    """All findings plus the kinds that could not be measured (reported, never counted as clean)."""
    found, unmeasured = sense_files(root), []  # CI failures (foundation/ciwatch.py) and unknown facts (foundation/agentwork.py) already file their own items
    if tests:
        found += sense_tests(root)
    return found, unmeasured


def probe(kind: str, key: str, root=REPO) -> bool:
    """True when the signal (kind, key) no longer fires."""
    if kind == "intake":
        code, out = sh(["gh", "issue", "view", key, "--json", "state", "--jq", ".state"], root)
        return code == 0 and out.strip() == "CLOSED"
    if kind == "failing_test":
        if key.endswith(".py"):
            return not any(f["key"] == key for f in sense_files(root))
        return sh(["python3", "-m", "unittest", "discover", "-s", "tests/foundation", "-p", key.split(".")[-1] + ".py"], root, 600)[0] == 0
    if kind == "ci_failure":
        c = sense_ci(root)
        return c is not None and not any(f["key"] == key for f in c)
    if kind == "unknown":
        return not any(f["key"] == key for f in sense_unknowns(root))
    return not any(f["kind"] == kind and f["key"] == key for f in sense_files(root))


# ---- ledger and learning --------------------------------------------------------------------------------------------------------------------------------------

def ledger_rows(root=REPO) -> list[dict]:
    root, texts = Path(root), []
    r = subprocess.run(["git", "-C", str(root), "show", f"origin/loop-evidence:{LEDGER}"], capture_output=True, text=True, encoding="utf-8")
    if r.returncode == 0:
        texts.append(r.stdout)
    p = root / LEDGER
    if p.is_file():
        texts.append(p.read_text(encoding="utf-8"))
    rows, seen = [], set()
    for t in texts:
        for line in t.splitlines():
            if line in seen:
                continue
            seen.add(line)
            try:
                rows.append(json.loads(line))
            except ValueError:
                pass
    return sorted(rows, key=lambda r: r.get("at", ""))


def append(root, row: dict) -> dict:
    row = {"schema": "ultrastable-selfcode/1", "at": stamp(), **row}
    p = Path(root) / LEDGER
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(row, sort_keys=True) + "\n")
    try:  # PROVENANCE-1: each outcome is a change row with its settled effect; a failure to record is printed, not swallowed
        from . import provenance
        provenance.record(root, {"class": "loop", "actor": "selfcode", "channel": "pr"}, "change", f"selfcode {row.get('status')}: {row.get('id')}", ref=str(row.get("pr") or ""),
                          affected=[str(row.get("key") or row.get("id"))], effect={"status": {"kept": "kept", "reverted": "reverted"}.get(row.get("status"), "pending")})
    except Exception as e:  # noqa: BLE001
        print(f"provenance record failed: {e}", file=sys.stderr)
    return row


def states(rows: list[dict]) -> dict[str, dict]:
    """Latest row per item id (append-only ledger; the last row wins)."""
    out: dict[str, dict] = {}
    for r in rows:
        if r.get("id"):
            out[r["id"]] = {**out.get(r["id"], {}), **r}
    return out


def kept_rate(rows: list[dict], kind: str) -> tuple[int, float | None]:
    settled = [s for s in states(rows).values() if s.get("kind") == kind and s.get("status") in FINAL]
    return len(settled), (sum(1 for s in settled if s["status"] == "kept") / len(settled) if settled else None)


def paused(rows: list[dict], kind: str, root=REPO, at: datetime | None = None) -> bool:
    """A kind is paused when enough of its changes settled and too few were kept, until `pause_hours` after the last settlement."""
    L = cfg(root)["learning"]
    n, rate = kept_rate(rows, kind)
    if n < L["min_settled"] or rate is None or rate >= L["min_kept_rate"]:
        return False
    last = max((s["at"] for s in states(rows).values() if s.get("kind") == kind and s.get("status") in FINAL), default="")
    return bool(last) and (at or now()) < datetime.fromisoformat(last.replace("Z", "+00:00")) + timedelta(hours=L["pause_hours"])


def score(f: dict, rows: list[dict], root=REPO) -> float:
    n, rate = kept_rate(rows, f["kind"])
    base = cfg(root)["kinds"][f["kind"]]["weight"] * (1 + min(f["count"], 5) / 5) * (0.5 + (rate if rate is not None else 0.5))  # proven kinds rise, unproven stay neutral
    p = Path(root) / f["key"]
    size = p.stat().st_size if p.is_file() else 0
    return base / (1 + size / cfg(root)["rails"].get("tractable_bytes", 8000))  # the agent rewrites whole files, so a small file is the change most likely to pass its checks


def prefer(issues: list[dict], root=REPO, rows: list[dict] | None = None) -> list[dict]:
    """Executor hook (capacity share): self-code items carry no ranker score, so behind a long scored queue they were never taken. When the share of the
    last `share_window` executor rows spent on Q-SELF/Q-INTAKE items is below `capacity_share`, only those items are candidates for this run."""
    R = cfg(root)["rails"]
    own = [i for i in issues if is_own(i["number"])]
    if not own or not enabled(root):
        return issues
    if rows is None:
        from . import queue as qmod
        rows = qmod.executor_rows(root)
    recent = [r for r in rows if r.get("issue") is not None][-R.get("share_window", 6):]
    spent = sum(1 for r in recent if is_own(r["issue"]))
    return own if spent < R.get("capacity_share", 0.34) * max(len(recent), 1) else issues


# ---- filing ---------------------------------------------------------------------------------------------------------------------------------------------------

def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60]


def item_for(f: dict) -> dict:
    iid = f"Q-SELF-{f['kind'].replace('_', '-')}-{slug(f['key'])}"
    where = f["key"]
    ask = {"unused_import": "Remove the unused imports in the file; change nothing else.", "bare_except": "Make each swallowed error visible: catch the narrowest exception and log or re-raise it. Keep behaviour for the expected case and add a test.",
           "todo": "Resolve each TODO/FIXME in the file with code and a test, or delete it when it is already done.", "failing_test": "Make the failing tests pass by fixing the code (never by weakening or skipping a test).",
           "ci_failure": "Find why the latest main run of this workflow fails and fix the code or script it runs (workflow files themselves are out of scope).",
           "unknown": "This is a recorded gap in what the system knows. Add the smallest code, probe or data that answers it and records the answer."}[f["kind"]]
    body = (f"**Owner:** code-agent\n**Trigger:** signal {f['kind']} fires for {where}\n**Done check:** cmd:python3 -m foundation selfcode --probe {f['kind']} {where}\n**Status:** open\n\n"
            f"SELFCODE-1 signal `{f['kind']}` on `{where}` ({f['count']} finding(s)).\n\n{ask}\n\nFindings:\n" + "\n".join(f"- {d}" for d in f["detail"]) +
            "\n\nScope: only foundation/, scripts/, tests/, products/, site/, seed/ and docs/issues/. A change that does not make the done check pass is reverted.")
    return {"id": iid, "title": f"{iid}: {f['kind'].replace('_', ' ')} in {where}", "body": body, "labels": ["role:code-agent", "ws:self", "p6", "raises-deploys", "raises-self"], "milestone": "Now", "workstream": "Self"}


def write_item(root, item: dict) -> Path:
    p = Path(root) / "docs/issues" / f"{item['id']}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(item, indent=2) + "\n", encoding="utf-8")
    return p


# DECISION-METRIC: self-code-finding (each filed finding is logged with its score and scored by whether its item closes)
def pick_findings(found: list[dict], rows: list[dict], open_ids: set[str], root=REPO, at: datetime | None = None) -> list[dict]:
    """The findings to file this run, best first, after the rails: kind enabled and not paused, not already open, not re-filed inside the cooldown, caps on open and per day."""
    c, at = cfg(root), at or now()
    R = c["rails"]
    today = len({r["id"] for r in rows if r.get("status") == "filed" and r.get("at", "") >= stamp(at - timedelta(hours=24))})  # distinct items: a re-file of the same item is not a new one
    filed_ever = {r["id"] for r in rows if r.get("status") == "filed"}
    room = min(R["max_new_per_run"], R["max_open"] - len(open_ids))
    new_room = R["max_filed_per_day"] - today  # the daily cap limits NEW items; an item filed before and never worked is taken again without using it (the cap was spent by items whose files had not survived a run)
    # The cooldown guards an item the agent already settled (kept, reverted, dropped). An item only filed never reached a PR, and the executor's checkout does not carry
    # the item file (it is written inside the run, not committed), so it must be filed again on the next run or it is never taken.
    last = {r["id"]: r["at"] for r in sorted(rows, key=lambda r: r.get("at", "")) if r.get("status") != "filed"}
    out = []
    for f in sorted(found, key=lambda f: (item_for(f)["id"] not in filed_ever, -score(f, rows, root))):  # items filed before and never worked first
        if room <= 0:
            break
        k = c["kinds"].get(f["kind"])
        iid = item_for(f)["id"]
        if not k or not k["enabled"] or paused(rows, f["kind"], root, at) or iid in open_ids:
            continue
        if iid in last and last[iid] > stamp(at - timedelta(hours=R["refile_cooldown_hours"])):
            continue
        if iid not in filed_ever:
            if new_room <= 0:
                continue
            new_room -= 1
        out.append(f); room -= 1
    return out


def intake(root=REPO) -> list[dict]:
    """Issue-to-PR: trusted authors' open issues labelled `agent-task` become Q-INTAKE-* items, so the owner (or another system) files an issue and the agent implements it."""
    R = cfg(root)["rails"]
    code, out = sh(["gh", "issue", "list", "--label", R["intake_label"], "--state", "open", "--json", "number,title,body,authorAssociation", "--limit", "20"], root)
    if code:
        return []
    items = []
    for i in json.loads(out or "[]"):
        if i.get("authorAssociation") not in R["trusted_issue_authors"]:
            continue
        iid = f"Q-INTAKE-{i['number']}"
        items.append({"id": iid, "title": f"{iid}: {i['title']}"[:160], "body": f"**Owner:** code-agent\n**Trigger:** trusted issue #{i['number']} labelled {R['intake_label']}\n**Done check:** cmd:python3 -m foundation selfcode --probe intake {i['number']}\n**Status:** open\n\n"
                      f"Implement the request below with the smallest correct change, with tests. Scope: foundation/, scripts/, tests/, products/, site/, seed/.\n\n{(i.get('body') or '')[:5000]}",
                      "labels": ["role:code-agent", "ws:self", "p3"], "milestone": "Now", "workstream": "Self", "_kind": "intake", "_key": str(i["number"])})
    return items


def is_own(iid) -> bool:
    """This loop's items: Q-INTAKE-* and Q-SELF-<signal kind>-*. Other Q-SELF-* items (hand-filed self-reference work) are not the code agent's."""
    return str(iid).startswith(("Q-INTAKE-",) + tuple(f"Q-SELF-{k.replace('_', '-')}-" for k in ("failing_test", "bare_except", "unused_import", "todo", "ci_failure", "unknown")))


def open_self_ids(root=REPO) -> set[str]:
    from . import queue as qmod
    return {it["id"] for it in qmod.items(root) if it["status"] == "open" and is_own(it["id"])}


def run_sense(root=REPO, apply=False, tests=False, ci=True) -> dict:
    root = Path(root)
    if not enabled(root):
        return {"result": "disabled", "detail": "kill switch: doctrine/selfcode.json enabled=false, SELFCODE_OFF or HALT"}
    from . import queue as qmod
    rows = ledger_rows(root)
    open_ids = open_self_ids(root)
    backlog = len([i for i in qmod.takeable(root) if not is_own(i["number"])])
    for iid, n in qmod.fail_counts(root).items():  # an item the executor parked after 3 failed runs is recorded as failed, so its cooldown applies and the next finding gets the run
        if is_own(iid) and n >= 3 and not any(r["id"] == iid and r.get("status") == "failed" for r in rows):
            if apply:
                append(root, {"id": iid, "kind": "parked", "key": iid, "before": 0, "status": "failed"})
            rows = rows + [{"id": iid, "kind": "parked", "status": "failed", "at": stamp(now())}]
    found, unmeasured = sense(root, tests=tests, ci=ci)
    res = {"result": "sensed", "findings": len(found), "unmeasured": unmeasured, "backlog": backlog, "filed": [], "by_kind": {}}
    for f in found:
        res["by_kind"][f["kind"]] = res["by_kind"].get(f["kind"], 0) + 1
    issues = intake(root) if ci else []
    for it in issues:  # a trusted request is always filed (it is the owner's own work order); the per-run cap still applies to signals
        if it["id"] not in open_ids and not (Path(root) / "docs/issues" / f"{it['id']}.json").exists():
            kind, key = it.pop("_kind"), it.pop("_key")
            res["filed"].append(it["id"])
            if apply:
                write_item(root, it); append(root, {"id": it["id"], "kind": kind, "key": key, "before": 1, "status": "filed"})
    for f in pick_findings(found, rows, open_ids | {i for i in res["filed"]}, root):
        it = item_for(f)
        res["filed"].append(it["id"])
        if apply:
            write_item(root, it)
            from . import decisions
            decisions.record(root, "self-code-finding", f["kind"], it["id"], 1.0, f"score {score(f, rows, root)} of {len(found)} sensed findings: {it['title'][:120]}", alternatives=max(0, len(found) - 1))
            if not any(r["id"] == it["id"] and r.get("status") == "filed" and r.get("at", "") >= stamp(now() - timedelta(hours=1)) for r in rows):
                append(root, {"id": it["id"], "kind": f["kind"], "key": f["key"], "before": f["count"], "status": "filed"})  # one ledger row per item per hour, not one per run
    return res


# ---- settle ---------------------------------------------------------------------------------------------------------------------------------------------------

def pr_state(url: str, root=REPO) -> dict | None:
    code, out = sh(["gh", "pr", "view", url, "--json", "state,mergedAt,mergeCommit,number"], root)
    return json.loads(out) if code == 0 and out else None


def runs_failed_on(sha: str, root=REPO) -> list[str] | None:
    code, out = sh(["gh", "run", "list", "--commit", sha, "--json", "workflowName,conclusion,status"], root)
    if code:
        return None
    rs = json.loads(out or "[]")
    if any(r["status"] != "completed" for r in rs):
        return None  # not settled yet
    return [r["workflowName"] for r in rs if r["conclusion"] == "failure"]


def revert(root, sha: str, pr: int, item: str) -> str | None:
    branch = f"agent/revert-{item.lower()}-{sha[:7]}"
    for step in (["git", "fetch", "-q", "origin", "main"], ["git", "checkout", "-B", branch, "origin/main"], ["git", "revert", "--no-edit", sha],
                 ["git", "push", "-u", "origin", branch]):
        code, o = sh(step, root, 120)
        if code:
            print(f"revert step failed: {' '.join(step[:3])}: {o[-200:]}", file=sys.stderr)
            return None
    code, o = sh(["gh", "pr", "create", "--base", "main", "--head", branch, "--title", f"Revert #{pr}: {item} regressed", "--body",
                  f"SELFCODE-1 auto-revert of #{pr} ({item}): a workflow failed on the merge commit or the signal got worse.\nItem: {item}\nPrediction: ci_failure_count <= 0 within 1 h\nEvidence: ops/selfcode/ledger.jsonl"], root)
    if code:
        return None
    pr_url = o.splitlines()[-1]
    sh(["gh", "pr", "ready", pr_url], root)
    sh(["gh", "workflow", "run", "checks.yml", "--ref", branch], root)
    return pr_url


def run_settle(root=REPO, apply=False) -> dict:
    root = Path(root)
    if not enabled(root):
        return {"result": "disabled"}
    from . import queue as qmod
    rows = ledger_rows(root)
    st = states(rows)
    pending = [s for s in st.values() if s.get("status") in ("filed", "merged") and not s.get("pr_checked")]
    prs: dict[str, str] = {}
    for r in qmod.executor_rows(root):
        if r.get("result") == "pr-opened" and r.get("pr"):
            prs[str(r.get("issue"))] = r["pr"]
    res = {"result": "settled", "outcomes": []}
    wait = cfg(root)["rails"]["settle_after_minutes"]
    for s in pending:
        url = prs.get(s["id"])
        if not url:
            if s.get("status") == "filed" and s["at"] < stamp(now() - timedelta(hours=48)):
                res["outcomes"].append({"id": s["id"], "status": "failed", "why": "no pull request within 48 h"})
                if apply:
                    append(root, {"id": s["id"], "kind": s["kind"], "key": s["key"], "status": "failed", "why": "no pull request within 48 h"})
            continue
        p = pr_state(url, root)
        if not p:
            continue
        if p["state"] == "CLOSED":
            res["outcomes"].append({"id": s["id"], "status": "failed", "pr": url})
            if apply:
                append(root, {"id": s["id"], "kind": s["kind"], "key": s["key"], "status": "failed", "pr": url, "why": "closed without merging"})
            continue
        if p["state"] != "MERGED" or not p.get("mergeCommit"):
            continue
        sha, merged = p["mergeCommit"]["oid"], datetime.fromisoformat(p["mergedAt"].replace("Z", "+00:00"))
        if now() < merged + timedelta(minutes=wait):
            continue
        failed = runs_failed_on(sha, root)
        if failed is None:
            continue
        gone = probe(s["kind"], s["key"], root)
        if failed or not gone:
            out = {"id": s["id"], "status": "reverted", "pr": url, "why": f"workflows failed on merge: {failed}" if failed else "signal still fires after the merge"}
            if apply:
                out["revert_pr"] = revert(root, sha, p["number"], s["id"]) if failed else None  # a signal that did not move is learned from, not rolled back; a break is rolled back
                append(root, {"id": s["id"], "kind": s["kind"], "key": s["key"], **out})
        else:
            out = {"id": s["id"], "status": "kept", "pr": url, "after": 0}
            if apply:
                append(root, {"id": s["id"], "kind": s["kind"], "key": s["key"], **out})
                if s["kind"] == "intake":
                    sh(["gh", "issue", "close", s["key"], "--comment", f"Implemented by {url} (self-code loop); checks and the live signal passed."], root)
        res["outcomes"].append(out)
    return res


def status(root=REPO) -> dict:
    rows, c = ledger_rows(root), cfg(root)
    return {"enabled": enabled(root), "kinds": {k: {"settled": kept_rate(rows, k)[0], "kept_rate": kept_rate(rows, k)[1], "paused": paused(rows, k, root)} for k in c["kinds"]}}


def check(root=REPO) -> list[str]:
    root, bad, c = Path(root), [], cfg(root)
    for k in ("enabled", "scope", "rails", "learning", "kinds"):
        if k not in c:
            bad.append(f"{CONFIG}: missing {k}")
    for g in c.get("scope", {}).get("write", []):
        if g.startswith((".github", "autonomy", ".git")) or g == "*":
            bad.append(f"scope allows a protected path: {g}")
    return bad


def main(argv=None) -> int:
    import argparse
    ap = argparse.ArgumentParser(prog="foundation selfcode")
    ap.add_argument("--sense", action="store_true"); ap.add_argument("--settle", action="store_true"); ap.add_argument("--status", action="store_true"); ap.add_argument("--check", action="store_true")
    ap.add_argument("--probe", nargs=2, metavar=("KIND", "KEY")); ap.add_argument("--apply", action="store_true"); ap.add_argument("--tests", action="store_true")
    a = ap.parse_args(argv)
    if a.probe:
        return 0 if probe(a.probe[0], a.probe[1]) else 1
    if a.sense:
        print(json.dumps(run_sense(REPO, a.apply, a.tests), indent=1)); return 0
    if a.settle:
        print(json.dumps(run_settle(REPO, a.apply), indent=1)); return 0
    if a.status:
        print(json.dumps(status(), indent=1)); return 0
    bad = check()
    print("selfcode ok" if not bad else "\n".join(bad))
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())

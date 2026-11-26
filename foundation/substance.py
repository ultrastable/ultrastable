# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""SUBSTANCE-1: a change counts only when it alters executable behaviour. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation substance --range A..B [--json]            classify a diff (per file and overall)
  python3 -m foundation substance --gate --range A..B [--executor]  exit 3 when the change is not substantive (with --executor: only when the PR is an executor PR)
  python3 -m foundation substance --deploy-gate --range A..B --paths P...   print deploy=true|false for a push (GITHUB_OUTPUT aware)
  python3 -m foundation substance --report [--days N] [--apply]    7-day substantive / trivial / record split per origin, wasted deploys, pulse state; --apply writes ops/substance.json
  python3 -m foundation substance --check                          config parses and every shared vector in doctrine/substance-vectors.json passes

Rowan, 2026-11-21: "code changes end up being totally trivial. They change a hash or they change a number that should be dynamic anyway ...
This is the illusion of productivity that absolutely must be stopped." Measured on main before this module (2026-11-14..21): the executor's own
merged PRs were unused-import removals and queue/ledger records, every regenerated data module bumped a commit hash, a count and timestamps, and
each such push redeployed five Workers. The classifier is line-based on the diff hunks (the same algorithm as workers/core/substance, which
only sees GitHub's patch text): comments and whitespace are dropped, numbers and volatile strings (hashes, timestamps, dates, versions) are
normalized, import-only lines are set aside; whatever still differs is behaviour. Consumers: foundation/executor.py (no PR for a trivial change),
.github/workflows/checks.yml (backstop for executor PRs), .github/workflows/deploy-ultrastable.yml (deploy gate), the watchdog (report).
"""
from __future__ import annotations
import argparse, fnmatch, json, os, re, subprocess, sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CONFIG = "doctrine/substance.json"
VECTORS = "doctrine/substance-vectors.json"
OUT = "ops/substance.json"
TRIVIAL = ("literal", "comment", "format", "import")
NON_CODE = ("generated", "record")

_STR = r'"(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|`(?:\\.|[^`\\])*`'
_NUM = r'\b0[xX][0-9a-fA-F]+\b|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b'
_COMMENT = {"hash": r'#.*$', "js": r'//.*$|/\*.*?\*/|/\*.*$|^\s*\*(?!\*).*$', "sql": r'--.*$', "none": r'(?!x)x'}
_LANG = {".py": "hash", ".sh": "hash", ".toml": "hash", ".yml": "hash", ".yaml": "hash", ".js": "js", ".mjs": "js", ".cjs": "js", ".ts": "js",
         ".sql": "sql", ".json": "none"}
_RX = {k: re.compile(rf'(?P<s>{_STR})|(?P<c>{c})|(?P<n>{_NUM})|(?P<i>[A-Za-z_$][\w$]*)|(?P<p>\S)', re.M) for k, c in _COMMENT.items()}
_VOLATILE = re.compile(r'^(?:[0-9a-f]{7,64}|\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?(?:[+-]\d\d:?\d\d)?)?|v?\d+(?:\.\d+)+(?:[-+][\w.-]*)?|[\d.,\s%]+)$')
_IMPORT = {"hash": re.compile(r'^\s*(?:import\s|from\s+\S+\s+import\s)'), "js": re.compile(r'^\s*(?:import[\s{*\'"]|export\s+\*?\s*\{?[^=]*\bfrom\s)|\brequire\(')}


def cfg(root=REPO) -> dict:
    p = Path(root) / CONFIG
    return json.loads((p if p.is_file() else REPO / CONFIG).read_text(encoding="utf-8"))


def _match(path: str, globs) -> bool:
    return any(fnmatch.fnmatchcase(path, g) for g in globs)


def file_class(path: str, c: dict) -> str:
    """generated | record | config | code."""
    if _match(path, c["generated_globs"]):
        return "generated"
    if _match(path, c["record_globs"]):
        return "record"
    if _match(path, c["config_globs"]):
        return "config"
    return "code" if os.path.splitext(path)[1] in c["code_ext"] else "record"


def lang_of(path: str) -> str:
    return _LANG.get(os.path.splitext(path)[1], "hash")


def _line(line: str, lang: str, doc_keys) -> dict:
    raw, norm, comments = [], [], []
    for m in _RX[lang].finditer(line):
        k, t = m.lastgroup, m.group(0)
        if k == "c":
            comments.append(t.strip())
            continue
        raw.append(t)
        if k == "n":
            norm.append("N#")
        elif k == "s":
            body = t[1:-1]
            norm.append("S#" if _VOLATILE.match(body.strip()) else t)
        else:
            norm.append(t)
    if doc_keys and len(raw) >= 2 and raw[0][:1] == '"' and raw[0][1:-1] in doc_keys and raw[1] == ":":
        comments.append(line.strip()); raw, norm = [], []  # a prose key in a config file is documentation, not behaviour
    imp = _IMPORT.get(lang)
    return {"raw": raw, "norm": norm, "comments": comments, "import": bool(raw and imp and imp.search(line))}


def classify_file(path: str, status: str, removed: list[str], added: list[str], c: dict | None = None) -> str:
    """One of behaviour | literal | comment | format | import | generated | record."""
    c = c or cfg()
    fc = file_class(path, c)
    if fc in NON_CODE:
        return fc
    lang = "none" if fc == "config" else lang_of(path)
    keys = set(c.get("doc_keys", [])) if fc == "config" or path.endswith(".json") else set()
    rl, al = [_line(x, lang, keys) for x in removed], [_line(x, lang, keys) for x in added]
    tok = lambda ls, f: [t for x in ls for t in x[f]]
    if status in ("added", "removed"):
        return "behaviour" if tok(rl + al, "raw") else "comment"
    if tok(rl, "raw") == tok(al, "raw"):
        return "comment" if tok(rl, "comments") != tok(al, "comments") else "format"
    if tok(rl, "norm") == tok(al, "norm"):
        return "literal"
    code = [x for x in rl + al if x["raw"]]
    if code and all(x["import"] for x in code):
        return "import"
    return "behaviour"


def verdict(kinds) -> str:
    kinds = list(kinds)
    if "behaviour" in kinds:
        return "substantive"
    return "trivial" if any(k in TRIVIAL for k in kinds) else "record"


def parse_diff(text: str) -> list[dict]:
    files, cur = [], None
    for line in text.splitlines():
        if line.startswith("diff --git "):
            m = re.match(r'diff --git a/(.*) b/(.*)$', line)
            cur = {"path": m.group(2) if m else line[11:], "status": "modified", "removed": [], "added": []}
            files.append(cur)
        elif cur is None:
            continue
        elif line.startswith("new file mode"):
            cur["status"] = "added"
        elif line.startswith("deleted file mode"):
            cur["status"] = "removed"
        elif line.startswith(("--- ", "+++ ", "index ", "@@", "similarity ", "rename ", "old mode", "new mode", "Binary files")):
            continue
        elif line.startswith("-"):
            cur["removed"].append(line[1:])
        elif line.startswith("+"):
            cur["added"].append(line[1:])
    return files


def classify_diff(text: str, c: dict | None = None, paths=None) -> dict:
    c = c or cfg()
    files = [f for f in parse_diff(text) if not paths or any(f["path"] == p or f["path"].startswith(p.rstrip("*").rstrip("/") + "/") or fnmatch.fnmatchcase(f["path"], p) for p in paths)]
    rows = [{"path": f["path"], "kind": classify_file(f["path"], f["status"], f["removed"], f["added"], c)} for f in files]
    return {"verdict": verdict(r["kind"] for r in rows), "files": rows, "behaviour": [r["path"] for r in rows if r["kind"] == "behaviour"]}


def git(args, root=REPO) -> str:
    r = subprocess.run(["git", *args], cwd=root, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"git {' '.join(args[:3])} failed: {r.stderr.strip()[:300]}")
    return r.stdout


def diff_text(rng: str, root=REPO) -> str:
    return git(["diff", "--no-color", "--no-ext-diff", "-U0", "-M", rng.replace("...", "..."), "--"], root) if rng else git(["diff", "--no-color", "-U0", "-M", "HEAD", "--"], root)


def classify_range(rng: str | None, root=REPO, paths=None) -> dict:
    """rng 'A..B' or 'A...B'; None means the working tree against HEAD (the executor's uncommitted change, untracked files included)."""
    text = diff_text(rng, root)
    if rng is None:  # untracked new files are part of the executor's change
        for p in git(["ls-files", "--others", "--exclude-standard"], root).splitlines():
            try:
                body = (Path(root) / p).read_text(encoding="utf-8", errors="replace").splitlines()
            except OSError:
                continue
            text += f"\ndiff --git a/{p} b/{p}\nnew file mode 100644\n" + "".join("+" + x + "\n" for x in body)
    return classify_diff(text, cfg(root), paths)


# ---- deploy gate ---------------------------------------------------------------------------------------------------------------------------------

def last_deploy_age_h(root=REPO, now=None) -> float | None:
    p = Path(root) / "ops/deploys.jsonl"
    if not p.is_file():
        return None
    best = None
    for line in p.read_text(encoding="utf-8").splitlines():
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if r.get("live_matches_commit") or r.get("uploaded"):
            best = max(best or "", str(r.get("at") or ""))
    if not best:
        return None
    t = datetime.fromisoformat(best.replace("Z", "+00:00"))
    return ((now or datetime.now(timezone.utc)) - t).total_seconds() / 3600


def deploy_decision(rng: str, paths, root=REPO, now=None) -> dict:
    c = cfg(root)
    try:
        res = classify_range(rng, root, paths)
    except RuntimeError as e:  # an unknown base (first push, force push) is never a reason to skip a deploy
        return {"deploy": True, "why": f"range not readable ({str(e)[:120]}); deploying", "verdict": None}
    if res["verdict"] == "substantive":
        return {"deploy": True, "why": "behaviour changed in " + ", ".join(res["behaviour"][:6]), "verdict": res["verdict"]}
    age, cap = last_deploy_age_h(root, now), c["deploy"]["max_age_hours"]
    if age is None or age >= cap:
        return {"deploy": True, "why": f"no behaviour change, but the newest live deploy is {'unknown' if age is None else f'{age:.1f} h'} old (cap {cap} h); refreshing data", "verdict": res["verdict"]}
    return {"deploy": False, "why": f"no behaviour change in the deployed paths ({res['verdict']}: {len(res['files'])} file(s)); newest live deploy {age:.1f} h old < {cap} h", "verdict": res["verdict"]}


# ---- report --------------------------------------------------------------------------------------------------------------------------------------

def origin_of(author: str, email: str, subject: str, body: str, c: dict) -> str:
    if "[skip ci]" in subject or "[skip ci]" in body:
        return "bookkeeping"
    if any(m in body for m in c.get("executor_markers", [])) or "[bot]" in author or "[bot]" in email:
        return "system"
    return "session"


def report(root=REPO, days: int | None = None, now=None) -> dict:
    c, now = cfg(root), now or datetime.now(timezone.utc)
    days = days or c["targets"]["window_days"]
    since = (now - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    log = git(["log", "--first-parent", f"--since={since}", "--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1e", "HEAD"], root)
    commits, by = [], {}
    for rec in log.split("\x1e"):
        parts = rec.strip("\n").split("\x1f")
        if len(parts) < 6:
            continue
        sha, an, ae, at, subj, body = parts
        o = origin_of(an, ae, subj, body, c)
        try:
            res = classify_diff(git(["diff", "--no-color", "-U0", "-M", f"{sha}^", sha, "--"], root), c)
        except RuntimeError:
            continue
        commits.append({"sha": sha[:9], "at": at, "origin": o, "verdict": res["verdict"], "subject": subj[:120]})
        b = by.setdefault(o, {"substantive": 0, "trivial": 0, "record": 0})
        b[res["verdict"]] += 1
    verdict_of = {x["sha"]: x["verdict"] for x in commits}
    shas, wasted = set(), set()
    p = Path(root) / "ops/deploys.jsonl"
    for line in (p.read_text(encoding="utf-8").splitlines() if p.is_file() else []):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        if str(r.get("at") or "") >= since and r.get("sha"):
            s = str(r["sha"])[:9]; shas.add(s)
            if verdict_of.get(s) in ("trivial", "record"):
                wasted.add(s)
    last = lambda pred: next((x["at"] for x in commits if pred(x)), None)
    ls_sys, ls_any = last(lambda x: x["origin"] == "system" and x["verdict"] == "substantive"), last(lambda x: x["verdict"] == "substantive")
    sys_any = last(lambda x: x["origin"] == "system")
    hrs = lambda t: None if not t else round((now - datetime.fromisoformat(t)).total_seconds() / 3600, 1)
    cap = c["targets"]["max_hours_without_substantive_self_change"]
    state = "shipping" if ls_sys and hrs(ls_sys) <= cap else "trivial-only" if sys_any and hrs(sys_any) <= cap else "stalled"
    nonbook = [x for x in commits if x["origin"] != "bookkeeping"]
    sysrows = [x for x in commits if x["origin"] == "system"]
    return {"marker": "SUBSTANCE-1", "at": now.strftime("%Y-%m-%dT%H:%M:%SZ"), "window_days": days, "commits": len(commits), "by_origin": by,
            "substantive_share": round(sum(x["verdict"] == "substantive" for x in nonbook) / len(nonbook), 3) if nonbook else None,
            "system_substantive_share": round(sum(x["verdict"] == "substantive" for x in sysrows) / len(sysrows), 3) if sysrows else None,
            "system_trivial": sum(x["verdict"] == "trivial" for x in sysrows),
            "deploy_rounds": len(shas), "deploy_rounds_without_behaviour_change": len(wasted),
            "last_substantive_at": ls_any, "last_substantive_system_at": ls_sys, "hours_since_substantive_system": hrs(ls_sys),
            "state": state, "recent": commits[:40]}


def check_targets(rep: dict, c: dict) -> list[str]:
    t, bad = c["targets"], []
    if rep["system_trivial"] > t["executor_trivial_prs"]:
        bad.append(f"system_trivial {rep['system_trivial']} > {t['executor_trivial_prs']}")
    if rep["substantive_share"] is not None and rep["substantive_share"] < t["min_substantive_share"]:
        bad.append(f"substantive_share {rep['substantive_share']} < {t['min_substantive_share']}")
    if rep["state"] != "shipping":
        bad.append(f"state {rep['state']}: no substantive change by the system itself in {t['max_hours_without_substantive_self_change']} h")
    return bad


CLASSIFIER_KEYS = ("code_ext", "config_globs", "generated_globs", "record_globs")


def check(root=REPO) -> list[str]:
    """Every missing key of the config by name, then each shared vector that no longer holds. Without a classifier key no vector can be
    classified, so the check returns the names and stops there instead of raising; a missing doc_keys is named and also shows as the vectors it breaks."""
    c, errs = cfg(root), []
    for k in (*CLASSIFIER_KEYS, "doc_keys", "deploy", "targets"):
        if k not in c:
            errs.append(f"{CONFIG}: missing {k}")
    if any(k not in c for k in CLASSIFIER_KEYS):
        return errs
    v = json.loads((Path(root) / VECTORS).read_text(encoding="utf-8"))
    for case in v["cases"]:
        got = classify_file(case["path"], case["status"], case["removed"], case["added"], c)
        if got != case["expect"]:
            errs.append(f"vector {case['name']!r}: got {got}, expected {case['expect']}")
    for case in v["verdicts"]:
        if verdict(case["kinds"]) != case["expect"]:
            errs.append(f"verdict vector {case['name']!r} failed")
    return errs


def is_executor_pr(body: str, c: dict) -> bool:
    return any(m in (body or "") for m in c.get("executor_markers", []))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="foundation substance")
    ap.add_argument("--range"); ap.add_argument("--json", action="store_true"); ap.add_argument("--gate", action="store_true")
    ap.add_argument("--executor", action="store_true", help="with --gate: apply only when PR_BODY marks an executor PR")
    ap.add_argument("--deploy-gate", action="store_true"); ap.add_argument("--paths", nargs="*")
    ap.add_argument("--report", action="store_true"); ap.add_argument("--days", type=int); ap.add_argument("--apply", action="store_true")
    ap.add_argument("--check-targets", action="store_true"); ap.add_argument("--check", action="store_true")
    a = ap.parse_args(argv)
    if a.check:
        errs = check()
        print("\n".join(errs) or "substance: config and shared vectors ok")
        return 1 if errs else 0
    if a.deploy_gate:
        d = deploy_decision(a.range, a.paths or [])
        print(f"deploy={'true' if d['deploy'] else 'false'}  # {d['why']}")
        if os.environ.get("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as f:
                f.write(f"deploy={'true' if d['deploy'] else 'false'}\n")
        return 0
    if a.report or a.check_targets:
        rep = report(days=a.days)
        if a.apply:
            (REPO / OUT).parent.mkdir(parents=True, exist_ok=True)
            (REPO / OUT).write_text(json.dumps(rep, indent=1) + "\n", encoding="utf-8")
        print(json.dumps({k: v for k, v in rep.items() if k != "recent"}, indent=1))
        if a.check_targets:
            bad = check_targets(rep, cfg())
            print("\n".join("OUT OF BOUNDS: " + b for b in bad) or "substance targets in bounds")
            return 1 if bad else 0
        return 0
    res = classify_range(a.range)
    print(json.dumps(res, indent=1) if a.json else f"{res['verdict']}: " + ", ".join(f"{r['path']}={r['kind']}" for r in res["files"][:40]))
    if a.gate:
        if a.executor and not is_executor_pr(os.environ.get("PR_BODY", ""), cfg()):
            # a PR another system loop opened (the tick Worker's code agents, bookkeeping bots): a records-only PR is bookkeeping and passes,
            # but a code change that only bumps numbers, hashes, comments or imports is refused the same way
            if "[bot]" in os.environ.get("PR_AUTHOR", "") and res["verdict"] == "trivial":
                print(f"::error::SUBSTANCE-1: a system-opened PR whose code change alters no executable behaviour ({res['verdict']}).")
                return 3
            return 0
        if res["verdict"] != "substantive":
            print(f"::error::SUBSTANCE-1: this change alters no executable behaviour ({res['verdict']}). The system does not spend a PR, a CI run or a deploy on it.")
            return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())

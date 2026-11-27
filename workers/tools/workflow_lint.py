#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""Static cost and security lint for GitHub Actions workflows (US-SPEC-24, requirements US-24-R10..R19).

  python tools/workflow_lint.py                 # lints .github/workflows/*.yml
  python tools/workflow_lint.py path/a.yml ...  # lints the given files

Rules: W01 permissions, W02 concurrency (or a `# no-concurrency: <reason>` comment), W03 timeout-minutes on every job
(and <= 15; `# allow-timeout: <minutes 16..60> <reason>` raises the cap for the whole workflow), W04 no schedule trigger
(`# allow-schedule: <reason and cost estimate>` is the stated exception), W05 no pull_request_target, W06 actions pinned
(no @main/@master/@HEAD, no bare ref), W07 no secrets in a job reachable from a pull_request without a guard, W08 no macOS or
Windows runners.
W09 (only with --require-sha, for public repositories, US-24-R18): every third-party action pinned to a full 40-character
commit SHA; a version tag is reported. `--sha-report` prints the unpinned actions and exits 0 (the measure, not the gate).
W10 (R15) a job matrix of more than four jobs, or one with no explicit list. W12 (R11) a pull_request workflow whose
concurrency lacks `cancel-in-progress`. W13 (R16) self-hosted and larger runners. W14 (R42) a top-level write scope on a
workflow of more than one job (write scopes are granted per job). W15 (R17, only with --repo-root) a setup-node, setup-python
or setup-go step without `cache:` while a lock file exists.
Opt-in flags so the shipped workflows keep passing until their comments land (they are protected paths): --require-path-filters
(W11, R13: a push or pull_request workflow needs `paths` or `paths-ignore`, or `# no-path-filter: <reason>`),
--require-headers (W16, R56: `# budget:`, `# trigger:`, `# free-alternative:` comments), --require-second-route (W17, R44: a
workflow with `# allow-schedule:` also names `# second-route: <loop or tick step>`). `--strict` turns all three on.
Stdlib only, line based (no YAML library); it expects the conventional two-space layout. Exit 0 clean, 1 findings.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

MAX_TIMEOUT = 15
MAX_ALLOWED_TIMEOUT = 60  # the ceiling a `# allow-timeout:` comment can reach
COMMENT = re.compile(r"(^|\s)#.*$")
UNPINNED = re.compile(r"^\s*-?\s*uses:\s*['\"]?([^'\"\s@]+)(?:@(\S+?))?['\"]?\s*$")
GUARD = re.compile(r"workflow_dispatch|github\.event_name\s*==\s*'push'|head\.repo\.full_name\s*==\s*github\.repository")
SECRET = re.compile(r"secrets\.(?!GITHUB_TOKEN\b)\w+")


def _strip(lines):
    return [COMMENT.sub("", l).rstrip() for l in lines]


def _top_block(code, key):
    """Lines of a top-level key's block (without the key line)."""
    out, inside = [], False
    for l in code:
        if re.match(r"^['\"]?%s['\"]?\s*:" % re.escape(key), l):
            inside = True
            rest = l.split(":", 1)[1].strip()
            if rest:
                out.append(rest)
            continue
        if inside:
            if l and not l.startswith((" ", "\t")):
                break
            out.append(l)
    return out if inside else None


def _jobs(code):
    block = _top_block(code, "jobs") or []
    jobs, name, cur, indent = {}, None, [], None
    for l in block:
        m = re.match(r"^(\s+)([\w-]+):\s*$", l)
        if m and (indent is None or len(m.group(1)) == indent):
            indent = len(m.group(1))
            if name:
                jobs[name] = cur
            name, cur = m.group(2), []
        elif name is not None:
            cur.append(l)
    if name:
        jobs[name] = cur
    return jobs, (indent or 2)


LOCKFILES = {"setup-node": ["package-lock.json", "yarn.lock", "pnpm-lock.yaml"],
             "setup-python": ["requirements.txt", "poetry.lock", "Pipfile.lock", "uv.lock"], "setup-go": ["go.sum"]}
LARGER_RUNNER = re.compile(r"self-hosted|-\d+-cores?\b|-xl\b|-large\b|\bgpu\b", re.I)


def _list_len(text):
    """Number of entries of an inline YAML list `[a, b]`, or None when the text is not an explicit list."""
    t = text.strip()
    if not (t.startswith("[") and t.endswith("]")) or "${{" in t:
        return None
    return len([x for x in t[1:-1].split(",") if x.strip()])


def _matrix_size(b):
    """Expanded size of the first `matrix:` in a job's lines; None when it is not an explicit list. 0 when there is none."""
    for i, l in enumerate(b):
        m = re.match(r"^(\s+)matrix\s*:\s*(.*)$", l)
        if not m:
            continue
        indent, rest = len(m.group(1)), m.group(2).strip()
        if rest:
            return None if rest.startswith("$") else (_list_len(rest) or 1)
        body = []
        for x in b[i + 1:]:
            if x.strip() and len(x) - len(x.lstrip()) <= indent:
                break
            body.append(x)
        kids = [x for x in body if x.strip()]
        if not kids:
            return None
        ci = len(kids[0]) - len(kids[0].lstrip())
        product, include, saw_axis = 1, 0, False
        for j, x in enumerate(body):
            km = re.match(r"^\s{%d}([\w-]+)\s*:\s*(.*)$" % ci, x)
            if not km:
                continue
            key, val = km.group(1), km.group(2).strip()
            tail = []
            for y in body[j + 1:]:
                if y.strip() and len(y) - len(y.lstrip()) <= ci:
                    break
                tail.append(y)
            if key == "include":
                include = len([y for y in tail if re.match(r"^\s*-\s", y) and len(y) - len(y.lstrip()) == (ci + 2)]) or 1
            elif key == "exclude":
                continue
            else:
                saw_axis = True
                if val.startswith("$"):
                    return None
                n = _list_len(val) if val else len([y for y in tail if re.match(r"^\s*-\s", y)])
                if n is None:
                    n = 1
                product *= max(n, 1)
        return (product if saw_axis else 0) + include
    return 0


def lint_text(text: str, name: str = "workflow.yml", require_sha: bool = False, require_path_filters: bool = False,
              require_headers: bool = False, require_second_route: bool = False, repo_root=None):
    raw = text.splitlines()
    code = _strip(raw)
    f = []

    def add(rule, msg):
        f.append(f"{name}: {rule} {msg}")

    on_block = " ".join(_top_block(code, "on") or _top_block(code, "true") or [])
    jobs, ji = _jobs(code)
    has_top_perm = _top_block(code, "permissions") is not None
    if not has_top_perm:
        missing = [j for j, b in jobs.items() if not any(re.match(r"^\s{%d}permissions\s*:" % (ji + 2), l) for l in b)]
        if missing or not jobs:
            add("W01", "no top-level `permissions:` (set `permissions: contents: read`)")
    if _top_block(code, "concurrency") is None and not any(re.search(r"#\s*no-concurrency:\s*\S", l) for l in raw):
        add("W02", "no top-level `concurrency:` (or a `# no-concurrency: <reason>` comment)")
    cap = MAX_TIMEOUT
    for l in raw:
        am = re.search(r"#\s*allow-timeout:\s*(\d+)\s+(\S.*)$", l)
        if am:
            if MAX_TIMEOUT < int(am.group(1)) <= MAX_ALLOWED_TIMEOUT:
                cap = int(am.group(1))
            else:
                add("W03", f"`# allow-timeout:` needs minutes between {MAX_TIMEOUT + 1} and {MAX_ALLOWED_TIMEOUT} and a reason")
        elif re.search(r"#\s*allow-timeout:", l):
            add("W03", "`# allow-timeout:` needs minutes and a reason (`# allow-timeout: 30 <reason>`)")
    for j, b in jobs.items():
        if any(re.match(r"^\s{%d}uses\s*:" % (ji + 2), l) for l in b):
            continue  # reusable-workflow call: the callee carries the timeout
        m = next((re.match(r"^\s{%d}timeout-minutes\s*:\s*(\d+)\s*$" % (ji + 2), l) for l in b if re.match(r"^\s{%d}timeout-minutes\s*:" % (ji + 2), l)), None)
        if not m:
            add("W03", f"job `{j}` has no integer `timeout-minutes` (default would be 360)")
        elif int(m.group(1)) > cap:
            add("W03", f"job `{j}` timeout-minutes {m.group(1)} exceeds {cap}")
    allow_sched = any(re.search(r"#\s*allow-schedule:\s*\S", l) for l in raw)  # a stated reason and cost estimate
    if not allow_sched and (re.search(r"(^|[\s{,\[])schedule\s*:", on_block) or re.search(r"^\s+schedule\s*:", "\n".join(code), re.M)):
        add("W04", "`schedule:` trigger is forbidden (scheduled work runs from the Cloudflare tick)")
    if any("pull_request_target" in l for l in code):
        add("W05", "`pull_request_target` is forbidden")
    for l in code:
        m = UNPINNED.match(l)
        if not m or m.group(1).startswith(("./", "docker://")):
            continue
        if m.group(2) is None or m.group(2) in ("main", "master", "HEAD"):
            add("W06", f"action `{m.group(1)}` is not pinned to a tag or SHA (`@{m.group(2)}`)" if m.group(2) else f"action `{m.group(1)}` has no ref")
        elif require_sha and not re.fullmatch(r"[0-9a-f]{40}", m.group(2)):
            add("W09", f"action `{m.group(1)}@{m.group(2)}` is pinned to a tag, not to a full commit SHA")
    if re.search(r"\bpull_request\b(?!_target)", on_block):
        for j, b in jobs.items():
            body = "\n".join(b)
            if SECRET.search(body):
                ifs = [l for l in b if re.match(r"^\s{%d}if\s*:" % (ji + 2), l)]
                if not any(GUARD.search(l) for l in ifs):
                    add("W07", f"job `{j}` uses secrets in a workflow triggered by pull_request without a fork/event guard")
    for i, l in enumerate(code):
        if re.search(r"runs-on\s*:.*\b(macos|windows)", l, re.I):
            add("W08", "macOS and Windows runners are forbidden (price per minute 10x and 1.7x Linux)")
        elif re.search(r"runs-on\s*:", l) and LARGER_RUNNER.search(" ".join(code[i:i + 3]) if l.rstrip().endswith(":") else l):
            add("W13", "self-hosted and larger runners are forbidden (Linux standard runners only)")
    for j, b in jobs.items():
        n = _matrix_size(b)
        if n is None:
            add("W10", f"job `{j}` has a matrix with no explicit list (the platform maximum is 256 jobs)")
        elif n > 4:
            add("W10", f"job `{j}` matrix expands to {n} jobs (at most 4)")
    if re.search(r"\bpull_request\b(?!_target)", on_block):
        conc = _top_block(code, "concurrency")
        if conc is not None and not any("cancel-in-progress" in l for l in conc):
            add("W12", "pull_request workflow: `concurrency` has no `cancel-in-progress` (superseded runs keep billing)")
    perms = _top_block(code, "permissions")
    if perms is not None and len(jobs) > 1 and any(re.search(r"write-all|:\s*write\b|^write", l.strip()) for l in perms):
        add("W14", "top-level write permission on a multi-job workflow (grant write scopes per job)")
    if repo_root is not None:
        root = Path(repo_root)
        for i, l in enumerate(code):
            sm = re.match(r"^\s*-?\s*uses:\s*['\"]?actions/(setup-node|setup-python|setup-go)@", l)
            if not sm:
                continue
            step = [l]
            for x in code[i + 1:]:
                if re.match(r"^\s*-\s", x):
                    break
                step.append(x)
            if not any(re.match(r"^\s+cache\s*:", x) for x in step) and any(list(root.glob(f)) or list(root.glob("*/" + f)) for f in LOCKFILES[sm.group(1)]):
                add("W15", f"`actions/{sm.group(1)}` has no `cache:` while a lock file exists (cache dependencies, within the 10 GB limit)")
    if require_path_filters and re.search(r"\b(pull_request|push)\b(?!_target)", on_block) and not re.search(r"\bpaths(-ignore)?\s*:", on_block) \
            and not any(re.search(r"#\s*no-path-filter:\s*\S", l) for l in raw):
        add("W11", "push or pull_request workflow has no `paths` or `paths-ignore` filter (or `# no-path-filter: <reason>`)")
    if require_headers:
        for h in ("budget", "trigger", "free-alternative"):
            if not any(re.match(r"^\s*#\s*%s:\s*\S" % h, l) for l in raw):
                add("W16", f"missing header comment `# {h}:` (budget, trigger, free-alternative)")
    if require_second_route and allow_sched and not any(re.search(r"#\s*second-route:\s*\S", l) for l in raw):
        add("W17", "`# allow-schedule:` without `# second-route: <loop or tick step>` (no duty may depend on a schedule alone)")
    return f


def main(argv):
    argv = list(argv)
    repo_root = None
    if "--repo-root" in argv:
        i = argv.index("--repo-root")
        repo_root = argv[i + 1] if i + 1 < len(argv) else None
        argv = argv[:i] + argv[i + 2:]
        if repo_root is None:
            print("workflow_lint: --repo-root needs a directory")
            return 2
    flags = {a for a in argv if a.startswith("--")}
    unknown = flags - {"--require-sha", "--sha-report", "--require-path-filters", "--require-headers", "--require-second-route", "--strict"}
    if unknown:
        print(f"workflow_lint: unknown option(s) {sorted(unknown)}")
        return 2
    paths = [Path(a) for a in argv if not a.startswith("--")] or sorted(Path(".github/workflows").glob("*.y*ml"))
    report = "--sha-report" in flags
    strict = "--strict" in flags
    findings = []
    for p in paths:
        findings += lint_text(p.read_text(encoding="utf8"), p.as_posix(), require_sha=report or "--require-sha" in flags,
                              require_path_filters=strict or "--require-path-filters" in flags, require_headers=strict or "--require-headers" in flags,
                              require_second_route=strict or "--require-second-route" in flags, repo_root=repo_root)
    if report:
        findings = [x for x in findings if " W09 " in x]
    for x in findings:
        print(x)
    print(f"workflow_lint: {len(paths)} file(s), {len(findings)} finding(s)" + (" not pinned to a commit SHA" if report else ""))
    return 0 if report else (1 if findings else 0)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

# SPDX-License-Identifier: LicenseRef-Ultrastable
# Automated replacement for CODEOWNERS approval (CLOSED-LOOP-AXIOM). Usage: protected_paths.py BASE_REF
"""Fails a diff that weakens a guard on a protected path; otherwise the diff is approved by the checks, not by a person.
A protected-path change must carry a `Protected-change:` line in PR_BODY (env) whose reason is at least REASON_MIN characters and not a
placeholder (US-20-R07), and must not delete a guard file or add a human approver. The reason is read from the first such line, with only
spaces and tabs after the colon: a blank field is empty and never takes the next line as its value (the record check's rule, US-20-R02)."""
import os, re, subprocess, sys

REASON_MIN = 12
PLACEHOLDER = re.compile(r"[<\[].*[>\]]|todo|tbd|\.\.\.|-", re.I)  # the record check's placeholders (workers/tools/selfhost_check.py)

# The guards written for the standalone workers repository sit under workers/ since it was folded in (REPOS-1); both spellings are protected.
FOLDED = ("workers/tools/selfhost_check.py", "workers/tools/spec_truth.py", "workers/core/test/no-qnfo.test.js", "workers/agents/CONTRACT.md")
LOCAL = ("scripts/protected_paths.py", "scripts/spec_truth.py", "scripts/spec_ids.py")
PROTECTED = ("autonomy/", ".github/workflows/", "actions-budget.json", "ops/halt.json", "SCOPE.md", "LICENSE", "AGENTS.md", "CLAUDE.md", "tools/selfhost_check.py", "tools/spec_truth.py", "core/test/no-qnfo.test.js") + FOLDED + LOCAL
GUARDS = ("tools/selfhost_check.py", "tools/spec_truth.py", "core/test/no-qnfo.test.js") + FOLDED + LOCAL


def run(args):
    return subprocess.run(args, capture_output=True, text=True, check=True).stdout


def reason(body):
    """The reason on the first `Protected-change:` line, stripped; None when the body has no such line. A CR before the newline is not part of it."""
    m = re.search(r"^Protected-change:[ \t]*(.*?)[ \t\r]*$", body or "", re.M)
    return None if m is None else m.group(1).strip()


def reason_problem(body):
    why = reason(body)
    if why is None:
        return "protected paths changed without a Protected-change: line in the PR body"
    if not why or PLACEHOLDER.fullmatch(why) or len(why) < REASON_MIN:
        return f"protected paths changed with a Protected-change: reason that is blank, a placeholder or shorter than {REASON_MIN} characters ({why[:40]!r})"
    return None


def main(base):
    changed = run(["git", "diff", "--name-status", f"{base}...HEAD"]).splitlines()
    hit = [l.split("\t", 1) for l in changed if l.split("\t", 1)[1].startswith(PROTECTED)]
    bad = []
    for status, path in hit:
        if status.startswith("D") and path in GUARDS:
            bad.append(f"{path}: a guard is deleted")
    why = reason_problem(os.environ.get("PR_BODY", "")) if hit else None
    if why:
        bad.append(why)
    diff = run(["git", "diff", f"{base}...HEAD", "--", ".github/CODEOWNERS"])
    if re.search(r"^\+[^+#\s]+\s+@\w", diff, re.M):
        bad.append("a human approver was added to CODEOWNERS")
    print("\n".join(bad) or f"protected-path gate ok ({len(hit)} protected file(s) changed)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "origin/main"))

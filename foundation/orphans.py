"""CLOSED-LOOP-1 as code: nothing is produced for a person to read, review or decide, and every loop closes itself.

  python3 -m foundation orphans --check            fail on a new orphan artifact, a stale baseline entry, or a human-wait state
  python3 -m foundation orphans --metrics          {"orphan_artifacts": N, "human_wait_states": N, ...} as JSON
  python3 -m foundation orphans --baseline         rewrite doctrine/orphans-baseline.json (shrink-only: it never adds an entry)
  python3 -m foundation orphans --issue-body       the body of the one backlog issue the executor loop drains
  python3 -m foundation orphans --sync-issue OWNER/REPO   open, refresh or close that issue (daily issues sweep)

Policy values: doctrine/orphans.json. An artifact (a Markdown file) is consumed when executable code in this repository names it
(path or file name), or a program loads it by name on every run (platform_consumed). Anything else is an orphan: written for a reader
that the mandate says does not exist. Orphans present on 2026-11-12 sit in the shrink-only baseline; a new one fails CI, and the
daily issues sweep files the baseline as one issue the executor loop drains (wire it to a loop, turn it into code, or delete it).
A human-wait state is a place where a loop waits on a person: allowed only for the identity-bound classes in the policy, and only with
a default in effect that the loop proceeds on.
"""
from __future__ import annotations
import json, re, subprocess, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
POLICY = "doctrine/orphans.json"
BASELINE = "doctrine/orphans-baseline.json"
REGISTRY = "instances/ultrastable/loop-registry.json"
NEEDS_YOU = "foundation/data/needs-you.json"
SKIP_DIRS = {".git", "node_modules", ".selfhost", "__pycache__"}


def policy(root=REPO) -> dict:
    return json.loads((Path(root) / POLICY).read_text(encoding="utf-8"))


def _files(root: Path):
    try:
        out = subprocess.run(["git", "ls-files", "-z"], cwd=root, capture_output=True, timeout=60)
        if out.returncode == 0 and out.stdout:
            return [root / p for p in out.stdout.decode("utf-8", "replace").split("\0") if p]
    except (OSError, subprocess.SubprocessError):
        pass
    return [p for p in root.rglob("*") if p.is_file() and not SKIP_DIRS & set(p.relative_to(root).parts)]


def orphans(root=REPO) -> list[str]:
    """Orphan documents are decided by the one document audit (foundation/docs_audit.py, DOC-CONSUMED-1); this module keeps the waits, the ledger and the backlog issue."""
    from . import docs_audit
    return sorted(d for d in docs_audit.evaluate(Path(root))["orphans"])


def waits(root=REPO) -> dict:
    """Human-wait states. `violations` must be empty; `identity_bound` are the allowed waits, each with its default."""
    root = Path(root)
    pol = policy(root)
    allowed = set(pol["rules"]["wait_on_person_allowed_only_for"])
    rx = [re.compile(p, re.I) for p in pol["wait_phrases"]]
    bad, ib = [], []
    ny = root / NEEDS_YOU
    if ny.exists():
        for it in json.loads(ny.read_text(encoding="utf-8")).get("items", []):
            iid = it.get("id", "?")
            if it.get("class") not in allowed:
                bad.append(f"needs-you {iid}: class {it.get('class')!r} is not identity-bound ({sorted(allowed)}); the system does it")
            elif not it.get("default"):
                bad.append(f"needs-you {iid}: no default in effect; the loop must proceed on one")
            else:
                ib.append(f"needs-you {iid} ({it['class']}): default '{it['default']}'")
    reg = root / REGISTRY
    if reg.exists():
        for l in json.loads(reg.read_text(encoding="utf-8")).get("loops", []):
            lid = l.get("id", "?")
            cb = l.get("closes_by", "")
            if cb != "system":
                if l.get("identity_bound") in allowed and l.get("default_in_effect"):
                    ib.append(f"loop {lid} ({l['identity_bound']}): default '{l['default_in_effect']}'")
                else:
                    bad.append(f"loop {lid}: closes_by {cb!r} waits on a person without identity_bound class and default_in_effect")
            blob = " ".join(str(l.get(k, "")) for k in ("summary", "trigger", "done"))
            for r in rx:
                m = r.search(blob)
                if m and not l.get("identity_bound"):
                    bad.append(f"loop {lid}: waits on a person ('{m.group(0)}'); close it by system or mark it identity_bound with a default")
                    break
    return {"violations": bad, "identity_bound": ib}


def baseline(root=REPO) -> list[str]:
    p = Path(root) / BASELINE
    return json.loads(p.read_text(encoding="utf-8")).get("orphans", []) if p.exists() else []


def metrics(root=REPO) -> dict:
    o, w = orphans(root), waits(root)
    return {"orphan_artifacts": len(o), "human_wait_states": len(w["violations"]), "identity_bound_waits": len(w["identity_bound"]),
            "new_orphans": len(set(o) - set(baseline(root)))}


def check(root=REPO) -> list[str]:
    root = Path(root)
    bad = []
    pol = policy(root)
    for k, v in pol["assume"].items():
        if v is not False:
            bad.append(f"policy assume.{k} must be false (CLOSED-LOOP-1)")
    o, base = set(orphans(root)), set(baseline(root))
    for rel in sorted(o - base):
        bad.append(f"orphan artifact {rel}: no code in the repository reads it. Make a loop consume it, turn it into code, or delete it")
    for rel in sorted(base - o):
        bad.append(f"baseline entry {rel} is no longer an orphan (or is gone): remove it from {BASELINE} (shrink-only)")
    bad += waits(root)["violations"]
    bad += ledger_failures(root)
    return bad


def ledger_failures(root=REPO) -> list[str]:
    """Every lesson and decision row carries a probe; a row whose probe fails is a decision the code no longer carries."""
    from . import selfhost
    p = Path(root) / "doctrine/decision-ledger.json"
    if not p.exists():
        return []
    bad = []
    for r in json.loads(p.read_text(encoding="utf-8")).get("rows", []):
        try:
            if not selfhost.probe(root, r.get("probe", "")):
                bad.append(f"ledger {r['id']}: probe fails ({r.get('probe')}); the code no longer carries this {r.get('kind')}")
        except ValueError as e:
            bad.append(f"ledger {r.get('id')}: {e}")
    return bad


def write_baseline(root=REPO) -> int:
    """Shrink-only: keeps only entries that are still orphans; never adds one unless no baseline exists yet."""
    root = Path(root)
    p = root / BASELINE
    now = orphans(root)
    keep = sorted(set(now) & set(baseline(root))) if p.exists() else now
    p.write_text(json.dumps({"_doc": "Shrink-only list of orphan artifacts present when CLOSED-LOOP-1 landed (2026-11-12). The executor loop drains it through the CLOSED-LOOP-1 issue; a new orphan fails CI.",
                             "orphans": keep}, indent=1) + "\n", encoding="utf-8")
    return len(keep)


def issue_body(root=REPO) -> str:
    pol = policy(root)
    base = baseline(root)
    n = pol["backlog_issue"]["batch"]
    m = metrics(root)
    lines = [f"Metrics: orphan_artifacts={m['orphan_artifacts']} (target 0), human_wait_states={m['human_wait_states']} (target 0).", "",
             f"Next {min(n, len(base))} orphan artifacts (of {len(base)}). For each: make a loop's code read it, turn its content into code or policy values, or delete it. Then remove it from `{BASELINE}`.", ""]
    lines += [f"- [ ] `{r}`" for r in base[:n]]
    lines += ["", "code-task: python3 -m foundation orphans --check", "closing probe: `python3 -m foundation orphans --metrics` reports orphan_artifacts 0 and human_wait_states 0.",
              "", "Filed and refreshed by the daily issues sweep (.github/workflows/issues.yml); closed by the same sweep when both metrics reach 0."]
    return "\n".join(lines)


def sync_issue(repo: str, root=REPO) -> str:
    """Open, refresh or close the one CLOSED-LOOP-1 backlog issue (gh CLI with the workflow token). Returns what it did."""
    pol = policy(root)["backlog_issue"]
    m = metrics(root)
    # QUEUE-1: Issues are off on the code repository. The shrink-only baseline plus `orphans --check` (a step of `checks`) fails any PR that adds an
    # orphan, and `orphans --zero` reports the target; nothing remote needs refreshing.
    if subprocess.run(["gh", "api", f"repos/{repo}", "--jq", ".has_issues"], capture_output=True, text=True, timeout=60).stdout.strip() == "false":
        return "issues off: backlog enforced by orphans --check in checks; zero=" + str(m["orphan_artifacts"] == 0 and m["human_wait_states"] == 0)

    def gh(*a):
        r = subprocess.run(["gh", *a], capture_output=True, text=True, timeout=90)
        if r.returncode:
            raise RuntimeError(f"gh {' '.join(a[:3])}: {r.stderr.strip()[-300:]}")
        return r.stdout
    found = json.loads(gh("issue", "list", "-R", repo, "--state", "open", "--search", f"in:title \"{pol['title']}\"", "--json", "number,title") or "[]")
    found = [i for i in found if i["title"] == pol["title"]]
    done = m["orphan_artifacts"] == 0 and m["human_wait_states"] == 0
    if found:
        n = str(found[0]["number"])
        if done:
            gh("issue", "close", n, "-R", repo, "--comment", "closing probe passed: orphan_artifacts 0, human_wait_states 0")
            return f"closed #{n}"
        gh("issue", "edit", n, "-R", repo, "--body", issue_body(root))
        return f"refreshed #{n}"
    if done:
        return "nothing to file"
    for lab in pol["labels"]:
        subprocess.run(["gh", "label", "create", lab, "-R", repo, "--force"], capture_output=True, timeout=60)
    url = gh("issue", "create", "-R", repo, "--title", pol["title"], "--body", issue_body(root), *sum([["--label", l] for l in pol["labels"]], []))
    return "opened " + url.strip()


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if "--sync-issue" in argv:
        print(sync_issue(argv[argv.index("--sync-issue") + 1])); return 0
    if "--zero" in argv:  # closing probe of the queue item Q-ORPHANS
        m = metrics(); return 0 if m["orphan_artifacts"] == 0 and m["human_wait_states"] == 0 else 1
    if "--metrics" in argv:
        print(json.dumps(metrics(), indent=1)); return 0
    if "--baseline" in argv:
        print("baseline entries:", write_baseline()); return 0
    if "--issue-body" in argv:
        print(issue_body()); return 0
    bad = check()
    for b in bad:
        print("CLOSED-LOOP-1:", b)
    m = metrics()
    print(f"orphans: {m['orphan_artifacts']} orphan artifact(s) (baseline, shrink-only), {m['human_wait_states']} human-wait state(s), {m['identity_bound_waits']} identity-bound wait(s) with defaults; {len(bad)} failure(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())

# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""CODE-REGULATOR-1: python3 -m foundation regulator <cmd> [--repo PATH] [--db PATH]

index                 incremental refresh of the repo model (prints parsed/unchanged/removed)
map [--focus F ...]   byte-stable ranked map for the context prefix (P1/P11)
impact F [F ...]      affected tests for changed files (P7)
ask Q                 conclusion-cache lookup (P2); exit 1 on miss/stale
tell Q A -e FILE ...  store a conclusion with its evidence files
hook                  read a PostToolUse payload on stdin into the token ledger
schema                print the ledger SQL (D1-compatible)
tokens                token share by kind + cache-read share (experiment 1 baseline)
"""
import argparse
import json

from . import Store, RepoModel, ConclusionCache, affected_tests


def main(argv=None):
    ap = argparse.ArgumentParser(prog="foundation regulator")
    ap.add_argument("cmd")
    ap.add_argument("args", nargs="*")
    ap.add_argument("--repo", default=".")
    ap.add_argument("--db", default=".regulator.sqlite")
    ap.add_argument("--focus", nargs="*", default=[])
    ap.add_argument("-e", "--evidence", nargs="*", default=[])
    ap.add_argument("--budget", type=int, default=1024)
    a = ap.parse_args(argv)

    s = Store(a.db)
    try:
        return _run(a, ap, s)
    finally:
        s.close()


def _run(a, ap, s):
    model = RepoModel(s, a.repo)
    if a.cmd == "index":
        print(json.dumps(model.update()))
    elif a.cmd == "map":
        model.update()
        print(model.render_map(a.focus, a.budget))
    elif a.cmd == "impact":
        model.update()
        if not a.args:
            ap.error("impact needs at least one changed file")
        tests, mode = affected_tests(model, a.args)
        print(json.dumps({"mode": mode, "tests": tests}))
    elif a.cmd == "ask":
        if not a.args:
            ap.error("ask needs a question")
        ans = ConclusionCache(s, a.repo).get(" ".join(a.args))
        if ans is None:
            return 1
        print(ans)
    elif a.cmd == "tell":
        if len(a.args) != 2:
            ap.error("tell needs QUESTION ANSWER")
        q, ans = a.args
        ConclusionCache(s, a.repo).put(q, ans, a.evidence)
    elif a.cmd == "hook":
        import sys
        from .ledger_hook import safe_record
        safe_record(s, sys.stdin.read())  # always exit 0: a hook must not fail the tool call
    elif a.cmd == "schema":
        from .store import schema_sql
        print(schema_sql(), end="")
    elif a.cmd == "tokens":
        print(json.dumps({"share_by_kind": s.token_share_by_kind(),
                          "cache_read_share": s.cache_read_share()}))
    else:
        ap.error(f"unknown cmd {a.cmd}")
    return 0


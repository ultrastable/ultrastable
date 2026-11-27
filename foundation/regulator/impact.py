# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""P7 Feedforward: change-impact analysis. Run affected tests first, full suite as backstop."""
import os


def reverse_closure(edges, changed):
    rev = {}
    for src, dsts in edges.items():
        for d in dsts:
            rev.setdefault(d, set()).add(src)
    seen, stack = set(changed), list(changed)
    while stack:
        n = stack.pop()
        for m in rev.get(n, ()):
            if m not in seen:
                seen.add(m)
                stack.append(m)
    return seen


def is_test(path):
    b = os.path.basename(path)
    return b.startswith("test_") or b.endswith(("_test.py", ".test.js", ".test.mjs", ".test.ts", ".spec.js", ".spec.ts")) or "tests" in path.split(os.sep) or "test" in path.split(os.sep)


def affected_tests(model, changed_files):
    """Tests whose import closure reaches any changed file. Unknown files => all tests (safe default)."""
    edges = model.import_edges()
    known = set(edges)
    changed = set(changed_files)
    if changed - known:  # new/unparsed file: cannot reason, fall back to full suite
        return sorted(p for p in known if is_test(p)), "full_suite_fallback"
    closure = reverse_closure(edges, changed)
    return sorted(p for p in closure if is_test(p)), "impact_set"

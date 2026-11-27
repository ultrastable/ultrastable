# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""P11 cache-shaped context: the stable prefix must be byte-identical for the same commit, or the prompt cache is paid for twice."""
import hashlib


def prefix_digest(model, focus=(), budget_tokens=1024):
    return hashlib.sha256(model.render_map(focus, budget_tokens).encode()).hexdigest()


def stable(model, focus=(), budget_tokens=1024, runs=2):
    """True iff `runs` renders of the same state give the same digest."""
    return len({prefix_digest(model, focus, budget_tokens) for _ in range(runs)}) == 1

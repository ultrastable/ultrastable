# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""P9 algedonic channel: a few thresholds that preempt all queued work (Beer). Few channels, burn-rate based, to avoid alarm fatigue."""
from dataclasses import dataclass


@dataclass(frozen=True)
class Channel:
    name: str
    threshold: float        # breach when the reading is >= threshold
    consecutive: int = 1    # readings in a row required (debounce)


def preempt(channels, readings):
    """readings: {name: [oldest..newest]}. Returns names that must preempt the queue, most urgent (largest overshoot) first."""
    hit = []
    for c in channels:
        r = readings.get(c.name, [])
        tail = r[-c.consecutive:]
        if len(tail) == c.consecutive and all(v >= c.threshold for v in tail):
            hit.append((tail[-1] / c.threshold, c.name))
    return [n for _, n in sorted(hit, reverse=True)]

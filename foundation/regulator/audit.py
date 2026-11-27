# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""P8 System 3*: sampled clean-context audit instead of re-verifying everything.

Every change touching a protected owner path is audited (rate 1.0). Others are sampled at a base rate that doubles
(up to 1.0) after each audit that finds a defect and halves (down to the floor) after each clean one.
"""
import hashlib


def next_rate(rate, found_defect, floor=0.05):
    return min(1.0, rate * 2) if found_defect else max(floor, rate / 2)


def should_audit(change_id, touched, protected_prefixes, rate):
    """Deterministic in change_id, so a retry makes the same decision."""
    if any(t.startswith(tuple(protected_prefixes)) for t in touched):
        return True
    h = int(hashlib.sha256(change_id.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
    return h < rate

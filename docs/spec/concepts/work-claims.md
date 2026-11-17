<!-- SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0 -->
<!-- Copyright (c) 2026 Rowan Brad Quni-Gudzinas -->

# Work claims

Many agents and people act on the same organization at once. A work claim is a time-limited exclusive hold on an item (or, in QNFO, a path) so two of them do not do the same work or overwrite each other.

- **One live claim per item.** A second attempt is refused; the second agent reviews the held change or takes the next item.
- **Expiry.** A claim with no heartbeat for its time-to-live (default 120 minutes) is released by the reaper and the item returns to ready, so work never stalls on a stopped agent.
- **Fence (QNFO, PLANNED for the seed).** Each grant on a path carries a fence one higher than the last. A holder that paused past expiry presents a stale fence and its write is refused.
- **No silent drops.** Every item that leaves the active set needs a disposition; otherwise it is reopened and counted.
- **Principal queue.** Steps only the principal can take sit as gate cards with a default and a closing probe, and close themselves when the probe passes.

Specification: [US-SPEC-08](../../specs/US-SPEC-08-work-claims-and-reconciliation.md).

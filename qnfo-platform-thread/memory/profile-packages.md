---
name: profile-packages
description: How Rowan's public profiles are kept on-brand by code (BRAND-PROFILE-SYNC-1) and where owner-only profile steps live
metadata:
  type: project
  modified: 2026-11-09T14:08:44.084Z
---
Shipped 2026-11-09 in QNFO/qnfo-workers PR #9903 (deployed, canonical-deploy run 42631472796 success):
- qnfo-fleet-dashboard 1.104.0 BRAND-PROFILE-SYNC-1: the cron every 6 h sets the GitHub About text of 9 repos, brand topics, and the rwnq8 bio using the fleet GITHUB_TOKEN. A refused write becomes an owner card. `GET /api/brand-sync` shows the last run.
- Owner-only steps (LinkedIn headline/About, ORCID bio/keywords, Scholar affiliation/interests, X bio, Gmail signature, GitHub pins) are `human_actions` cards in D1 qnfo-audit, `source='brand-profile-sync'`, slugs `brand-*`, shown on fleet.qnfo.org with a Copy box (new column `human_actions.copy_text`, added lazily by the worker). Probes auto-close ORCID, Scholar, pins.
- qnfo-social 0.25.0: Bluesky and Mastodon bios are set from PROFILE_DESCRIPTION.
- Identity doc (D1 qnfo-identity owner_docs `identity`) brand section updated; backup row `identity-backup-2026-11-09`.
- Retired: rwnq8/resume docs/PROFILE-PACKAGES.md (removed in PR #8). Never deliver profile copy as a file again; Rowan's rule is code plus dashboard cards.

**How to apply:** change wording in the BRAND_* constants in qnfo-fleet-dashboard/worker.js (source: rwnq8/resume docs/BRAND.md), not in a doc. See [[brand-positioning]].

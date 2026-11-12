# Sibling repos were stale snapshots and six returned 403 to the app

Date: 2026-11-12
Kind: lesson
Session: session_0156nqDtDer7yrN7xaKoWgV1

Applying DOC-CONSUMED-1 outside the monorepo: workers got the audit tool, a registry, a test inside npm test, 9 documents removed or converted and drifted pages corrected (PR 112). site, platform, seed, docs, ip and business are 2026-11-10 snapshots whose content moved into ultrastable/ultrastable; their documents had no consumers, so the patches remove them with a sha256 ledger and add the audit where a test runner exists. Those six repos answered 403 on git push and on the API, so the patches are stored in deploy/sibling-patches and tracked by OL-20261112-2, which the first write-capable tick applies. A verified tier (every backticked file path must exist) found real drift in workers pages that named files which do not exist.

# PR 200 folded into the executor line

Date: 2026-11-12
Kind: decision
Session: session_0156nqDtcpd53CH4XsEKrdfY

Sibling PR #200 (Worker lane + transfer_account.mjs) was reconciled: lane.js kept as the Worker-side merge step (issue dispatch moved to executor.js), transfer_account.mjs superseded by scripts/cf_account.py (covers D1, KV, workers, cutover, rollback; separate SRC/DST tokens adopted from it).

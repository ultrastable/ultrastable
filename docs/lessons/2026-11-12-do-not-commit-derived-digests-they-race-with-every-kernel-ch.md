# Do not commit derived digests; they race with every kernel change

Date: 2026-11-12
Kind: lesson
Session: session_0156nqDsby1DU2aJgN1PcVaW

core-contract.json carried per-file digests of the kernel. Another change to seed/agents/AGENTS.md landed on main and turned the check red on #207 (and would on every open PR). Fix: digests are computed on demand and kept in the instance lock only; the contract check validates semver, kernel_paths and absence of digests.

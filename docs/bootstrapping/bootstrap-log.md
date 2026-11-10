# Bootstrap log: day one (2026-11-10)

Procedures that worked, failures that happened, and the changes each one should make to future initialisation. Written by the launch-roadmap thread. Append new entries; fix the seed (`seed/`) when an entry says so.

## What worked (repeat these)

1. **One backlog first.** A single roadmap (owner role, trigger, done check, owner-only marker) before any workstream. It became 37 GitHub issues and milestones, and kept parallel threads from colliding on scope.
2. **Git bundles as a bridge.** While no GitHub repo was reachable, each planned repo was committed locally and bundled (`git clone x.bundle x` works anywhere). Moving into the real repo then cost one copy, nothing was re-derived.
3. **Test every surface, report each result.** GitHub integration, the QNFO connector, the device, Cloudflare: each was tried and its exact answer recorded, instead of stopping at the first refusal.
4. **Checked-in rules.** The owner's standing rules were written the same turn into `agents/AGENTS.md`, its seed copy, and `agents/PROJECT-INSTRUCTIONS.md` (PR #77).
5. **Hand-offs by message with the owner's words attached**, so a thread could be deleted without losing the instruction.

## Failures and fixes

| # | What went wrong | Cause | Change for next initialisation |
|---|---|---|---|
| 1 | Four files said the QNFO public repo had no licence file | A fact was repeated from an earlier note without reading `LICENSE` (it carries the QNFO Unified License Agreement v2.1) | Rule added: check facts at the source before stating them. Seed `validate` step should read the licence file of every repo it cites |
| 2 | Six repos were never created; hours went to workarounds | Sessions cannot create GitHub repositories or organizations, and a repo is usable only after it is attached to the session | `bootstrap` must start with a preflight: list reachable repos, and if the target is missing open ONE gate card with the exact steps. Default to a single repo (folders per planned repo), which is what worked |
| 3 | Two threads wrote the same bundles into the same folder | No claim ledger; parallel threads | Claims and `docs/handoff/` are mandatory before touching a shared path (AGENTS.md section 4). Seed should create `docs/handoff/` |
| 4 | A script that would have duplicated 37 issues was nearly run | Another thread had already filed them | Every issue script must search for an existing title first (`create-issues.sh` does) and the owner of housekeeping is named in the roadmap |
| 5 | Closing and commenting on PRs was denied by the permission classifier | External-write policy for that action in auto mode | Treat a denial as an input: state it, take the next path (merge or leave open), never re-word. Prefer owning the branch end to end so no PR needs closing by a second thread |
| 6 | Stop hooks repeatedly reported unpushed commits after squash merges | Squash merge plus branch deletion leaves the local branch "ahead" with no remote | Check `origin/main` for the content before pushing again; delete merged local branches. Seed hooks should compare content, not commit ids |
| 7 | A connector sign-in had expired | OAuth expiry | Preflight lists connectors; expired ones get a reconnect card at the start |
| 8 | The live site could not be checked from the agent sandbox | The egress proxy refuses non-allowlisted hosts | Verification of public URLs belongs to a deployed probe (a Worker or CI job), not the agent's shell |
| 9 | Thread replies carried work that was not in code | Early in the day, results went to chat first | Reply only after the file is committed; chat points to paths |

## Deployment state at end of day one

- Repository, roadmap, issues, patent draft (v4), business plan, security overview, seed and instructions: on `main` in `ultrastable/ultrastable`.
- **Not deployed on purpose:** the public site and any cloud provisioning of the seed are held by the disclosure gate (PF-1) until the provisional is filed, and the seed's first end-to-end `--apply` has not run. Both are open items, not forgotten ones.
- Draft PRs #61 and #13 are superseded by the restructured main; closing them was denied to this thread, so they are left open.

## Next improvements (pluses)

- Preflight command in the seed: repos reachable, connectors valid, claims present, licences read.
- A scheduled job that fails CI when an agent-written document contradicts a repository fact (licence, visibility, dates).
- Automatic cleanup of merged local branches in agent sessions.

## Addendum from the push thread (2026-11-10, 09:30Z)

- Pushing to a shared `main` from a stale clone failed once (non-fast-forward, another thread had pushed): always `git pull --rebase origin main` immediately before pushing.
- The interim `org-repos/` copy was pushed before the unified layout landed (PR #54), so it duplicates content now under `ip/`, `business/`, `docs/`, `seed/`. Next improvement: a preflight that checks `origin/main` layout before bulk-copying, and a cleanup issue to delete `org-repos/` once the bundles are no longer needed.
- Issues #14 to #50 were filed through the GitHub MCP tool because the `gh` token was invalid; labels were created on the fly, milestones and Projects were not. Do these through the `org-manage` workflow.
- "Deploy everything" is held by the disclosure gate (PF-1): no further deploy until the provisional is filed.

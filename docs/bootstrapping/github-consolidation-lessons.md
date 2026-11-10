# GitHub consolidation: procedure and failures (2026-11-10)

Record of moving a multi-thread project into one private GitHub repo, so the next initialization starts from this. Tracked by the seed (`seed/`) and the bootstrapping doc.

## Procedure that worked
1. Clone the one repo the session is bound to; list what is on main versus open PRs before touching anything.
2. Build the target layout from the canonical sources in one branch (index files at top: README, INDEX, ROADMAP, PROJECTS; one folder per concern); delete duplicate trees in the same change.
3. Open the PR with the attribution block, subscribe to its events, merge `main` into the branch whenever it conflicts (other threads keep pushing).
4. Use REST for milestones (works), assign issues to milestones by id, use tracking issues as board stand-ins.
5. Put anything needing server-side GitHub access in a `workflow_dispatch` workflow plus an owner doc (`docs/ops/ORG-TOKEN.md`).

## Failures and the rule each produced
| Failure | Cause | Rule for next time |
|---|---|---|
| Merge to main and closing PRs denied | Permission check on merge/close by the agent | Open the PR, let the repo's bot workflow or the owner merge; never route around a denial |
| GraphQL / Projects boards impossible | Sessions block GraphQL and org-level REST | Ask for the owner token early (identity-bound step), commit the workflow that uses it before it is needed |
| Actions API (dispatch, secrets) blocked from session | Proxy policy | Workflows must also be runnable by trigger, owner click, or schedule; do not depend on dispatch from the agent |
| Org repos could not be created | Sessions cannot create repos | Start from one repo with the folder layout; split later by `git subtree` when repos exist |
| PR #54 conflicted three times | Several threads wrote to main concurrently | One thread owns layout; others add files only under their own folder; merge the PR early |
| Duplicate trees (org-repos, local-workspace, kit) | Threads pushed their own copies | Define the layout before parallel threads start; reject new top-level copies in review |
| Content written by two threads | Overlapping asks | Coordinator assigns one owner per deliverable; housekeeping thread does not write content |

## Not deployed, on purpose
The site worker stays unpublished until the provisional patent is filed (confidentiality gate, issue PF-1). Nothing was deployed from this thread; deployment of the site is issue WEB-1.

## Open at close
Real GitHub Projects boards, separate org repos, closing superseded PRs #13 and #61: all wait on the owner-minted `ORG_ADMIN_TOKEN` (docs/ops/ORG-TOKEN.md), then the `org-manage` workflow.

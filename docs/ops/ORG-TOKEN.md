# Org management token (owner step, once)

Agent sessions cannot call GitHub GraphQL or org-level APIs (verified 2026-11-10: GraphQL returns 403, org paths are blocked, the session token has repo scope only). GitHub Projects boards need GraphQL, so they are created by a workflow that runs on GitHub with a token you mint.

Identity-bound step (only the owner can mint the token). Default in effect until done: milestones and tracking issues stand in for boards. Closing probe: run the `org-manage` workflow with action `probe` and see your org's project list in the log.

1. GitHub > Settings > Developer settings > Fine-grained personal access tokens > Generate new token.
2. Resource owner: `ultrastable`. Repository access: only `ultrastable/ultrastable`.
3. Repository permissions: Contents read, Issues read/write, Pull requests read/write, Metadata read.
4. Organization permissions: Projects read/write. Set a 90-day expiry.
5. Repo Settings > Secrets and variables > Actions > New repository secret named `ORG_ADMIN_TOKEN`.
6. Actions > org-manage > Run workflow: `probe`, then `projects`, then `close-superseded`.

Creating repos needs the Administration organization permission and is deliberately not in the workflow; add it only if you want the fleet to create repos.

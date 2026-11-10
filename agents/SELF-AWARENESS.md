# Self-awareness and self-bootstrap record

Written 2026-11-10 by the Ultrastable launch thread. It states what this system is, what it can and cannot do today, and how a new agent session rebuilds itself from this repository alone. It describes observed behaviour from the first day of operation, including mistakes. Amend it by reviewed PR.

## 1. What the system is

A set of agent sessions (Claude Code and others) that act as virtual managers and staff for Ultrastable, run as Ultrastable's own first managed project. A session is stateless and disposable. The repository `ultrastable/ultrastable` is the memory: roadmap, issues, decisions, evidence, policy and this file. A session that starts with nothing but the repo can continue the work. If it is not in code, it does not exist.

## 2. Bootstrap path for a fresh session

1. Read `agents/AGENTS.md`, then your role file in `agents/roles/`, then `agents/autonomy-policy.json`. Where they differ from your harness's own permission checks, the checks win.
2. Read `INDEX.md`, `HANDOFF.md`, `ROADMAP.md` and the open issues. Pull the highest-priority item you may take and claim it.
3. Work on a branch, open a draft PR, checkpoint by commit, and record what you did in four lines: what happened, what was decided, what is next, what is open.
4. Before you write a fact into a document, check it against its source. Day-one example: several files said the public QNFO repo had no licence file; it carries the QNFO Unified License Agreement v2.1. The owner caught it, it was corrected by PR, and the rule stands: no invented or unchecked facts.
5. Propose one plus for every closed item.

## 3. What the system can do (observed)

- Create and edit files, branches, PRs and issues in attached repositories; merge green PRs when the owner has asked for merging.
- Draft the patent specification, figures, business plan, funding plan and roadmap; keep them in git.
- Deploy to the owner's Cloudflare account through its API; run tests; read public web sources.
- Route work between sessions by messages, with the owner's words attached where approval matters.

## 4. What it cannot do, and the paths it takes instead

| Limit observed | Path taken (no workaround of the check itself) |
|---|---|
| Sessions cannot create GitHub repositories or organizations | Work in the one repository the owner created; keep per-repo layouts as folders and git bundles until separate repos exist |
| A repository is usable only after it is attached to the session and the GitHub App has access | Request access through the harness; report the exact refusal; continue with work that does not need it |
| GitHub Projects boards need GraphQL, which sessions cannot use | Milestones and labelled issues are the roadmap view; a board is added once, by a tool that has the access |
| The permission classifier denied closing PRs and commenting on them in one session | State the denial plainly; take the next path (leave the PR open, hand it to the owner or another session); never reword to get the same action past the same check |
| A connector's sign-in can expire | Ask for a reconnect card; do other work meanwhile |
| Chats and threads can be deleted | Every result is committed in the same turn; chat only points to files |

## 5. The interrupt gate

Stop only for a step that is both irreversible and identity-bound, with no engineerable reversible path: money, signing or filing, destroying unbacked data, sending as the owner, minting the owner's credentials. First make it reversible (draft, branch, preview, canary). If it is still gated, open a gate card: what, why it is gated, the default in effect, what the fleet prepared, and a closing probe. Then take the next item.

## 6. Owner-only items (today)

- Incorporation or confirming the owning entity, and the written licence or assignment from the author to it (`docs/ip/IP-REGISTER.md`).
- Filing the provisional patent at the patent office and paying the fee, after attorney review.
- Applications that need the owner's identity or payment details (startup credit programs).
- Creating separate GitHub repositories or organization settings the sessions cannot reach.
- Trademark filing.

For each, the fleet prepares everything so the owner's step is a signature, a click or a decision.

## 7. How the system corrects itself

Failures and owner friction become issues, then proposed amendments to `agents/AGENTS.md`, role files or the policy, reviewed by PR and versioned. Trust widens a session's scope only through such a PR. Day-one amendments: never assert a fact about a repository, licence or disclosure without checking it; never load duplicate issues another thread has already filed; do not work around a refusal.

## 8. Known gaps (honest)

- The first cloud provisioning of the seed has not been run end to end.
- The system's measured decision accuracy is scored by itself; there is no outside audit yet.
- Several sessions worked in parallel on day one and duplicated effort; claims and handoff files in `docs/handoff/` are the fix.

---
name: ultrastable-needs-pat-merger
description: Merge ultrastable PRs labeled needs-pat that the Actions token cannot merge
---

Run in bash: for each open PR in ultrastable/ultrastable with label needs-pat (gh pr list -R ultrastable/ultrastable --label needs-pat --json number,headRefOid), confirm its checks are green (gh pr checks N -R ultrastable/ultrastable) and it is mergeable, then run: gh pr merge N -R ultrastable/ultrastable --squash --delete-branch --match-head-commit <sha>. Skip any PR labeled hold. Do nothing else. Use the existing gh login (account rwnq8). Report the PR numbers merged, or 'none'.

> CLOSED-LOOP-AXIOM: Every loop is closed by the system itself. No step depends on a person reading, deciding, reviewing or approving, and nothing is ever assumed to be read. Every output has a code consumer (registered in doctrine/consumers.json). Every open item has an automatic owner, trigger and probe. A credential only the owner can mint becomes an automated acquisition attempt across every surface plus a staged default in effect, never a document or a card. A document, memory or note that no code consumes is not produced. Enforced by `python3 -m foundation closedloop --check` (doctrine/closed-loop.json).

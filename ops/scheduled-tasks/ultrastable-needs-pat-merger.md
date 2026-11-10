---
name: ultrastable-needs-pat-merger
description: Merge ultrastable PRs labeled needs-pat that the Actions token cannot merge
---

Run in bash: for each open PR in ultrastable/ultrastable with label needs-pat (gh pr list -R ultrastable/ultrastable --label needs-pat --json number,headRefOid), confirm its checks are green (gh pr checks N -R ultrastable/ultrastable) and it is mergeable, then run: gh pr merge N -R ultrastable/ultrastable --squash --delete-branch --match-head-commit <sha>. Skip any PR labeled hold. Do nothing else. Use the existing gh login (account rwnq8). Report the PR numbers merged, or 'none'.
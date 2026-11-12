# Release tags are the runtime pin; QNFO-lane items live in dependencies.json

Date: 2026-11-12
Kind: decision
Session: session_0156nqDsby1DU2aJgN1PcVaW

Instances pin ultrastable/workers by git tag (runtime.ref); the release workflow is workers PR #107. Items an instance lane owes are data (instances/<slug>/dependencies.json) printed by the drift scan, never prose.

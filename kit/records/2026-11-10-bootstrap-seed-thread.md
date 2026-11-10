# Record: "Add bootstrap seed and AIOS lessons" thread (2026-11-10)

Everything from this thread is in files; this note only indexes it.

- Request (Rowan): Ultrastable fully bootstrapped from an idea; agent instructions, autonomy and maximum-permission settings; study AIOS; add to the patent disclosure.
- Built: `repos/seed/` (IDEA.md, bootstrap/bootstrap.py, autonomy/policy.json, agents/AGENTS.md and six role files, .claude/settings.json, worker/ tick and D1 schema, tests, CI workflow). 12 Python and 9 Worker tests pass; no real cloud deploy yet.
- AIOS findings: `repos/seed/docs/aios-lessons.md` (source: public github.com/rwnq8/AIOS, 30 commits 2026-08-11 to 2026-11-09). `QNFO/agent-operating-system` was not readable from the session.
- Patent embodiment and suggested claims: `repos/ip/bootstrapping-embodiment.md` (sent to the patent thread).
- Roadmap items BS-1..BS-6: `repos/docs/roadmap.md`.
- Git bundles: `git-bundles/*.bundle` (seven repos incl. seed), `git-bundles/push-all.sh`.
- Blockers (2026-11-10 08:47 UTC): GitHub `ultrastable/seed` and `ultrastable/docs` return no access to the session (repos not created or app not installed); local-folder access to `~/Dev` on qnfo-win was denied by the permission classifier, so no folder exists on Rowan's computer yet.
- Rule from Rowan: GitHub org `ultrastable` is canonical; all local copies are ephemeral; nothing may live only in a thread.

# Claude Code routine (scheduled trigger or session loop)

Runs the same command as every other host. Create a scheduled routine (claude.ai/code, Routines) on repo `ultrastable/ultrastable`, hourly, with this prompt, or run it in a session with `/loop 1h <prompt>`:

> Read docs/PROJECT-MEMORY.md and instances/ultrastable/loops.json. Run `ULTRASTABLE_HOST=claude-routine python3 -m foundation launch --commit --push`. If any loop failed, open or update the backlog item for it with a probe and fix it on a branch `agent/<item>-<slug>` as a draft PR. Report in four lines: what happened, what I decided, what is next, what is open.

Evidence lands on branch `loop-evidence`; the routine reads `ops/loop-evidence/LATEST.md` to continue where the last pass stopped.

# Path: any agent (Claude Code, Codex, Copilot, others)

No agent depends on another agent's chat history. Point the agent at the repo and the root instruction file: Claude Code reads `CLAUDE.md`, Copilot reads `.github/copilot-instructions.md`, Codex and others read `AGENTS.md`; all of them lead to `agents/AGENTS.md`.

1. The agent runs `python3 -m foundation selfhost --verify` and `python3 -m foundation selfhost`.
2. It pulls the highest-priority open item from the booted tracker (`.selfhost/ultrastable.db`, table `items`) or from `docs/issues/`, claims it, does it on a branch, verifies it and records the outcome.
3. It reports in four lines and files one plus.

Claude threads are one consumer of the report (gap SG-3); a model-calling executor in the worker is gap SG-2. Both are registered, planned and probed.

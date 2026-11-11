# Ultrastable runs on itself: run it with any tools

**Ultrastable is the foundation for any autonomous system.** Ultrastable runs on itself: its own roadmap, items, managers, trust ledger, plussing budget, specs and reporting are held and run by the same code it gives to everyone else. Nothing else is needed but this repository.

The contract is one command. Every path below ends in it or in what it does:

```
python3 -m foundation selfhost --verify   # fails if any process depends on a tool with no recorded adapter
python3 -m foundation selfhost            # boots the organization from the repo and runs one tick
```

`selfhost` reads only `instances/ultrastable/`, `seed/`, `docs/issues/` and `doctrine/`. It writes `.selfhost/ultrastable.db` (SQLite) and prints the four-line report (what happened, what I decided, what is next, what is open).

## Pick a path

| You have | Path | Runbook | Needs |
|---|---|---|---|
| Nothing but Python 3 and a copy of the repo (zip, USB, git) | **Minimal** (tested) | [laptop-sqlite.md](laptop-sqlite.md) | `python3 -m foundation selfhost --no-node` |
| Node 22 as well | Full tick on a laptop | [laptop-sqlite.md](laptop-sqlite.md) | `python3 -m foundation selfhost` |
| A chat box, no shell | Manual copy-paste | [manual-copy-paste.md](manual-copy-paste.md) | `docs/BOOTSTRAP-PROMPT.md` |
| Claude Code, Codex, Copilot, any code agent | Agent | [agents.md](agents.md) | the agent reads `agents/AGENTS.md` |
| GitHub | Forge | [github.md](github.md) | repo access |
| Cloudflare | Runtime | [cloudflare.md](cloudflare.md) | `seed/worker/` |
| Google Cloud | Runtime | [gcp.md](gcp.md) | `platform/adapters/gcp/` |

## Rules for every path

- Code is the only memory. The result of any path is a commit, a file or a database row; a chat is never the only record.
- Every tool outside the system has an entry in `platform/adapters/registry.json` and a gap in `instances/ultrastable/gaps.json` with a plan and a closing probe. The verifier fails a change that adds a tool without them.
- Identity-bound steps (money, signing, minting the owner's credentials) are gate cards with a default in effect, never an instruction in prose.
- Reversible and in scope: do it, verify it, report it.

The gap register is `python3 -m foundation selfhost --gaps`.

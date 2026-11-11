# Path: manual copy-paste (no shell, no agent)

1. Download the repository as a zip from any host, or copy the files. Keep `instances/`, `seed/`, `docs/`, `doctrine/`, `foundation/`.
2. Paste `docs/BOOTSTRAP-PROMPT.md` as the first message into any chat assistant, then paste `agents/AGENTS.md` and `instances/ultrastable/gaps.json`.
3. Ask it to work the open items in `docs/issues/` in priority order and to answer with the four-line report and a unified diff. Apply the diff to the files. Mail, social and any other outside channel stays a person-run step recorded in `gaps.json`; the queues for them are files in `seed/outreach/` and `social/`.
4. Check the result with `python3 -m foundation selfhost --verify` where Python exists, or by reading the diff against the rules in `agents/AGENTS.md` where it does not.

The copy-paste path is registered as an adapter so it is never an unrecorded dependency.

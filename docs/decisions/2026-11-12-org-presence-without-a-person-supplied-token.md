# Org presence without a person-supplied token

Date: 2026-11-12
Kind: decision
Session: session_0156nqDsD94yWhZcbW9KFfeq

Rowan: never require an external input. Public org view is served from ultrastable.io/org through the Cloudflare connector. Surfaces tested: MCP on .github, add_repo, connector list, GITHUB_TOKEN scope, proxy settings write, device bash (not connected), manifest flow (needs owner click). license retired into spec with optional archive. Probe: curl https://ultrastable.io/org returns 200.

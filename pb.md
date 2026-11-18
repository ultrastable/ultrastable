Follow-up to #673 after its deploy: records the first verified parent-child link and closes Q-LAYER-child-reporting; regenerates claim counts that regen-generated could not push (`push_main: HTTP 502 read main 401`).

## Self-audit
Real output: `GET https://blindspot.ultrastable.app/health` returned `{"ok":true,"child":"blindspot","parent":"ultrastable","level":1,...}` after spinoff run 44387493494; `site pins: ok`; `claims: 28 verified of 28; 0 drift`; `writeback ok`.
Not thinking about: whether the parent metric M-child-blindspot-link has been seeded and measured by the tick yet; the 401 on the tick's push_main route is a credential problem on the server side (filed as OL-20261118-5).
Fix reference: filed OL-20261118-5.

## Handoff
item: Q-LAYER-child-reporting
agent: claude-code
verify: GET https://ultrastable.io/roadmap.json expect "Q-LAYER-child-reporting"
deploy: ultrastable-site

🤖 Generated with [Claude Code](https://claude.com/claude-code)

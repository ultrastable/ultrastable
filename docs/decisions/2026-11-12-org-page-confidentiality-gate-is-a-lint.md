# Org page confidentiality gate is a lint

Date: 2026-11-12
Kind: decision
Session: session_0156nqDsD94yWhZcbW9KFfeq

Coordinator asked for a SAFE NOW gate before the org page deploys. The patent track was dropped 2026-11-11 so no provisional flag exists. The gate is site/site.test.mjs asserting the org page has repository roles only, run in checks before merge. Probe: node site/site.test.mjs prints org ok.

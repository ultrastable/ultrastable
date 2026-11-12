# Path: any host with Python and SQLite (the minimal path)

Needs Python 3.10 or newer and a copy of this repository. No network, no git, no Node, no account.

```
python3 -m foundation selfhost --verify
python3 -m foundation selfhost --no-node
sqlite3 .selfhost/ultrastable.db "select id,status,owner_role from items limit 10"   # any SQLite viewer works
```

With Node 22 the same command without `--no-node` also runs the seed's heartbeat (`seed/worker/src/tick.js`) through `platform/adapters/sqlite/d1-sqlite.js`: reconcile, reap claims, probe gates, score predictions, accrue trust, dispatch, check the plus share. Test: `python3 -m unittest tests.foundation.test_selfhost`.

# core/substance

SUBSTANCE-1: is a change real? Classifies a diff, file by file, as `behaviour`, `literal` (numbers, hashes, timestamps, versions), `comment`, `format`, `import`, `generated` or `record`, and a whole change as `substantive`, `trivial` or `record`. Works on GitHub's per-file `patch` text, so the tick Worker can classify every merged pull request with one call. The Python twin is `foundation/substance.py`; both pass `doctrine/substance-vectors.json`.

| Piece | Status | File | Test |
|---|---|---|---|
| fileClass, classifyFile, verdict, splitPatch, classifyPrFiles | BUILT | index.js | substance.test.js |

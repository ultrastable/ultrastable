# core/progress

Visible progress from shipped changes only, tenant-agnostic. A caller passes events that already happened (a merged change, a release, a launch) and gets back what a returning reader needs: what shipped in a day, a week or a month (`digest`), whether the system is still shipping against the interval it declared (`cadence`), an Atom feed (`toAtom`), and a script that marks what is new since the reader's last visit using only the reader's own browser storage (`sinceVisitScript`). Bookkeeping merges are listed but never counted as progress, and a system with no event is unmeasured, never moving.

| Piece | Status | File | Test |
|---|---|---|---|
| normalize, digest, cadence, sinceVisit, toAtom, sinceVisitScript | BUILT | index.js | progress.test.js |

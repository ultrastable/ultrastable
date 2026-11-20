# core/format

NUMFMT-1: one formatter for every number a reader sees, tenant-agnostic and dependency-free. A measured or calculated value is shown to the precision it can be believed to: percentages to a whole number (one decimal below 10), counts to two or three significant figures with a unit word ("1.0 million"), other values to three significant figures. `figure(value, title)` reads the unit from the last parenthesis of an indicator title ("% of ...", "per 100 000 population", "in thousands"); `rate(logChange)` states a yearly change as "down 3.2% a year"; `machine()` rounds raw numbers in JSON and CSV to six significant figures; `falsePrecision(html)` is the lint a page test runs: it finds raw floats and unseparated long integers in the text a reader sees (DOIs and source codes are identifiers and pass).

| Piece | Status | File | Test |
|---|---|---|---|
| pct, count, sig, figure, unitOf, rate, machine, falsePrecision | BUILT | index.js | format.test.js |

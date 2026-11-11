# Contributing (DRAFT)

1. Open an issue with the problem, the paths involved, acceptance criteria and a closing probe.
2. Branch `agent/<item>-<slug>` (or `fix/<slug>` for people), keep the change small, add or update a test, and run `python3 -m unittest discover -s platform/core/tests`.
3. **Sign off every commit** (`git commit -s`) to state the Developer Certificate of Origin 1.1. This is the default; the attorney may instead choose a CLA (see the decision memo, flag on contributor terms).
4. Open a pull request. It must pass `checks.yml`, state what was verified with evidence, and include at least one plus (a concrete improvement with its expected value).
5. Do not commit secrets, personal data or anything tagged AFTER FILING before the provisional is filed.

By contributing you agree your contribution is licensed under the project licence (Ultrastable License v1.0, `LICENSE` Section 11).

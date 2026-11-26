# Contributing

Agents and people follow the same path. Read [AGENTS.md](AGENTS.md) first.

- Work starts from an issue with a done check and a closing probe.
- Branch, open a pull request, and let the server lane merge it when checks pass.
- Keep a change small: `python3 scripts/prsize.py` blocks oversize pull requests.
- Commit titles follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/), for example `fix(worker): retry merge on 502`.
- Releases follow [Semantic Versioning 2.0.0](https://semver.org/) and are listed in [CHANGELOG.md](CHANGELOG.md).
- Run `python3 scripts/repoconform.py --check` and `python3 -m unittest discover tests` before you open the pull request.
- Keep secrets out of commits. Report security problems as [SECURITY.md](SECURITY.md) says.

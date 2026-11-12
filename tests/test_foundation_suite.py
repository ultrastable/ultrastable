"""Makes `python3 -m unittest discover -s tests` run the foundation suite.

The test modules live in tests/foundation and import each other as top-level modules (`from _repo import ...`), so that directory is
not a package: making it one would shadow the real `foundation` package. Before this file, discovery from `tests` found nothing and
exited with "NO TESTS RAN". The load_tests protocol hands discovery the same suite `discover -s tests/foundation` runs.
"""
import unittest
from pathlib import Path


def load_tests(loader, standard_tests, pattern):
    here = Path(__file__).resolve().parent / "foundation"
    return unittest.TestLoader().discover(str(here), pattern=pattern or "test*.py", top_level_dir=str(here))

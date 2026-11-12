"""Every scratch directory a test makes lives under one session folder that is removed when the run ends.

Root cause of a full disk (2559 leaked tmp folders, each a copy of the repository): helpers called tempfile.mkdtemp() and nothing removed the result.
Routing the whole run's temp space through one folder closes that loop for every test, present and future.
"""
import shutil, tempfile

_SESSION = None


def pytest_configure(config):
    global _SESSION
    _SESSION = tempfile.mkdtemp(prefix="ultrastable-tests-")
    tempfile.tempdir = _SESSION


def pytest_unconfigure(config):
    tempfile.tempdir = None
    if _SESSION:
        shutil.rmtree(_SESSION, ignore_errors=True)

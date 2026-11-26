"""Shared helpers: a scratch copy of the repository to break on purpose, and a tiny git repo for the write-back check.

Every scratch directory made here is removed again, three ways, so neither a normal run nor a killed one fills the disk:

1. as soon as the test that asked for it ends: `scratch()` finds the running test (or its class, inside setUpClass) on the call stack and
   registers the removal with `addCleanup` / `addClassCleanup`, so at most one test's copies exist at a time;
2. at interpreter exit (`atexit`), for a directory made outside any test;
3. at the next import, for directories a killed run left behind: anything with this helper's prefix that is older than STALE_HOURS.

Before 2026-11-12 nothing removed them: every `copy_repo()` left a full copy of the repository in the temp directory, and three runs of the
suite filled a 117 GB disk. tests/foundation/test_repo_cleanup.py proves a run leaves nothing behind.
"""
import atexit, json, os, shutil, subprocess, sys, tempfile, time, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
SKIP = shutil.ignore_patterns(".git", "node_modules", "kit", "ip", "artifacts", "research", ".selfhost", "__pycache__", "repo-backups")
PREFIX = "ultrastable-test-"
STALE_HOURS = 6
_made: list[str] = []
_owner_pid = os.getpid()


def _remove(d) -> None:
    shutil.rmtree(d, ignore_errors=True)
    if str(d) in _made:
        _made.remove(str(d))


def _running_test():
    """The TestCase instance (or, in setUpClass, the TestCase class) that is asking for a directory, found on the call stack."""
    f = sys._getframe(2)
    while f is not None:
        s = f.f_locals.get("self")
        if isinstance(s, unittest.TestCase):
            return s
        c = f.f_locals.get("cls")
        if isinstance(c, type) and issubclass(c, unittest.TestCase):
            return c
        f = f.f_back
    return None


def scratch() -> Path:
    """An empty temp directory that is removed when the asking test ends (or at exit). Use it instead of a bare tempfile.mkdtemp() in tests."""
    d = tempfile.mkdtemp(prefix=PREFIX)
    _made.append(d)
    owner = _running_test()
    if isinstance(owner, unittest.TestCase):
        owner.addCleanup(_remove, d)
    elif owner is not None:
        owner.addClassCleanup(_remove, d)
    return Path(d)


def cleanup() -> int:
    """Remove every scratch directory this process still holds. Returns how many were removed. Safe to call more than once."""
    if os.getpid() != _owner_pid:      # a forked child never deletes its parent's directories
        return 0
    n = 0
    for d in list(_made):
        if os.path.isdir(d):
            n += 1
        _remove(d)
    return n


def sweep_stale(tmp=None, hours=STALE_HOURS) -> int:
    """Remove this helper's directories that a killed run left behind (older than `hours`). Only names with PREFIX are touched."""
    tmp, n, cutoff = Path(tmp or tempfile.gettempdir()), 0, time.time() - hours * 3600
    for p in tmp.glob(PREFIX + "*"):
        try:
            if p.is_dir() and p.stat().st_mtime < cutoff:
                shutil.rmtree(p, ignore_errors=True); n += 1
        except OSError:
            continue           # another run removed it first
    return n


atexit.register(cleanup)
sweep_stale()


def copy_repo() -> Path:
    d = scratch()
    shutil.copytree(ROOT, d, ignore=SKIP, dirs_exist_ok=True)
    return d


def edit(path, fn):
    data = json.loads(Path(path).read_text())
    fn(data)
    Path(path).write_text(json.dumps(data, indent=1))


def git(cwd, *a):
    r = subprocess.run(["git", "-C", str(cwd), "-c", "user.name=t", "-c", "user.email=t@example.com", *a], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return r.stdout


def tiny_repo() -> Path:
    d = scratch()
    git(d, "init", "-q", "-b", "main")
    (d / "README.md").write_text("x\n")
    git(d, "add", "."); git(d, "commit", "-q", "-m", "base")
    return d


def spec_files(pattern: str):
    """DISCLOSE-1: the full specification is private. A test that compares specification text with code reads it from the directory named by
    ULTRASTABLE_SPEC_DIR (the private ultrastable/ops spec/ checkout) and is skipped where that directory is not mounted, as in public CI."""
    d = os.environ.get("ULTRASTABLE_SPEC_DIR")
    if not d or not Path(d).is_dir():
        raise unittest.SkipTest("the full specification is private (DISCLOSE-1): set ULTRASTABLE_SPEC_DIR to run this test")
    found = sorted(Path(d).glob(pattern))
    if not found:
        raise unittest.SkipTest(f"no {pattern} in ULTRASTABLE_SPEC_DIR")
    return found

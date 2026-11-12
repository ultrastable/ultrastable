"""Shared helpers: a scratch copy of the repository to break on purpose, and a tiny git repo for the write-back check."""
import atexit, json, shutil, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
SKIP = shutil.ignore_patterns(".git", "node_modules", "kit", "ip", "artifacts", "research", ".selfhost", "__pycache__", "qnfo-platform-thread")


def copy_repo() -> Path:
    d = tempfile.mkdtemp()
    atexit.register(shutil.rmtree, d, True)  # no scratch copy outlives the test run (2559 leaked folders filled a disk)
    shutil.copytree(ROOT, d, ignore=SKIP, dirs_exist_ok=True)
    return Path(d)


def edit(path, fn):
    data = json.loads(Path(path).read_text())
    fn(data)
    Path(path).write_text(json.dumps(data, indent=1))


def git(cwd, *a):
    r = subprocess.run(["git", "-C", str(cwd), "-c", "user.name=t", "-c", "user.email=t@example.com", *a], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    return r.stdout


def tiny_repo() -> Path:
    d = Path(tempfile.mkdtemp())
    git(d, "init", "-q", "-b", "main")
    (d / "README.md").write_text("x\n")
    git(d, "add", "."); git(d, "commit", "-q", "-m", "base")
    return d

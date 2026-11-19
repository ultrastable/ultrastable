from foundation import openloops


def test_repo_clean():
    assert openloops.check() == []

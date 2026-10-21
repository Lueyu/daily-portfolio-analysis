# tests/test_coder_linker.py
"""The linker wires a sandbox's node_modules to the main checkout without
copying it. The critical safety property is teardown: removing a junction must
delete the reparse point only and never walk into the target (a naive
shutil.rmtree would erase the real node_modules)."""
import os
import sys
from pathlib import Path

import pytest

from agent_core.coder.linker import Linker, LinkError


class RecordingRunner:
    """Records argv AND really executes it on the success path.

    ``make_link`` verifies the link with ``is_junction`` after running the
    command, so a runner that only records (and never creates the link) would
    make the success path raise. On the success path we therefore shell out for
    real (creating a genuine junction in the tmp dir); pass ``forced_rc`` to
    short-circuit execution when simulating a failed ``mklink``.
    """
    def __init__(self, forced_rc=None):
        self.calls = []
        self.forced_rc = forced_rc

    def __call__(self, argv, cwd):
        self.calls.append((list(argv), str(cwd)))
        if self.forced_rc is not None:
            return self.forced_rc, "", ""
        import subprocess
        proc = subprocess.run(
            argv, cwd=str(cwd), capture_output=True, shell=False)
        out = proc.stdout.decode("utf-8", "replace") if proc.stdout else ""
        err = proc.stderr.decode("utf-8", "replace") if proc.stderr else ""
        return proc.returncode, out, err


def test_windows_make_link_uses_mklink_junction_without_shell(tmp_path):
    if not sys.platform.startswith("win"):
        return
    target = tmp_path / "real_node_modules"
    target.mkdir()
    (target / "leftpad.js").write_text("x", encoding="utf-8")
    link = tmp_path / "sandbox" / "node_modules"
    runner = RecordingRunner()
    Linker(runner=runner).make_link(link, target)
    argv, _cwd = runner.calls[0]
    # cmd /c mklink /J <link> <target>; argv form (no shell string).
    assert argv[:4] == ["cmd", "/c", "mklink", "/J"]
    assert str(link) in argv and str(target) in argv


def test_windows_make_link_raises_when_mklink_fails(tmp_path):
    if not sys.platform.startswith("win"):
        return
    target = tmp_path / "deps"
    target.mkdir()
    link = tmp_path / "sb" / "node_modules"
    with pytest.raises(LinkError):
        Linker(runner=RecordingRunner(forced_rc=1)).make_link(link, target)


def test_posix_make_link_uses_symlink(tmp_path, monkeypatch):
    # Force the POSIX branch even when running on Windows.
    target = tmp_path / "deps"
    target.mkdir()
    link = tmp_path / "sb" / "node_modules"
    made = {}
    linker = Linker(runner=RecordingRunner())
    monkeypatch.setattr(linker, "is_windows", lambda: False)
    monkeypatch.setattr(
        "agent_core.coder.linker.os.symlink",
        lambda src, dst, target_is_directory=False: made.setdefault(
            "args", (src, dst, target_is_directory)))
    linker.make_link(link, target)
    assert made["args"] == (target, link, True)


def test_is_junction_detects_reparse_point(tmp_path):
    if not sys.platform.startswith("win"):
        return
    target = tmp_path / "deps"
    target.mkdir()
    link = tmp_path / "junction"
    linker = Linker(runner=RecordingRunner())
    linker.make_link(link, target)
    assert linker.is_junction(link) is True
    assert linker.is_junction(target) is False
    assert linker.is_junction(tmp_path / "missing") is False


def test_remove_link_keeps_target_intact(tmp_path):
    """The whole point of the module: deleting the link leaves the real target
    and all its contents untouched."""
    target = tmp_path / "real_node_modules"
    target.mkdir()
    marker = target / "leftpad.js"
    marker.write_text("x", encoding="utf-8")
    link = tmp_path / "sb" / "node_modules"
    linker = Linker(runner=RecordingRunner())
    if sys.platform.startswith("win"):
        linker.make_link(link, target)
    else:
        os.symlink(target, link, target_is_directory=True)
    linker.remove_link(link)
    assert not link.exists()
    assert marker.exists(), "target node_modules must survive link removal"


def test_remove_link_is_a_noop_for_non_link(tmp_path):
    plain = tmp_path / "regular_dir"
    plain.mkdir()
    Linker(runner=RecordingRunner()).remove_link(plain)
    assert plain.exists()


def test_make_link_is_idempotent(tmp_path):
    target = tmp_path / "deps"
    target.mkdir()
    link = tmp_path / "node_modules"
    runner = RecordingRunner()
    if sys.platform.startswith("win"):
        linker = Linker(runner=runner)
        linker.make_link(link, target)
        linker.make_link(link, target)
    else:
        linker = Linker(runner=runner)
        linker.is_windows = lambda: False
        linker.make_link(link, target)
        linker.make_link(link, target)
    # Only one create attempt on Windows; POSIX symlink exists so it returns.
    assert len(runner.calls) <= 1

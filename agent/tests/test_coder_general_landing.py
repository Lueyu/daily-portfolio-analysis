"""Approval reruns checks on a merged copy and journals only scoped file writes."""
import importlib
import importlib.util
import json
import os
import subprocess
from pathlib import Path

import pytest

from agent_core.coder.checkpoints import BusyError, ConflictError
from agent_core.coder.checkpoints.locking import MutationLock, workspace_lock_path
from agent_core.coder.general_harness import GeneralHarness
from agent_core.coder.models import AcceptanceCriterion, CheckKind, DevTask, TaskStatus
from agent_core.coder.task_store import TaskStore


def api():
    assert importlib.util.find_spec("agent_core.coder.general_landing"), "approval landing is missing"
    return importlib.import_module("agent_core.coder.general_landing")


class FakeRuntime:
    def __init__(self, workspace, state, factory):
        self.workspace, self.state, self.factory = workspace, state, factory
        self.jobs = {}

    def ensure(self):
        assert self.workspace != self.factory.main
        self.state.mkdir(parents=True, exist_ok=True)

    def active_writers(self):
        return []

    def terminal_start(self, command, **kwargs):
        assert self.workspace != self.factory.main
        self.factory.calls.append((self.workspace, command))
        if self.factory.effect:
            self.factory.effect(self.workspace)
        result = {"session_id": "test", "status": "completed",
                  "exit_code": self.factory.exit_code, "output": self.factory.output, "cursor": 20}
        self.jobs["test"] = result
        return result

    def terminal_poll(self, session_id, **kwargs):
        return self.jobs[session_id]

    def stop_all(self):
        self.factory.stopped.append(self.workspace)


class RuntimeFactory:
    def __init__(self, main):
        self.main, self.calls, self.stopped = main, [], []
        self.effect, self.exit_code, self.output = None, 0, "2 passed; assertions checked"

    def __call__(self, workspace, state):
        return FakeRuntime(workspace, state, self)


@pytest.fixture
def approved(tmp_path):
    main = tmp_path / "main"
    main.mkdir()
    (main / "a.txt").write_bytes(b"before a\r\n")
    (main / "b.txt").write_bytes(b"before b\n")
    (main / "unrelated.txt").write_bytes(b"original")
    subprocess.run(["git", "init", str(main)], check=True, capture_output=True)
    subprocess.run(["git", "-C", str(main), "add", "."], check=True, capture_output=True)
    store = TaskStore(tmp_path / "tasks")
    task = DevTask(id="dev_landing", title="fix", problem="fix source", workdir=str(main),
                   acceptance=[AcceptanceCriterion(id="a", description="fixed", check=CheckKind.UNIT)])
    store.create(task)
    factory = RuntimeFactory(main)
    harness = GeneralHarness(task, None, store, runtime_factory=factory)
    harness.prepare()
    operation = harness.journal.begin("candidate", "edit")
    (harness.workspace / "a.txt").write_bytes(b"after a\n")
    (harness.workspace / "b.txt").write_bytes(b"after b\n")
    change = harness.journal.finish(operation)
    harness.state.update(revision=change["after"], candidate=change["after"])
    harness.state["verification"] = [
        {"revision": change["after"], "scope": scope, "criterion_ids": ids,
         "command": command, "cwd": ".", "passed": True, "exit_code": 0,
         "has_assertions": True, "source_changed": False}
        for scope, ids, command in [("target", ["a"], "node --test target"),
                                    ("regression", [], "node --test regression")]
    ]
    harness.task.set_status(TaskStatus.AWAITING_APPROVAL)
    harness._save()
    harness.test_factory = factory
    return harness


def current_journal(harness):
    root = harness.state_dir / "landing"
    state = json.loads((root / "state.json").read_text())
    path = root / state["active"] / "journal.json"
    return path, json.loads(path.read_text())


def test_approval_validates_merged_dirty_main_then_lands_without_git_index_changes(approved):
    main = approved.main_cwd
    (main / "unrelated.txt").write_bytes(b"keep dirty")
    index = (main / ".git/index").read_bytes()
    seen = []
    approved.test_factory.effect = lambda workspace: seen.append((workspace / "unrelated.txt").read_bytes())
    result = api().land_candidate(approved)
    assert result["status"] == "landed"
    assert approved.task.status == TaskStatus.VERIFIED
    assert (main / "a.txt").read_bytes() == b"after a\n"
    assert (main / "unrelated.txt").read_bytes() == b"keep dirty"
    assert (main / ".git/index").read_bytes() == index
    assert seen == [b"keep dirty", b"keep dirty"]
    assert all(path != main and path != approved.workspace for path, _ in approved.test_factory.calls)
    path, journal = current_journal(approved)
    assert journal["status"] == "landed"
    assert (path.parent / "before/a.txt").read_bytes() == b"before a\r\n"


@pytest.mark.parametrize('observed', [False, True])
def test_e2e_approval_requires_browser_evidence_for_exact_candidate(approved, observed):
    from test_coder_browser_acceptance import browser_fixture, observe_page
    browser_fixture(approved)
    if observed:
        observe_page(approved)
        approved.state['browser_verification']['revision'] = 'a different candidate'
    approved._save()
    with pytest.raises(ValueError, match='browser'):
        api().land_candidate(approved)
    assert not approved.test_factory.calls
    assert (approved.main_cwd / 'a.txt').read_bytes() == b'before a\r\n'


def test_e2e_approval_reuses_matching_candidate_observation_and_reruns_assertions(approved):
    from test_coder_browser_acceptance import browser_fixture, observe_page
    browser_fixture(approved)
    observe_page(approved)
    # The fresh validation runtime has no browser adapter. Candidate-bound
    # observation remains valid; assertions execute on the merged source.
    assert api().land_candidate(approved)['status'] == 'landed'
    assert len(approved.test_factory.calls) == 2


@pytest.mark.parametrize("invalid", ["status", "candidate", "target", "regression", "invalidated", "assertions"])
def test_incomplete_or_stale_approval_is_rejected_without_writing(approved, invalid):
    if invalid == "status":
        approved.task.set_status(TaskStatus.DIAGNOSED)
    elif invalid == "candidate":
        (approved.workspace / "a.txt").write_bytes(b"unreviewed")
    elif invalid in ("target", "regression"):
        approved.state["verification"] = [e for e in approved.state["verification"] if e["scope"] != invalid]
    elif invalid == "invalidated":
        approved.state["verification"][0]["invalidated"] = True
    else:
        approved.state["verification"][0]["has_assertions"] = False
    approved._save()
    with pytest.raises(ValueError):
        api().land_candidate(approved)
    assert (approved.main_cwd / "a.txt").read_bytes() == b"before a\r\n"
    assert not approved.test_factory.calls


def test_main_conflict_rejects_whole_landing_without_touching_other_files(approved):
    (approved.main_cwd / "b.txt").write_bytes(b"user changed b")
    with pytest.raises(ConflictError, match="b.txt"):
        api().land_candidate(approved)
    assert (approved.main_cwd / "a.txt").read_bytes() == b"before a\r\n"
    assert not approved.test_factory.calls


@pytest.mark.parametrize("failure", ["exit", "skipped", "source_write", "main_write"])
def test_merged_reverification_failure_never_lands_candidate(approved, failure):
    factory = approved.test_factory
    if failure == "exit":
        factory.exit_code = 1
    elif failure == "skipped":
        factory.output = "# tests 1\n# pass 0\n# skipped 1\n"
    elif failure == "source_write":
        factory.effect = lambda workspace: (workspace / "a.txt").write_bytes(b"test mutated source")
    else:
        factory.effect = lambda workspace: (approved.main_cwd / "unrelated.txt").write_bytes(b"late user edit")
    with pytest.raises((ValueError, ConflictError)):
        api().land_candidate(approved)
    assert (approved.main_cwd / "a.txt").read_bytes() == b"before a\r\n"
    assert approved.task.status == TaskStatus.AWAITING_APPROVAL
    assert factory.stopped


def test_landing_can_be_rolled_back_without_losing_unrelated_later_edit(approved):
    module = api()
    module.land_candidate(approved)
    (approved.main_cwd / "unrelated.txt").write_bytes(b"later unrelated")
    result = module.rollback_landing(approved)
    assert result["status"] == "rolled_back"
    assert (approved.main_cwd / "a.txt").read_bytes() == b"before a\r\n"
    assert (approved.main_cwd / "unrelated.txt").read_bytes() == b"later unrelated"
    assert approved.task.status == TaskStatus.AWAITING_APPROVAL


def test_rollback_conflict_is_preflighted_before_any_write(approved):
    module = api()
    module.land_candidate(approved)
    (approved.main_cwd / "b.txt").write_bytes(b"later user change")
    with pytest.raises(ConflictError, match="b.txt"):
        module.rollback_landing(approved)
    assert (approved.main_cwd / "a.txt").read_bytes() == b"after a\n"
    assert (approved.main_cwd / "b.txt").read_bytes() == b"later user change"


@pytest.mark.parametrize("crash", [False, True])
def test_partial_application_recovers_from_durable_backup(approved, monkeypatch, crash):
    module = api()
    original = module.atomic_write
    failed = False

    def fail_second(path, data):
        nonlocal failed
        if Path(path) == approved.main_cwd / "b.txt" and not failed:
            failed = True
            if crash:
                raise KeyboardInterrupt("simulated controller death")
            raise OSError("simulated disk failure")
        return original(path, data)

    monkeypatch.setattr(module, "atomic_write", fail_second)
    with pytest.raises(KeyboardInterrupt if crash else OSError):
        module.land_candidate(approved)
    monkeypatch.setattr(module, "atomic_write", original)
    if crash:
        assert current_journal(approved)[1]["status"] == "applying"
        assert (approved.main_cwd / "a.txt").read_bytes() == b"after a\n"
        module.rollback_landing(approved)
    assert (approved.main_cwd / "a.txt").read_bytes() == b"before a\r\n"
    assert (approved.main_cwd / "b.txt").read_bytes() == b"before b\n"
    assert current_journal(approved)[1]["status"] == "rolled_back"


def test_same_checkout_mutations_share_a_lock(approved):
    lock = MutationLock(workspace_lock_path(approved.main_cwd))
    lock.acquire()
    try:
        with pytest.raises(BusyError):
            api().land_candidate(approved)
    finally:
        lock.release()
    assert not approved.test_factory.calls


def test_reapproval_state_change_during_verification_cannot_land(approved):
    def invalidate(workspace):
        state = approved.evidence.load("state.json")
        state["verification"][0]["invalidated"] = True
        approved.evidence.save("state.json", state)

    approved.test_factory.effect = invalidate
    with pytest.raises((ValueError, ConflictError)):
        api().land_candidate(approved)
    assert (approved.main_cwd / "a.txt").read_bytes() == b"before a\r\n"


def test_add_delete_binary_and_file_directory_changes_round_trip(approved):
    operation = approved.journal.begin("reshape", "edit")
    (approved.workspace / "b.txt").unlink()
    (approved.workspace / "b.txt").mkdir()
    (approved.workspace / "b.txt" / "child.bin").write_bytes(b"\x00\xffnew")
    revision = approved.journal.finish(operation)["after"]
    approved.state.update(revision=revision, candidate=revision)
    for check in approved.state["verification"]:
        check["revision"] = revision
    approved._save()
    module = api()
    module.land_candidate(approved)
    assert (approved.main_cwd / "b.txt/child.bin").read_bytes() == b"\x00\xffnew"
    module.rollback_landing(approved)
    assert (approved.main_cwd / "b.txt").read_bytes() == b"before b\n"


def test_durable_commit_recovers_when_task_metadata_save_is_interrupted(approved, monkeypatch):
    module = api()
    original = approved._save
    failed = False

    def interrupted_save():
        nonlocal failed
        if approved.task.status == TaskStatus.VERIFIED and not failed:
            failed = True
            raise OSError("task metadata interrupted")
        original()

    monkeypatch.setattr(approved, "_save", interrupted_save)
    with pytest.raises(OSError, match="metadata interrupted"):
        module.land_candidate(approved)
    assert current_journal(approved)[1]["status"] == "landed"
    assert (approved.main_cwd / "a.txt").read_bytes() == b"after a\n"
    calls = len(approved.test_factory.calls)
    result = module.land_candidate(approved)
    assert result["status"] == "landed"
    assert approved.task.status == TaskStatus.VERIFIED
    assert len(approved.test_factory.calls) == calls


def test_partial_crash_recovery_refuses_later_overlapping_user_edit(approved, monkeypatch):
    module = api()
    original = module.atomic_write

    def interrupt_second(path, data):
        if Path(path) == approved.main_cwd / "b.txt":
            raise KeyboardInterrupt("interrupted application")
        return original(path, data)

    monkeypatch.setattr(module, "atomic_write", interrupt_second)
    with pytest.raises(KeyboardInterrupt):
        module.land_candidate(approved)
    monkeypatch.setattr(module, "atomic_write", original)
    (approved.main_cwd / "b.txt").write_bytes(b"user edit after crash")
    with pytest.raises(ConflictError, match="b.txt"):
        module.rollback_landing(approved)
    assert (approved.main_cwd / "a.txt").read_bytes() == b"after a\n"
    assert (approved.main_cwd / "b.txt").read_bytes() == b"user edit after crash"
    assert current_journal(approved)[1]["status"] == "conflicted"


def test_reapproval_cleans_interrupted_validation_runtime_before_retry(approved, monkeypatch):
    module = api()
    original = FakeRuntime.stop_all
    interrupted = False

    def killed_during_cleanup(runtime):
        nonlocal interrupted
        if not interrupted:
            interrupted = True
            raise KeyboardInterrupt("controller terminated before runtime cleanup")
        original(runtime)

    monkeypatch.setattr(FakeRuntime, "stop_all", killed_during_cleanup)
    with pytest.raises(KeyboardInterrupt):
        module.land_candidate(approved)
    abandoned = approved.test_factory.calls[0][0]
    assert abandoned not in approved.test_factory.stopped
    assert (approved.main_cwd / "a.txt").read_bytes() == b"before a\r\n"
    module.land_candidate(approved)
    assert abandoned in approved.test_factory.stopped
    record = json.loads((abandoned.parent / "journal.json").read_text())
    assert record["status"] == "validation_failed"
    assert record["runtime_stopped"] is True


def test_explicit_landing_cleanup_uses_main_lock_and_preserves_landed_files(approved):
    module = api()
    module.land_candidate(approved)
    lock = MutationLock(workspace_lock_path(approved.main_cwd))
    lock.acquire()
    try:
        with pytest.raises(BusyError):
            module.cleanup_landing_runtimes(approved)
    finally:
        lock.release()
    module.cleanup_landing_runtimes(approved)
    assert (approved.main_cwd / "a.txt").read_bytes() == b"after a\n"
    assert current_journal(approved)[1]["status"] == "landed"


def test_crash_before_initial_journal_cannot_block_future_approval(approved):
    abandoned = approved.state_dir / "landing" / ("a" * 32)
    abandoned.mkdir(parents=True)
    assert api().land_candidate(approved)["status"] == "landed"


@pytest.mark.skipif(os.environ.get("CODER_RUNTIME_INTEGRATION") != "1", reason="requires prepared runtime image")
def test_real_cleanup_recovers_validation_containers_after_controller_loss(approved, monkeypatch):
    module = api()
    approved.runtime_factory = None
    abandoned = {}

    def lose_controller(harness, directory, checks, record):
        runtime = module._runtime(harness, directory / "merged", directory / "engine")
        runtime.ensure()
        abandoned.update(directory=directory, runtime=runtime,
                         session=runtime.terminal_start("sleep 120")["session_id"])
        raise KeyboardInterrupt("controller lost before validation cleanup")

    monkeypatch.setattr(module, "_verify", lose_controller)
    try:
        with pytest.raises(KeyboardInterrupt):
            module.land_candidate(approved)
        directory = abandoned["directory"]
        recovered = module._runtime(approved, directory / "merged", directory / "engine")
        assert recovered.active_writers() == [abandoned["session"]]
        assert module.cleanup_landing_runtimes(approved) == [directory.name]
        assert recovered.active_writers() == []
        assert recovered.terminal_poll(abandoned["session"])["status"] == "cancelled"
        assert (approved.main_cwd / "a.txt").read_bytes() == b"before a\r\n"
    finally:
        if "runtime" in abandoned:
            abandoned["runtime"].stop_all()


@pytest.mark.skipif(os.environ.get("CODER_RUNTIME_INTEGRATION") != "1", reason="requires prepared runtime image")
def test_real_container_revalidates_before_landing(approved):
    operation = approved.journal.begin("assert candidate", "edit")
    (approved.workspace / "check.test.cjs").write_text(
        "const {test}=require('node:test');const assert=require('node:assert/strict');"
        "test('candidate',()=>assert.equal(require('node:fs').readFileSync('a.txt','utf8'),'after a\\n'));",
        encoding="utf-8")
    revision = approved.journal.finish(operation)["after"]
    approved.state.update(revision=revision, candidate=revision)
    for check in approved.state["verification"]:
        check.update(revision=revision, command="node --test check.test.cjs")
    approved._save()
    approved.runtime_factory = None
    result = api().land_candidate(approved)
    assert result["status"] == "landed"
    assert all(check["passed"] for check in result["verification"])
    assert (approved.main_cwd / "a.txt").read_bytes() == b"after a\n"

import pytest

from agent_core.coder.models import (
    AcceptanceCriterion,
    CheckKind,
    DevTask,
    Iteration,
    Patch,
    TaskStatus,
)
from agent_core.coder.task_store import TaskStore


def task():
    return DevTask(
        id="dev_store1",
        title="t",
        problem="p",
        acceptance=[
            AcceptanceCriterion(id="a", description="d", check=CheckKind.UNIT)
        ],
        workdir="D:/stock/code",
    )


def test_create_then_load_roundtrip(tmp_path):
    store = TaskStore(tmp_path)
    store.create(task())
    loaded = store.load("dev_store1")
    assert loaded.id == "dev_store1"
    assert loaded.status.value == "new"


def test_iterations_append_as_jsonl_and_replay(tmp_path):
    store = TaskStore(tmp_path)
    store.create(task())
    store.append_iteration(
        "dev_store1", Iteration(index=1, phase="diagnose", action="read")
    )
    store.append_iteration(
        "dev_store1", Iteration(index=2, phase="patch", action="diff")
    )
    rows = store.read_iterations("dev_store1")
    assert [r.index for r in rows] == [1, 2]
    assert rows[0].action == "read"


def test_patch_saved_with_sequential_name(tmp_path):
    store = TaskStore(tmp_path)
    store.create(task())
    p1 = store.save_patch("dev_store1", Patch(patch_id="p1", diff="--- a/x"))
    p2 = store.save_patch("dev_store1", Patch(patch_id="p2", diff="--- a/y"))
    assert p1.name.endswith("0001.diff")
    assert p2.name.endswith("0002.diff")
    assert p1.read_text(encoding="utf-8").startswith("--- a/x")


def test_save_transitions_status_and_persists(tmp_path):
    store = TaskStore(tmp_path)
    store.create(task())
    t = store.load("dev_store1")
    t.transition(TaskStatus.REPRODUCED)
    t.red_seen = True
    store.save(t)
    again = store.load("dev_store1")
    assert again.status == TaskStatus.REPRODUCED
    assert again.red_seen is True


def test_create_duplicate_task_raises(tmp_path):
    store = TaskStore(tmp_path)
    store.create(task())
    with pytest.raises(FileExistsError):
        store.create(task())
